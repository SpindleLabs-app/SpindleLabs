"""The accounts database's rules (supabase/migrations), checked on a real PostgreSQL.

Each run makes a throwaway database cluster, loads the parts of Supabase the
migration relies on (auth_stub.sql, including Supabase's default grants of ALL
to the browser's roles), then every migration, and acts as signed-in people,
as nobody, and as the server, the way the browser's requests would.

Needs PostgreSQL's server programs (initdb, pg_ctl); GitHub's ubuntu runners have
them. With none found the tests fail rather than skip: a rule nobody checked
would look checked. Run: python3 -m unittest discover -s supabase/test
"""

import glob
import os
import shutil
import subprocess
import tempfile
import unittest
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = sorted(glob.glob(os.path.join(HERE, "..", "migrations", "*.sql")))
ADA = "11111111-1111-4111-8111-111111111111"
BO = "22222222-2222-4222-8222-222222222222"


def pg_bin(name):
    found = shutil.which(name)
    if found:
        return found
    candidates = sorted(glob.glob(f"/usr/lib/postgresql/*/bin/{name}"))
    if not candidates:
        raise RuntimeError(f"PostgreSQL's {name} was not found: install the PostgreSQL server to run these checks")
    return candidates[-1]


class Cluster:
    """A throwaway PostgreSQL listening only on a socket in a temporary folder."""

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="accounts-db-")
        self.user = ["runuser", "-u", "postgres", "--"] if os.geteuid() == 0 else []
        if self.user:
            shutil.chown(self.dir, "postgres")
        self.data = os.path.join(self.dir, "data")
        self.run(pg_bin("initdb"), "-D", self.data, "-U", "postgres", "-A", "trust", "--no-sync")
        self.run(pg_bin("pg_ctl"), "-D", self.data, "-l", os.path.join(self.dir, "log"), "-w", "-o", f"-k {self.dir} -c listen_addresses='' -c fsync=off", "start")

    def run(self, *args, input=None):
        return subprocess.run([*self.user, *args], input=input, capture_output=True, text=True, check=True)

    def psql(self, sql, db="accounts"):
        """Runs `sql` as the owner (postgres); returns (ok, output)."""
        p = subprocess.run([*self.user, pg_bin("psql"), "-h", self.dir, "-U", "postgres", "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], input=sql, capture_output=True, text=True)
        return p.returncode == 0, (p.stdout if p.returncode == 0 else p.stderr).strip()

    def stop(self):
        subprocess.run([*self.user, pg_bin("pg_ctl"), "-D", self.data, "-m", "immediate", "stop"], capture_output=True)
        shutil.rmtree(self.dir, ignore_errors=True)


class AccountsDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pg = Cluster()

    @classmethod
    def tearDownClass(cls):
        cls.pg.stop()

    def setUp(self):
        # A fresh database for each test, so no test depends on another's rows.
        self.pg.psql("drop database if exists accounts; create database accounts;", db="postgres")
        for path in [os.path.join(HERE, "auth_stub.sql"), *MIGRATIONS]:
            ok, out = self.pg.psql(open(path, encoding="utf-8").read())
            self.assertTrue(ok, f"{os.path.basename(path)} failed to load: {out}")
        for uid, email in [(ADA, "ada@example.com"), (BO, "bo@example.com")]:
            self.owner(f"insert into auth.users (id, email) values ('{uid}', '{email}');")

    def owner(self, sql):
        ok, out = self.pg.psql(sql)
        self.assertTrue(ok, out)
        return out

    def as_role(self, role, sql, uid=None):
        """Runs `sql` as the browser would: role anon or authenticated, signed in as `uid`. Returns (ok, output)."""
        claim = f"select set_config('request.jwt.claim.sub', '{uid}', true);" if uid else ""
        return self.pg.psql(f"begin;\nset local role {role};\n\\o /dev/null\nselect 1; {claim}\n\\o\n{sql}\ncommit;")

    def as_user(self, uid, sql):
        return self.as_role("authenticated", sql, uid)

    def denied(self, result):
        ok, out = result
        self.assertFalse(ok, f"expected a refusal, got: {out}")
        self.assertIn("permission denied", out)

    # A first sign-in

    def test_a_first_sign_in_gets_emails_off_the_free_plan_and_no_allowance(self):
        out = self.owner(f"select email_opt_in, email_opt_in_changed_at is null from profiles where id = '{ADA}';")
        self.assertEqual(out, "f|t")
        self.assertEqual(self.owner(f"select plan from plans where user_id = '{ADA}';"), "free")
        self.assertEqual(self.owner(f"select used_micro_usd, limit_micro_usd from ai_allowance where user_id = '{ADA}';"), "0|0")

    # Reading

    def test_a_person_reads_only_their_own_profile_and_plan(self):
        self.assertEqual(self.as_user(ADA, "select id from profiles;"), (True, ADA))
        self.assertEqual(self.as_user(ADA, "select user_id from plans;"), (True, ADA))
        self.assertEqual(self.as_user(BO, f"select count(*) from profiles where id = '{ADA}';"), (True, "0"))

    def test_nobody_signed_in_reads_nothing(self):
        for table in ["profiles", "plans", "ai_allowance"]:
            self.denied(self.as_role("anon", f"select * from {table};"))
        # Signed in as the browser role but with no person in the token: no rows.
        self.assertEqual(self.as_role("authenticated", "select count(*) from profiles;"), (True, "0"))

    def test_the_allowance_table_is_never_read_directly(self):
        self.denied(self.as_user(ADA, "select * from ai_allowance;"))

    # Changing

    def test_the_email_choice_is_the_only_thing_a_person_can_change_and_it_is_stamped(self):
        ok, _ = self.as_user(ADA, "update profiles set email_opt_in = true;")
        self.assertTrue(ok)
        self.assertEqual(self.owner(f"select email_opt_in, email_opt_in_changed_at is not null from profiles where id = '{ADA}';"), "t|t")
        self.assertEqual(self.owner(f"select email_opt_in from profiles where id = '{BO}';"), "f", "Bo's row is untouched")
        self.denied(self.as_user(ADA, "update profiles set created_at = now() - interval '1 year';"))
        self.denied(self.as_user(ADA, "update profiles set email_opt_in_changed_at = now() - interval '1 year';"))
        self.denied(self.as_user(ADA, f"update profiles set id = '{uuid.uuid4()}';"))

    def test_the_consent_stamp_moves_only_when_the_choice_changes(self):
        self.as_user(ADA, "update profiles set email_opt_in = true;")
        first = self.owner(f"select email_opt_in_changed_at from profiles where id = '{ADA}';")
        self.as_user(ADA, "update profiles set email_opt_in = true;")
        self.assertEqual(self.owner(f"select email_opt_in_changed_at from profiles where id = '{ADA}';"), first)
        self.as_user(ADA, "update profiles set email_opt_in = false;")
        self.assertNotEqual(self.owner(f"select email_opt_in_changed_at from profiles where id = '{ADA}';"), first)

    def test_a_person_cannot_change_someone_elses_email_choice(self):
        self.assertEqual(self.as_user(ADA, f"update profiles set email_opt_in = true where id = '{BO}' returning id;"), (True, ""))
        self.assertEqual(self.owner(f"select email_opt_in from profiles where id = '{BO}';"), "f")

    def test_a_person_cannot_give_themselves_pro_or_more_allowance(self):
        self.denied(self.as_user(ADA, "update plans set plan = 'pro';"))
        self.denied(self.as_user(ADA, f"insert into plans (user_id, plan) values ('{uuid.uuid4()}', 'pro');"))
        self.denied(self.as_user(ADA, "update ai_allowance set limit_micro_usd = 999999999;"))
        self.denied(self.as_user(ADA, "delete from plans;"))
        self.denied(self.as_user(ADA, "insert into profiles (id) values (gen_random_uuid());"))
        self.assertEqual(self.owner(f"select plan from plans where user_id = '{ADA}';"), "free")

    def test_only_the_three_plans_exist(self):
        ok, out = self.pg.psql(f"update plans set plan = 'gold' where user_id = '{ADA}';")
        self.assertFalse(ok)
        self.assertIn("check constraint", out)

    # The allowance as a percentage

    def allowance(self, used, limit):
        self.owner(f"update ai_allowance set used_micro_usd = {used}, limit_micro_usd = {limit} where user_id = '{ADA}';")
        return self.as_user(ADA, "select my_allowance();")[1]

    def test_the_allowance_percentage_worked_by_hand(self):
        # Limit 9,000,000 (US$9). 7,199,999 / 9,000,000 = 79.99...% -> 79 (rounded down: no warning yet);
        # 7,200,000 -> exactly 80 (the warning shows); 2,500,000 -> 27.7...% -> 27; 0 -> 0.
        self.assertEqual(self.allowance(7_199_999, 9_000_000), "79")
        self.assertEqual(self.allowance(7_200_000, 9_000_000), "80")
        self.assertEqual(self.allowance(2_500_000, 9_000_000), "27")
        self.assertEqual(self.allowance(0, 9_000_000), "0")
        # Over the limit (a request already under way when it ran out) still shows 100, never more.
        self.assertEqual(self.allowance(9_000_001, 9_000_000), "100")
        # No allowance at all (the free plan): nothing to show.
        self.assertEqual(self.allowance(0, 0), "")

    def test_the_allowance_of_a_person_is_theirs_alone(self):
        self.owner(f"update ai_allowance set used_micro_usd = 1, limit_micro_usd = 2 where user_id = '{BO}';")
        self.assertEqual(self.as_user(ADA, "select my_allowance();"), (True, ""))
        self.denied(self.as_role("anon", "select my_allowance();"))

    # Seeing and deleting one's data

    def test_my_data_holds_everything_kept_about_the_person_and_nothing_about_others(self):
        ok, out = self.as_user(ADA, "select my_data()->'account'->>'email', my_data()->'plan'->>'plan', my_data()->'profile'->>'email_opt_in', my_data()::text like '%bo@example.com%';")
        self.assertEqual((ok, out), (True, "ada@example.com|free|false|f"))
        self.denied(self.as_role("anon", "select my_data();"))

    def test_my_data_includes_what_google_sent_at_sign_in(self):
        # The privacy page says sign-in keeps what Google sends (name, email, Google's ID, a picture link): Download my data must show it.
        self.owner(f"""update auth.users set last_sign_in_at = '2026-11-04 10:00+00', raw_user_meta_data = '{{"full_name": "Ada Maker", "avatar_url": "https://lh3.example/a.png", "sub": "1234"}}' where id = '{ADA}';""")
        ok, out = self.as_user(ADA, "select my_data()->'account'->'from_google'->>'avatar_url', my_data()->'account'->>'last_sign_in_at' is not null;")
        self.assertEqual((ok, out), (True, "https://lh3.example/a.png|t"))

    def test_delete_my_account_removes_every_row_of_that_person_and_no_one_elses(self):
        self.assertTrue(self.as_user(ADA, "select delete_my_account();")[0])
        for table, key in [("auth.users", "id"), ("profiles", "id"), ("plans", "user_id"), ("ai_allowance", "user_id")]:
            self.assertEqual(self.owner(f"select count(*) from {table} where {key} = '{ADA}';"), "0", table)
            self.assertEqual(self.owner(f"select count(*) from {table} where {key} = '{BO}';"), "1", table)

    def test_delete_my_account_needs_someone_signed_in(self):
        self.denied(self.as_role("anon", "select delete_my_account();"))
        ok, out = self.as_role("authenticated", "select delete_my_account();")
        self.assertFalse(ok)
        self.assertIn("not signed in", out)
        self.assertEqual(self.owner("select count(*) from auth.users;"), "2")

    def test_the_inner_functions_cannot_be_called_from_the_browser(self):
        self.denied(self.as_user(ADA, "select new_account();"))

    # Every table is covered

    def test_every_public_table_has_row_level_security_and_no_grant_to_nobody(self):
        out = self.owner("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;")
        self.assertEqual(out, "", "a table without row level security")
        out = self.owner("select table_name || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';")
        self.assertEqual(out, "", "a grant to people who are not signed in")


if __name__ == "__main__":
    unittest.main()
