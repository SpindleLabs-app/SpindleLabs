"""My designs (supabase/migrations/20261105120000_my_designs.sql), checked on a real PostgreSQL.

Same throwaway cluster and roles as test_database.py. The point of most tests here is that one person can never
read, change or delete another person's designs, that the size and space limits hold at 0.9x and refuse at 1.1x,
and that two devices saving the same design never silently overwrite each other.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import os
import unittest
import uuid

from test_database import ADA, BO, HERE, MIGRATIONS, Cluster

MIB = 1024 * 1024
PNG = "data:image/png;base64,"


class DesignsDatabase(unittest.TestCase):
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
        for uid, email in [(ADA, "ada@example.com"), (BO, "bo@example.com")]:
            self.owner(f"insert into auth.users (id, email) values ('{uid}', '{email}');")

    def owner(self, sql):
        ok, out = self.pg.psql(sql)
        self.assertTrue(ok, out)
        return out

    def as_role(self, role, sql, uid=None):
        claim = f"select set_config('request.jwt.claim.sub', '{uid}', true);" if uid else ""
        return self.pg.psql(f"begin;\nset local role {role};\n\\o /dev/null\nselect 1; {claim}\n\\o\n{sql}\ncommit;")

    def as_user(self, uid, sql):
        return self.as_role("authenticated", sql, uid)

    def denied(self, result):
        ok, out = result
        self.assertFalse(ok, f"expected a refusal, got: {out}")
        self.assertIn("permission denied", out)

    def save(self, uid, body="'{}'", design_id=None, expected=None, name="Box", source="design", picture="null"):
        """save_design as `uid`; `body` and `picture` are SQL expressions. Returns the answer as a dict."""
        did = f"'{design_id}'" if design_id else "null"
        exp = str(expected) if expected is not None else "null"
        ok, out = self.as_user(uid, f"select save_design({did}, {exp}, '{name}', '{source}', {body}, {picture}, '2026-11-05 09:00+00');")
        self.assertTrue(ok, out)
        return json.loads(out)

    # Saving and reading one's own

    def test_a_new_design_is_saved_listed_and_read_back_whole(self):
        r = self.save(ADA, body="'{\"name\":\"Box\"}'", picture=f"'{PNG}iVBORw0KGgo='")
        self.assertEqual((r["status"], r["revision"]), ("saved", 1))
        ok, out = self.as_user(ADA, "select name, source, picture, revision from my_designs();")
        self.assertEqual((ok, out), (True, f"Box|design|{PNG}iVBORw0KGgo=|1"))
        ok, out = self.as_user(ADA, f"select get_design('{r['id']}')->>'body';")
        self.assertEqual((ok, out), (True, '{"name":"Box"}'))

    def test_the_list_never_carries_the_file_text(self):
        self.save(ADA, body="'SECRET-FILE-TEXT'")
        ok, out = self.as_user(ADA, "select to_jsonb(d)::text from my_designs() d;")
        self.assertTrue(ok, out)
        self.assertNotIn("SECRET-FILE-TEXT", out)

    def test_a_save_over_a_design_bumps_its_revision_and_a_null_picture_keeps_the_old_one(self):
        r = self.save(ADA, picture=f"'{PNG}AAAA'")
        r2 = self.save(ADA, design_id=r["id"], expected=1, name="Box 2", source="slice")
        self.assertEqual((r2["status"], r2["revision"], r2["id"]), ("saved", 2, r["id"]))
        self.assertEqual(self.as_user(ADA, "select name, source, picture from my_designs();"), (True, f"Box 2|slice|{PNG}AAAA"))

    # Other people

    def test_another_person_cannot_list_read_change_or_delete_your_designs(self):
        r = self.save(ADA, body="'ADA-ONLY'")
        self.assertEqual(self.as_user(BO, "select count(*) from my_designs();"), (True, "0"))
        self.assertEqual(self.as_user(BO, f"select get_design('{r['id']}') is null;"), (True, "t"))
        self.assertEqual(self.save(BO, design_id=r["id"], expected=1, body="'BO-WAS-HERE'")["status"], "gone")
        self.assertEqual(self.as_user(BO, f"select delete_design('{r['id']}');"), (True, "f"))
        self.assertEqual(self.as_user(BO, "select delete_my_designs();"), (True, "0"))
        self.assertEqual(self.owner(f"select body, revision from designs where id = '{r['id']}';"), "ADA-ONLY|1")
        ok, out = self.as_role("postgres", "select my_data()::text;", BO)
        self.assertTrue(ok)
        self.assertNotIn("ADA-ONLY", out)

    def test_the_table_itself_is_closed_to_the_browser(self):
        self.save(ADA)
        for sql in ["select * from designs;", f"insert into designs (user_id, name, source, body, saved_at) values ('{ADA}', 'x', 'design', '{{}}', now());", "update designs set name = 'x';", "delete from designs;"]:
            self.denied(self.as_user(ADA, sql))
            self.denied(self.as_role("anon", sql))

    def test_nobody_signed_in_can_use_any_design_function(self):
        for sql in ["select my_designs();", f"select get_design('{uuid.uuid4()}');", f"select delete_design('{uuid.uuid4()}');", "select delete_my_designs();", "select my_design_space();", "select design_limits();", "select save_design(null, null, 'x', 'design', '{}', null, now());"]:
            self.denied(self.as_role("anon", sql))
        # The browser's signed-in role with no person in the token gets nothing.
        ok, out = self.as_role("authenticated", "select save_design(null, null, 'x', 'design', '{}', null, now());")
        self.assertFalse(ok)
        self.assertIn("not signed in", out)

    def test_a_person_cannot_save_a_design_into_someone_elses_account(self):
        # user_id always comes from the sign-in, never from the request: there is no parameter for it.
        self.save(BO)
        self.assertEqual(self.owner(f"select count(*) from designs where user_id = '{BO}';"), "1")
        self.assertEqual(self.owner(f"select count(*) from designs where user_id = '{ADA}';"), "0")

    # Two devices

    def test_two_devices_saving_the_same_design_never_overwrite_each_other(self):
        r = self.save(ADA, body="'first'")
        # Device A and device B both last saw revision 1. B saves first.
        b = self.save(ADA, design_id=r["id"], expected=1, body="'from B'")
        self.assertEqual(b["revision"], 2)
        a = self.save(ADA, design_id=r["id"], expected=1, body="'from A'")
        self.assertEqual(a, {"status": "changed", "revision": 2})
        self.assertEqual(self.owner(f"select body from designs where id = '{r['id']}';"), "from B")

    def test_a_deleted_design_is_gone_not_brought_back(self):
        r = self.save(ADA)
        self.assertEqual(self.as_user(ADA, f"select delete_design('{r['id']}');"), (True, "t"))
        self.assertEqual(self.save(ADA, design_id=r["id"], expected=1)["status"], "gone")
        self.assertEqual(self.owner("select count(*) from designs;"), "0")

    # Limits (0.9x saves, 1.1x is refused)

    def test_one_design_up_to_5_mib(self):
        # 0.9 x 5 MiB = 4,718,592 bytes saves; 1.1 x = 5,767,168 bytes is refused and nothing is written.
        self.assertEqual(self.save(ADA, body="repeat('x', 4718592)")["status"], "saved")
        self.assertEqual(self.save(ADA, body="repeat('x', 5767168)")["status"], "too-big")
        self.assertEqual(self.owner("select count(*) from designs;"), "1")

    def test_a_picture_up_to_32_kib(self):
        # The picture's whole data: address counts. 0.9 x 32,768 = 29,491 bytes; 1.1 x = 36,044.
        head = len(PNG)
        self.assertEqual(self.save(ADA, picture=f"'{PNG}' || repeat('A', {29491 - head})")["status"], "saved")
        self.assertEqual(self.save(ADA, picture=f"'{PNG}' || repeat('A', {36044 - head})")["status"], "too-big")

    def test_a_picture_must_be_an_image_data_address(self):
        for bad in ["'https://tracker.example/p.png'", "'data:text/html;base64,PHNjcmlwdD4='", f"'{PNG}<script>'"]:
            ok, out = self.as_user(ADA, f"select save_design(null, null, 'x', 'design', '{{}}', {bad}, now());")
            self.assertFalse(ok, bad)
            self.assertIn("check constraint", out)

    def test_the_space_is_20_mib_worked_by_hand(self):
        # Four designs of 4.5 MiB = 18 MiB = 0.9 x 20 MiB: all save.
        for _ in range(4):
            self.assertEqual(self.save(ADA, body="repeat('x', 4718592)")["status"], "saved")
        # A fifth of 4 MiB would make 22 MiB = 1.1 x 20 MiB: refused.
        self.assertEqual(self.save(ADA, body="repeat('x', 4194304)")["status"], "full")
        # Making one existing design bigger counts only the difference: 18 - 4.5 + 5 = 18.5 MiB fits.
        some = self.owner(f"select id from designs where user_id = '{ADA}' limit 1;")
        self.assertEqual(self.save(ADA, design_id=some, expected=1, body="repeat('x', 5242880)")["status"], "saved")
        space = json.loads(self.as_user(ADA, "select my_design_space();")[1])
        self.assertEqual((space["designs"], space["bytes"], space["max_bytes"]), (4, 3 * 4718592 + 5242880 + 0, 20971520))
        # Bo's space is his own.
        self.assertEqual(self.save(BO, body="repeat('x', 4194304)")["status"], "saved")

    def test_at_most_200_designs(self):
        self.owner(f"insert into designs (user_id, name, source, body, saved_at) select '{ADA}', 'd' || i, 'design', '{{}}', now() from generate_series(1, 199) i;")
        self.assertEqual(self.save(ADA)["status"], "saved")  # the 200th
        self.assertEqual(self.save(ADA)["status"], "full")  # the 201st
        some = self.owner(f"select id from designs where user_id = '{ADA}' limit 1;")
        self.assertEqual(self.save(ADA, design_id=some, expected=1)["status"], "saved", "saving over one still works when full")

    def test_only_known_workspaces_are_tags(self):
        ok, out = self.as_user(ADA, "select save_design(null, null, 'x', 'spreadsheet', '{}', null, now());")
        self.assertFalse(ok)
        self.assertIn("check constraint", out)

    # Keeping designs off

    def test_keeping_designs_is_on_by_default_and_off_stops_every_save(self):
        self.assertEqual(self.as_user(ADA, "select keep_designs from profiles;"), (True, "t"))
        r = self.save(ADA)
        self.assertTrue(self.as_user(ADA, "update profiles set keep_designs = false;")[0])
        self.assertEqual(self.save(ADA)["status"], "off")
        self.assertEqual(self.save(ADA, design_id=r["id"], expected=1)["status"], "off")
        self.assertEqual(self.save(BO)["status"], "saved", "Bo's choice is his own")

    def test_a_person_cannot_change_someone_elses_keep_choice(self):
        self.assertEqual(self.as_user(ADA, f"update profiles set keep_designs = false where id = '{BO}' returning id;"), (True, ""))
        self.assertEqual(self.owner(f"select keep_designs from profiles where id = '{BO}';"), "t")

    def test_delete_my_designs_empties_only_the_persons_own(self):
        self.save(ADA)
        self.save(ADA)
        self.save(BO)
        self.assertEqual(self.as_user(ADA, "select delete_my_designs();"), (True, "2"))
        self.assertEqual(self.owner("select count(*) from designs;"), "1")

    # Seeing and deleting everything

    def test_my_data_holds_every_design_whole(self):
        self.save(ADA, body="'{\"the\":\"file\"}'", name="Bracket", source="slice")
        data = json.loads(self.as_role("postgres", "select my_data();", ADA)[1])
        self.assertEqual([(d["name"], d["source"], d["file"]) for d in data["designs"]], [("Bracket", "slice", '{"the":"file"}')])
        self.assertTrue(data["profile"]["keep_designs"])
        empty = json.loads(self.as_role("postgres", "select my_data();", BO)[1])
        self.assertEqual(empty["designs"], [])

    def test_my_data_takes_every_part_so_a_new_feature_never_drops_another(self):
        # A later feature adds its own my_data_part_<name>(); my_data() is never replaced again.
        self.owner("create function public.my_data_part_zz_test() returns jsonb language sql stable as $$ select jsonb_build_object('zz', auth.uid()) $$;")
        data = json.loads(self.as_role("postgres", "select my_data();", ADA)[1])
        self.assertEqual((data["zz"], data["designs"], data["account"]["email"]), (ADA, [], "ada@example.com"))
        # A part made by anyone but the migrations' owner is never run.
        self.owner("create role intruder; grant create on schema public to intruder;")
        self.owner("set role intruder; create function public.my_data_part_evil() returns jsonb language sql as $$ select '{\"evil\": true}'::jsonb $$; reset role;")
        self.assertNotIn("evil", self.as_role("postgres", "select my_data();", ADA)[1])
        self.owner("drop function public.my_data_part_evil(); revoke create on schema public from intruder; drop role intruder;")
        self.denied(self.as_role("anon", "select my_data();"))
        self.denied(self.as_role("anon", "select download_my_data();"))
        self.assertEqual(self.as_role("authenticated", "select download_my_data() is null;"), (True, "t"), "nobody in the token: nothing")

    # Download my data, at most once a minute and 5 times a day (security hunt 2026-11-13 A1: one call on a full
    # account holds 130-195 MB of the database's memory, so calls side by side or one after another could run it out)

    def download(self, uid):
        ok, out = self.as_user(uid, "select download_my_data();")
        self.assertTrue(ok, out)
        return json.loads(out)

    def test_the_browser_downloads_through_the_limit_only(self):
        self.denied(self.as_user(ADA, "select my_data();"))
        self.save(ADA, body="'{\"the\":\"file\"}'", name="Bracket")
        got = self.download(ADA)
        want = json.loads(self.as_role("postgres", "select my_data();", ADA)[1])
        got["data_downloads"] = want["data_downloads"] = None  # this download itself is in one and not the other
        self.assertEqual(got, want, "everything my_data() gives the person")

    def test_a_second_download_within_a_minute_waits(self):
        self.assertIn("account", self.download(ADA))
        second = self.download(ADA)
        self.assertEqual(second["status"], "wait")
        self.assertEqual(sorted(second), ["retry_at", "status"], "nothing else, so it holds no memory")
        self.assertIn("account", self.download(BO), "one person's limit is theirs alone")
        # The gap at 0.9x and 1.1x of 60 s: 54 s ago still waits, 66 s ago may download, retry_at a minute after the last.
        self.owner(f"update data_downloads set at = now() - interval '54 seconds' where user_id = '{ADA}';")
        wait = self.download(ADA)
        self.assertEqual(wait["status"], "wait")
        self.assertEqual(self.owner(f"select '{wait['retry_at']}'::timestamptz - (select at from data_downloads where user_id = '{ADA}') = interval '60 seconds';"), "t")
        self.owner(f"update data_downloads set at = now() - interval '66 seconds' where user_id = '{ADA}';")
        self.assertIn("account", self.download(ADA))

    def test_five_downloads_a_day_at_0_9x_and_1_1x(self):
        # Four made 21.6 h ago (0.9 x 24 h) still count with one now: the sixth of the day waits even a minute later.
        self.owner(f"insert into data_downloads (user_id, at) select '{ADA}', now() - interval '21.6 hours' from generate_series(1, 4);")
        self.assertIn("account", self.download(ADA))
        self.owner(f"update data_downloads set at = at - interval '61 seconds' where user_id = '{ADA}';")
        self.assertEqual(self.download(ADA)["status"], "wait", "five today already")
        # Made 26.4 h ago (1.1 x 24 h) they no longer count, and are deleted.
        self.owner(f"update data_downloads set at = now() - interval '26.4 hours' where user_id = '{ADA}' and at < now() - interval '1 hour';")
        self.assertIn("account", self.download(ADA))
        self.assertEqual(self.owner(f"select count(*) from data_downloads where user_id = '{ADA}';"), "2")

    def test_two_downloads_at_the_same_moment_build_only_one(self):
        first = self.pg.start_as("authenticated", "select download_my_data() ? 'account'; select pg_sleep(1.5);", ADA)
        self.pg.wait_for_sleep()
        second = self.pg.start_as("authenticated", "select coalesce(download_my_data()->>'status', 'data');", ADA)
        out1, err1 = first.communicate(timeout=30)
        out2, err2 = second.communicate(timeout=30)
        self.assertEqual((out1.split()[0], out2.split()[0]), ("t", "wait"), err1 + err2)

    def test_the_download_times_are_the_persons_own(self):
        self.download(ADA)
        self.denied(self.as_user(ADA, "select * from data_downloads;"))
        self.denied(self.as_role("anon", "select * from data_downloads;"))
        self.assertEqual(len(json.loads(self.as_role("postgres", "select my_data();", ADA)[1])["data_downloads"]), 1)
        self.assertEqual(json.loads(self.as_role("postgres", "select my_data();", BO)[1])["data_downloads"], [])
        self.assertTrue(self.as_user(ADA, "select delete_my_account();")[0])
        self.assertEqual(self.owner("select count(*) from data_downloads;"), "0")

    def test_the_designs_part_is_not_callable_from_the_browser(self):
        self.denied(self.as_user(ADA, "select my_data_part_designs();"))
        self.denied(self.as_user(ADA, "select my_data_part_payments();"))

    def test_rebuilt_from_parts_my_data_keeps_every_key_it_had_before(self):
        # Before this migration (20261105000000_payments.sql) my_data gave account, profile, plan, payments and the
        # AI allowance; rebuilt from parts it must give each of them still, plus designs (and, from 20261105180000, their
        # versions), and nothing about Bo.
        data = json.loads(self.as_role("postgres", "select my_data();", ADA)[1])
        self.assertEqual(sorted(data), ["account", "account_hold", "ai_allowance_used_percent", "data_downloads", "design_versions", "designs", "display_name", "friends", "library", "likes", "moderation", "payments", "plan", "print_log", "profile", "settings", "share_reports", "shares"])
        self.assertIsNone(data["payments"], "no Stripe link yet: null, as before")
        self.owner(f"insert into billing (user_id, stripe_customer_id, status) values ('{ADA}', 'cus_Ada1', 'active'), ('{BO}', 'cus_Bo22', 'active');")
        data = json.loads(self.as_role("postgres", "select my_data();", ADA)[1])
        self.assertEqual((data["payments"]["stripe_customer_id"], data["payments"]["status"]), ("cus_Ada1", "active"))
        self.assertNotIn("cus_Bo22", json.dumps(data))

    def test_deleting_the_account_deletes_its_designs_and_no_one_elses(self):
        self.save(ADA)
        self.save(BO)
        self.assertTrue(self.as_user(ADA, "select delete_my_account();")[0])
        self.assertEqual(self.owner(f"select count(*) from designs where user_id = '{ADA}';"), "0")
        self.assertEqual(self.owner(f"select count(*) from designs where user_id = '{BO}';"), "1")


if __name__ == "__main__":
    unittest.main()
