"""Sharing links (supabase/migrations/20261111120000_shares.sql), checked on a real PostgreSQL.

Same throwaway cluster and roles as test_database.py. The point of most tests here is that anyone with a link can open
it but nobody can list or guess links, nobody but the person who shared it can turn it off, a turned-off or taken-down
link opens nothing and keeps no copy, every limit holds at 0.9x and refuses at 1.1x, and reports are kept and capped.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import os
import unittest
import uuid

from test_database import ADA, BO, HERE, MIGRATIONS, Cluster

MIB = 1024 * 1024
PNG = "data:image/png;base64,"


class SharesDatabase(unittest.TestCase):
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

    def share(self, uid, body="'{\"name\":\"Box\"}'", name="Box", picture="null"):
        """share_design as `uid`; `body` and `picture` are SQL expressions. Returns the answer as a dict."""
        ok, out = self.as_user(uid, f"select share_design('{name}', {body}, {picture});")
        self.assertTrue(ok, out)
        return json.loads(out)

    def open_as(self, role, link, uid=None):
        ok, out = self.as_role(role, f"select open_share('{link}');", uid)
        self.assertTrue(ok, out)
        return json.loads(out) if out else None

    def report(self, role, link, kind="copied", reason="'it copies my model'", uid=None):
        ok, out = self.as_role(role, f"select report_share('{link}', '{kind}', {reason});", uid)
        self.assertTrue(ok, out)
        return out

    # Sharing and opening

    def test_a_shared_copy_opens_for_anyone_with_the_link_signed_in_or_not(self):
        r = self.share(ADA, picture=f"'{PNG}iVBORw0KGgo='")
        self.assertEqual(r["status"], "shared")
        for role, uid in [("anon", None), ("authenticated", BO), ("authenticated", ADA)]:
            got = self.open_as(role, r["id"], uid)
            self.assertEqual((got["name"], got["body"], got["picture"]), ("Box", '{"name":"Box"}', f"{PNG}iVBORw0KGgo="))

    def test_opening_a_link_never_says_who_shared_it(self):
        r = self.share(ADA)
        got = self.open_as("anon", r["id"])
        self.assertEqual(sorted(got), ["body", "created_at", "id", "name", "picture"])
        self.assertNotIn(ADA, json.dumps(got))

    def test_a_link_that_never_was_opens_nothing(self):
        self.share(ADA)
        self.assertIsNone(self.open_as("anon", str(uuid.uuid4())))

    def test_the_tables_are_closed_to_the_browser(self):
        self.share(ADA)
        for sql in ["select * from public.shares;", "select * from public.share_reports;",
                    "insert into public.share_reports (share_id, kind, reason) values (gen_random_uuid(), 'other', '');"]:
            self.denied(self.as_role("anon", sql))
            self.denied(self.as_user(BO, sql))
            self.denied(self.as_user(ADA, sql))

    def test_nobody_signed_in_can_share_list_or_turn_off(self):
        r = self.share(ADA)
        for sql in ["select share_design('Box', 'x', null);", "select * from my_shares();", f"select unshare('{r['id']}');"]:
            self.denied(self.as_role("anon", sql))

    def test_only_the_server_can_take_a_link_down(self):
        r = self.share(ADA)
        self.denied(self.as_user(ADA, f"select remove_share('{r['id']}');"))
        self.denied(self.as_role("anon", f"select remove_share('{r['id']}');"))

    # Listing and turning off

    def test_my_links_lists_only_my_links_that_are_on_without_the_file_text(self):
        a1 = self.share(ADA, name="One", body="'SECRET-FILE-TEXT'")["id"]
        a2 = self.share(ADA, name="Two")["id"]
        self.share(BO, name="Theirs")
        self.as_user(ADA, f"select unshare('{a2}');")
        ok, out = self.as_user(ADA, "select to_jsonb(s)::text from my_shares() s;")
        self.assertTrue(ok, out)
        self.assertEqual([json.loads(line)["id"] for line in out.splitlines()], [a1])
        self.assertNotIn("SECRET-FILE-TEXT", out)

    def test_turning_a_link_off_stops_it_opening_and_deletes_its_copy(self):
        r = self.share(ADA, body="'SECRET'", picture=f"'{PNG}AAAA'")
        self.assertEqual(self.as_user(ADA, f"select unshare('{r['id']}');"), (True, "t"))
        self.assertIsNone(self.open_as("anon", r["id"]))
        self.assertEqual(self.owner(f"select body = '' and picture is null and bytes = 0 from public.shares where id = '{r['id']}';"), "t")
        self.assertEqual(self.as_user(ADA, f"select unshare('{r['id']}');"), (True, "f"))  # already off

    def test_nobody_else_can_turn_my_link_off(self):
        r = self.share(ADA)
        self.assertEqual(self.as_user(BO, f"select unshare('{r['id']}');"), (True, "f"))
        self.assertIsNotNone(self.open_as("anon", r["id"]))

    def test_a_link_taken_down_opens_nothing_and_its_owner_sees_why(self):
        r = self.share(ADA)
        self.assertEqual(self.pg.psql(f"set role service_role; select remove_share('{r['id']}');"), (True, "t"))
        self.assertIsNone(self.open_as("authenticated", r["id"], BO))
        ok, out = self.as_user(ADA, "select removed_at is not null from my_shares();")
        self.assertEqual((ok, out), (True, "t"))
        # Turning it off afterwards still deletes the copy.
        self.assertEqual(self.as_user(ADA, f"select unshare('{r['id']}');"), (True, "t"))
        self.assertEqual(self.owner(f"select body from public.shares where id = '{r['id']}';"), "")

    # Limits, each at 0.9x (allowed) and 1.1x (refused)

    def test_a_shared_file_of_up_to_5_mib(self):
        # 0.9 x 5 MiB = 4,718,592 bytes; 1.1 x 5 MiB = 5,767,168 bytes.
        self.assertEqual(self.share(ADA, body="repeat('x', 4718592)")["status"], "shared")
        self.assertEqual(self.share(ADA, body="repeat('x', 5767168)")["status"], "too-big")

    def test_an_empty_or_missing_file_is_refused(self):
        self.assertEqual(self.share(ADA, body="''")["status"], "too-big")
        self.assertEqual(self.share(ADA, body="null")["status"], "too-big")

    def test_a_picture_of_up_to_32_kib(self):
        # 0.9 x 32,768 = 29,491 bytes; 1.1 x 32,768 = 36,044 bytes, both counting the data: address's head.
        head = len(PNG)
        self.assertEqual(self.share(ADA, picture=f"'{PNG}' || repeat('A', {29491 - head})")["status"], "shared")
        self.assertEqual(self.share(ADA, picture=f"'{PNG}' || repeat('A', {36044 - head})")["status"], "too-big")

    def test_a_picture_that_is_not_an_image_address_is_refused(self):
        ok, out = self.as_user(ADA, "select share_design('Box', 'x', 'javascript:alert(1)');")
        self.assertFalse(ok)
        self.assertIn("shares_picture_check", out)

    def test_20_mib_of_links_that_are_on(self):
        # Four of 4.5 MiB = 18 MiB = 0.9 x 20 MiB: all fit. A fifth of 4 MiB would make 22 MiB = 1.1 x 20 MiB: full.
        for _ in range(4):
            self.assertEqual(self.share(ADA, body=f"repeat('x', {int(4.5 * MIB)})")["status"], "shared")
        self.assertEqual(self.share(ADA, body=f"repeat('x', {4 * MIB})")["status"], "full")
        # Someone else's space is their own.
        self.assertEqual(self.share(BO, body=f"repeat('x', {4 * MIB})")["status"], "shared")
        # Turning one off gives its room back.
        first = self.owner(f"select id from public.shares where user_id = '{ADA}' order by created_at limit 1;")
        self.as_user(ADA, f"select unshare('{first}');")
        self.assertEqual(self.share(ADA, body=f"repeat('x', {4 * MIB})")["status"], "shared")

    def backdate(self, uid, hours):
        self.owner(f"update public.shares set created_at = now() - interval '{hours} hours' where user_id = '{uid}';")

    def test_50_links_on_at_once(self):
        # 45 = 0.9 x 50 fit; then up to 50, and the 51st (on the way to 55 = 1.1 x 50) is refused. Made over days, so
        # the daily limit doesn't get there first.
        for i in range(50):
            if i % 15 == 0:
                self.backdate(ADA, 48)
            self.assertEqual(self.share(ADA)["status"], "shared", f"link {i + 1}")
        self.backdate(ADA, 48)
        self.assertEqual(self.share(ADA)["status"], "full")
        link = self.owner(f"select id from public.shares where user_id = '{ADA}' limit 1;")
        self.as_user(ADA, f"select unshare('{link}');")
        self.assertEqual(self.share(ADA)["status"], "shared")

    def test_20_new_links_a_day_counting_turned_off_ones(self):
        # 18 = 0.9 x 20 fit, then 19 and 20; the 21st (on the way to 22 = 1.1 x 20) is refused, even with all of them
        # turned off, so turning links off and on can't get round it.
        for i in range(20):
            self.assertEqual(self.share(ADA)["status"], "shared", f"link {i + 1}")
        self.owner(f"update public.shares set off_at = now(), body = '' where user_id = '{ADA}';")
        self.assertEqual(self.share(ADA)["status"], "daily")
        self.assertEqual(self.share(BO)["status"], "shared")

    def test_the_day_is_the_last_24_hours(self):
        # 20 links made 0.9 x 24 = 21.6 hours ago still count; made 1.1 x 24 = 26.4 hours ago they don't.
        for _ in range(20):
            self.share(ADA)
        self.backdate(ADA, 21.6)
        self.assertEqual(self.share(ADA)["status"], "daily")
        self.backdate(ADA, 26.4)
        self.assertEqual(self.share(ADA)["status"], "shared")

    # Reports

    def test_anyone_who_can_open_a_link_can_report_it_and_the_report_is_kept(self):
        r = self.share(ADA)
        self.assertEqual(self.report("anon", r["id"], kind="weapon", reason="'a gun part'"), "kept")
        self.assertEqual(self.report("authenticated", r["id"], uid=BO), "kept")
        rows = self.owner(f"select kind, reporter is null, reason from public.share_reports where share_id = '{r['id']}' order by id;")
        self.assertEqual(rows, f"weapon|t|a gun part\ncopied|f|it copies my model")

    def test_a_report_on_a_link_that_is_off_or_never_was_keeps_nothing(self):
        r = self.share(ADA)
        self.as_user(ADA, f"select unshare('{r['id']}');")
        self.assertEqual(self.report("anon", r["id"]), "gone")
        self.assertEqual(self.report("anon", str(uuid.uuid4())), "gone")
        self.assertEqual(self.owner("select count(*) from public.share_reports;"), "0")

    def test_a_report_must_name_one_of_the_kinds(self):
        r = self.share(ADA)
        self.assertEqual(self.report("anon", r["id"], kind="spam"), "bad")
        ok, out = self.as_role("anon", f"select report_share('{r['id']}', null, 'x');")
        self.assertEqual((ok, out), (True, "bad"))

    def test_a_reason_of_up_to_1000_characters(self):
        # 0.9 x 1000 = 900 kept; 1.1 x 1000 = 1100 refused. A missing reason is kept as empty.
        r = self.share(ADA)
        self.assertEqual(self.report("anon", r["id"], reason="repeat('é', 900)"), "kept")
        self.assertEqual(self.report("anon", r["id"], reason="repeat('é', 1100)"), "bad")
        self.assertEqual(self.report("anon", r["id"], reason="null"), "kept")

    def test_one_person_reports_a_link_at_most_5_times(self):
        r = self.share(ADA)
        for i in range(5):
            self.assertEqual(self.report("authenticated", r["id"], uid=BO), "kept", f"report {i + 1}")
        self.assertEqual(self.report("authenticated", r["id"], uid=BO), "enough")
        cy = "33333333-3333-4333-8333-333333333333"
        self.owner(f"insert into auth.users (id, email) values ('{cy}', 'cy@example.com');")
        self.assertEqual(self.report("authenticated", r["id"], uid=cy), "kept")

    def test_signed_out_reports_cannot_crowd_out_signed_in_ones(self):
        # Security review 2026-11-11: signed-out reports have no person to count by, so before this anyone could file
        # all 200 a link allows and every real report after got "enough". Signed-out reports now have their own
        # 20 a link; 0.9 x 20 = 18 kept, then 19 and 20, and the 21st (on the way to 22 = 1.1 x 20) refused.
        r = self.share(ADA)
        ok, out = self.as_role("anon", f"select count(*) filter (where report_share('{r['id']}', 'other', 'junk') = 'kept') from generate_series(1, 22);")
        self.assertEqual((ok, out), (True, "20"))
        self.assertEqual(self.report("authenticated", r["id"], kind="illegal", reason="'real'", uid=BO), "kept")

    def test_the_sharer_cannot_report_their_own_link(self):
        r = self.share(ADA)
        self.assertEqual(self.report("authenticated", r["id"], uid=ADA), "own")
        self.assertEqual(self.owner("select count(*) from public.share_reports;"), "0")

    def test_the_report_id_sequence_is_closed_to_the_browser(self):
        # Security review 2026-11-11: Supabase's default grants left it open, and moving it to its end breaks every
        # later report.
        for role in ["anon", "authenticated"]:
            self.denied(self.as_role(role, "select setval('public.share_reports_id_seq', 9223372036854775807);"))

    def test_one_person_reports_at_most_50_a_day_across_every_link(self):
        # Security review 2026-11-11: the 5 a link didn't stop one account filling the review list across many links.
        # 45 = 0.9 x 50 kept, then up to 50; the 51st (on the way to 55 = 1.1 x 50) refused; 24 hours later allowed.
        links = [self.share(ADA)["id"] for _ in range(11)]
        self.owner(f"update public.shares set created_at = now() - interval '2 days' where user_id = '{ADA}';")
        answers = [self.report("authenticated", links[i // 5], uid=BO) for i in range(55)]
        self.assertEqual(answers.count("kept"), 50)
        self.assertEqual(answers[50:], ["enough"] * 5)
        self.owner(f"update public.share_reports set created_at = now() - interval '25 hours' where reporter = '{BO}';")
        self.assertEqual(self.report("authenticated", links[10], uid=BO), "kept")

    def test_a_link_keeps_at_most_200_signed_in_reports(self):
        r = self.share(ADA)
        self.owner(f"insert into public.share_reports (share_id, reporter, kind, reason) select '{r['id']}', '{BO}', 'other', '' from generate_series(1, 199);")
        self.owner("insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'cy@example.com');")
        self.assertEqual(self.report("authenticated", r["id"], uid="33333333-3333-4333-8333-333333333333"), "kept")
        self.assertEqual(self.report("authenticated", r["id"], uid="33333333-3333-4333-8333-333333333333"), "enough")
        # Signed-out reports have their own count, so the link still takes those.
        self.assertEqual(self.report("anon", r["id"]), "kept")
        self.assertEqual(self.owner(f"select count(reporter), count(*) from public.share_reports where share_id = '{r['id']}';"), "200|201")

    # Download my data and deleting the account

    def test_my_data_holds_every_link_and_report_of_mine_and_nobody_elses(self):
        mine = self.share(ADA, body="'MY-FILE'")["id"]
        off = self.share(ADA)["id"]
        self.as_user(ADA, f"select unshare('{off}');")
        theirs = self.share(BO, body="'THEIR-FILE'")["id"]
        self.report("authenticated", theirs, kind="other", reason="'MY-REPORT'", uid=ADA)
        self.report("authenticated", mine, kind="other", reason="'THEIR-REPORT'", uid=BO)
        data = json.loads(self.as_user(ADA, "select my_data();")[1])
        self.assertEqual([(s["id"], s["file"]) for s in data["shares"]], [(mine, "MY-FILE"), (off, "")])
        self.assertEqual([r["reason"] for r in data["share_reports"]], ["MY-REPORT"])
        self.assertNotIn("THEIR", json.dumps(data))

    def test_deleting_the_account_deletes_its_links_and_forgets_who_reported_but_keeps_the_reports(self):
        mine = self.share(ADA)["id"]
        theirs = self.share(BO)["id"]
        self.report("authenticated", mine, uid=BO)
        self.report("authenticated", theirs, uid=ADA)
        ok, out = self.as_user(ADA, "select delete_my_account();")
        self.assertTrue(ok, out)
        self.assertIsNone(self.open_as("anon", mine))
        self.assertIsNotNone(self.open_as("anon", theirs))
        self.assertEqual(self.owner(f"select count(*) from public.shares where user_id = '{ADA}';"), "0")
        # Both reports stay as the record; Ada's report no longer says it was Ada.
        self.assertEqual(self.owner("select count(*), count(reporter) from public.share_reports;"), "2|1")


if __name__ == "__main__":
    unittest.main()
