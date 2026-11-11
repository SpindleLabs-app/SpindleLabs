"""Report a bug's limits (supabase/migrations/20261111000000_bug_reports.sql), checked on a real PostgreSQL.

The bug-report function asks bug_report_allowed(sender) before filing each report: at most 5 an hour from one
sender (a hash of their address, never the address) and 200 a day from everyone. Only the server may ask, and nobody
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

    def allowed(self, sender):
        ok, out = self.as_role("service_role", f"select bug_report_allowed('{sender}');")
        self.assertTrue(ok, out)
        return out == "t"

    def backdate(self, sender, count, hours):
        self.owner(f"insert into bug_report_log (sender, at) select '{sender}', now() - interval '{hours} hours' from generate_series(1, {count});")

    def test_the_limits_are_the_documented_numbers(self):
        self.assertEqual(json.loads(self.owner("select bug_report_limits();")), {"per_sender_hour": 5, "all_day": 200})

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
            ok, out = self.as_role("service_role", f"select bug_report_allowed('{bad}');")
            self.assertFalse(ok, f"{bad!r} accepted")
            self.assertIn("not a sender hash", out)

    def test_nobody_in_a_browser_may_ask_or_read_the_log(self):
        for role, uid in [("anon", None), ("authenticated", ADA)]:
            for sql in [f"select bug_report_allowed('{ONE}');", "select count(*) from bug_report_log;", f"insert into bug_report_log (sender) values ('{ONE}');"]:
                ok, out = self.as_role(role, sql, uid)
                self.assertFalse(ok, f"{role} ran {sql}: {out}")
                self.assertIn("permission denied", out)


if __name__ == "__main__":
    unittest.main()
