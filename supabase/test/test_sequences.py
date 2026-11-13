"""No counter in the accounts database is open to the browser (security hunt 2026-11-13).

Supabase's default grants give the browser's roles ALL on every new sequence, so a
table's id counter can be moved to its end by anyone, after which every insert into
that table fails. Each migration that makes one must close it; this checks them all,
whichever migration made them, so a counter added later can't be forgotten.
Run: python3 -m unittest discover -s supabase/test
"""

import os
import unittest

from test_database import HERE, MIGRATIONS, Cluster

OPEN = """
select s.sequencename || ':' || r.rolname || ':' || p.privilege
from pg_sequences s, (values ('anon'), ('authenticated')) r(rolname), (values ('USAGE'), ('SELECT'), ('UPDATE')) p(privilege)
where s.schemaname = 'public'
  and has_sequence_privilege(r.rolname, format('%I.%I', s.schemaname, s.sequencename), p.privilege)
order by 1;
"""


class Sequences(unittest.TestCase):
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

    def owner(self, sql):
        ok, out = self.pg.psql(sql)
        self.assertTrue(ok, out)
        return out

    def as_role(self, role, sql):
        return self.pg.psql(f"begin;\nset local role {role};\n{sql}\ncommit;")

    def denied(self, result):
        ok, out = result
        self.assertFalse(ok, f"expected a refusal, got: {out}")
        self.assertIn("permission denied", out)

    def test_no_counter_is_open_to_the_browser(self):
        self.assertGreater(int(self.owner("select count(*) from pg_sequences where schemaname = 'public';")), 0, "the check must be looking at something")
        self.assertEqual(self.owner(OPEN), "")

    def test_the_bug_report_counter_cannot_be_moved_by_the_browser(self):
        for role in ("anon", "authenticated"):
            self.denied(self.as_role(role, "select setval('public.bug_report_log_id_seq', 9223372036854775807);"))
            self.denied(self.as_role(role, "select nextval('public.bug_report_log_id_seq');"))
        # And the server's own check still counts a report afterwards.
        ok, out = self.as_role("service_role", "select public.bug_report_allowed(repeat('a', 64), 10);")
        self.assertEqual((ok, out), (True, "t"))

    def test_the_check_can_fail(self):
        # A counter left as Supabase makes it is found, by name.
        self.owner("create sequence public.left_open; grant all on sequence public.left_open to anon, authenticated;")
        self.assertIn("left_open:anon:UPDATE", self.owner(OPEN))


if __name__ == "__main__":
    unittest.main()
