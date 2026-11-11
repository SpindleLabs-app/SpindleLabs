"""Report a bug's limits (supabase/migrations/20261111000000_bug_reports.sql), checked on a real PostgreSQL.

The bug-report function asks bug_report_allowed(sender, bytes) before filing each report: at most 5 an hour and 15 a
day from one sender (a hash of their address, never the address), 200 a day from everyone, and 100 MiB of designs a
day in all (20261111010000_bug_report_limits.sql). Only the server may ask, and nobody
in a browser may read who sent what. Same throwaway cluster and roles as test_database.py.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import os
import unittest

from test_database import ADA, HERE, MIGRATIONS, Cluster

ONE = "a" * 64
TWO = "b" * 64


class BugReportLimits(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pg = Cluster()

    @classmethod
    def tearDownClass(cls):
        cls.pg.stop()

    def setUp(self):
        self.pg.psql("drop database if exists accounts; create database accounts;", db="postgres")
        for path in [os.path.join(HERE, "auth_stub.sql"), *MIGRATIONS]:
            with open(path, encoding="utf-8") as f:
                ok, out = self.pg.psql(f.read())
            self.assertTrue(ok, f"{os.path.basename(path)} failed to load: {out}")
        self.owner(f"insert into auth.users (id, email) values ('{ADA}', 'ada@example.com');")

    def owner(self, sql):
        ok, out = self.pg.psql(sql)
        self.assertTrue(ok, out)
        return out

    def as_role(self, role, sql, uid=None):
        claim = f"select set_config('request.jwt.claim.sub', '{uid}', true);" if uid else ""
        return self.pg.psql(f"begin;\nset local role {role};\n\\o /dev/null\nselect 1; {claim}\n\\o\n{sql}\ncommit;")

    def allowed(self, sender, size=0):
        ok, out = self.as_role("service_role", f"select bug_report_allowed('{sender}', {size});")
        self.assertTrue(ok, out)
        return out == "t"

    def backdate(self, sender, count, hours):
        self.owner(f"insert into bug_report_log (sender, at) select '{sender}', now() - interval '{hours} hours' from generate_series(1, {count});")

    def test_one_sender_cannot_fill_most_of_the_day(self):
        # Security review 2026-11-11: at 5 an hour alone, one sender could take 115 of the day's 200 places.
        for h in range(23):
            self.backdate(ONE, 5, h + 1.5)
        self.assertFalse(self.allowed(ONE), "one sender holds 115 of the 200 daily places")

    def test_fifteen_a_day_per_sender_counted_at_0_9x_and_1_1x_of_a_day(self):
        self.backdate(ONE, 15, 0.9 * 24)
        self.assertFalse(self.allowed(ONE), "15 reports 21.6 hours ago: the same day")
        self.backdate(TWO, 15, 1.1 * 24)
        self.assertTrue(self.allowed(TWO), "15 reports 26.4 hours ago: a new day")

    def test_designs_capped_at_100_mib_a_day_in_all(self):
        mib = 1024 * 1024
        # Worked: 90 MiB (0.9x of the cap) already sent today; 90 + 15 = 105 MiB is past 100 (refused), 90 + 5 = 95 fits.
        self.owner(f"insert into bug_report_log (sender, at, bytes) values ('{'d' * 64}', now() - interval '1 hour', {90 * mib});")
        self.assertFalse(self.allowed(ONE, 15 * mib), "90 + 15 MiB is past 100")
        self.assertTrue(self.allowed(ONE, 5 * mib), "90 + 5 MiB fits")
        self.assertTrue(self.allowed(TWO, 0), "a report without a design still goes")
        self.assertEqual(self.owner("select sum(bytes) from bug_report_log;"), str(95 * mib))

    def test_a_negative_or_missing_size_is_refused(self):
        for bad in ["-1", "null"]:
            ok, out = self.as_role("service_role", f"select bug_report_allowed('{ONE}', {bad});")
            self.assertFalse(ok, f"{bad} accepted")
            self.assertIn("not a size", out)

    def test_the_first_version_without_a_size_is_gone(self):
        ok, out = self.as_role("service_role", f"select bug_report_allowed('{ONE}');")
        self.assertFalse(ok, out)

    def test_the_limits_are_the_documented_numbers(self):
        self.assertEqual(json.loads(self.owner("select bug_report_limits();")), {"per_sender_hour": 5, "per_sender_day": 15, "all_day": 200, "design_bytes_day": 100 * 1024 * 1024})

    def test_five_an_hour_from_one_sender_then_refused_while_another_still_may(self):
        self.assertEqual([self.allowed(ONE) for _ in range(6)], [True] * 5 + [False])
        self.assertTrue(self.allowed(TWO), "a second sender has their own five")
        # A refusal is not counted: still 5 rows for the first sender.
        self.assertEqual(self.owner(f"select count(*) from bug_report_log where sender = '{ONE}';"), "5")

    def test_the_hour_at_0_9x_still_counts_and_at_1_1x_has_passed(self):
        self.backdate(ONE, 5, 0.9)
        self.assertFalse(self.allowed(ONE), "5 reports 54 minutes ago: still the same hour")
        self.backdate(TWO, 5, 1.1)
        self.assertTrue(self.allowed(TWO), "5 reports 66 minutes ago: a new hour")

    def test_two_hundred_a_day_from_everyone(self):
        # 200 from many senders 0.9 days ago fill the day; at 1.1 days they have gone.
        self.owner("insert into bug_report_log (sender, at) select lpad(to_hex(g), 64, 'c'), now() - interval '0.9 days' from generate_series(1, 200) g;")
        self.assertFalse(self.allowed(ONE), "the day is full")
        self.owner("update bug_report_log set at = now() - interval '1.1 days';")
        self.assertTrue(self.allowed(ONE), "a day later there is room")
        # Rows older than a day are deleted, so the log never grows past a day's reports.
        self.assertEqual(self.owner("select count(*) from bug_report_log;"), "1")

    def test_a_sender_that_is_not_a_hash_is_refused(self):
        for bad in ["", "a" * 63, "A" * 64, "203.0.113.7"]:
            ok, out = self.as_role("service_role", f"select bug_report_allowed('{bad}', 0);")
            self.assertFalse(ok, f"{bad!r} accepted")
            self.assertIn("not a sender hash", out)

    def test_nobody_in_a_browser_may_ask_or_read_the_log(self):
        for role, uid in [("anon", None), ("authenticated", ADA)]:
            for sql in [f"select bug_report_allowed('{ONE}', 0);", "select count(*) from bug_report_log;", f"insert into bug_report_log (sender) values ('{ONE}');"]:
                ok, out = self.as_role(role, sql, uid)
                self.assertFalse(ok, f"{role} ran {sql}: {out}")
                self.assertIn("permission denied", out)


if __name__ == "__main__":
    unittest.main()
