"""Community testers (supabase/migrations/20261115120000_community_testers.sql), checked on a real PostgreSQL.

Same throwaway cluster and roles as test_database.py. Sharing's switch stays as migrated (off) in every test here
unless one turns it on. Ada and Bo are testers, Cy is a signed-in person who is not, and anon is anyone signed out.
The point: testers can use every community feature among themselves, and nothing they share, publish or like can be
opened, listed, downloaded, reported or liked by anyone off the list, who sees exactly what they saw before.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import os
import unittest

from test_database import ADA, BO, HERE, MIGRATIONS, Cluster

CY = "33333333-3333-4333-8333-333333333333"


class CommunityTesters(unittest.TestCase):
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
        for uid, email in [(ADA, "ada@example.com"), (BO, "bo@example.com"), (CY, "cy@example.com")]:
            self.owner(f"insert into auth.users (id, email) values ('{uid}', '{email}');")
        for uid, name, key in [(ADA, "Ada Maker", "adamaker"), (BO, "Bo Builds", "bobuilds"), (CY, "Cy Cuts", "cycuts")]:
            self.owner(f"insert into display_names (user_id, name, name_key) values ('{uid}', '{name}', '{key}');")
        # The owner's dashboard step, as the migration's comment gives it.
        for email in ["ada@example.com", "bo@example.com"]:
            self.owner(f"insert into public.community_testers (user_id) select id from auth.users where email = '{email}';")

    def owner(self, sql):
        ok, out = self.pg.psql(sql)
        self.assertTrue(ok, out)
        return out

    def as_role(self, role, sql, uid=None):
        claim = f"select set_config('request.jwt.claim.sub', '{uid}', true);" if uid else ""
        return self.pg.psql(f"begin;\nset local role {role};\n\\o /dev/null\nselect 1; {claim}\n\\o\n{sql}\ncommit;")

    def value(self, sql, uid=None, role="authenticated"):
        ok, out = self.as_role(role, sql, uid)
        self.assertTrue(ok, out)
        return out

    def denied(self, result):
        ok, out = result
        self.assertFalse(ok, f"expected a refusal, got: {out}")
        self.assertIn("permission denied", out)

    def share(self, uid):
        return json.loads(self.value("select share_design('Box', '{\"name\":\"Box\"}', null);", uid))

    def open_as(self, link, uid=None, role="authenticated"):
        out = self.value(f"select open_share('{link}');", uid, role)
        return json.loads(out) if out else None

    def begin(self, uid):
        return json.loads(self.value("select begin_publish('Bracket', 'An L bracket.', 'CC-BY-4.0', array['bracket']::text[], null);", uid))

    def publish(self, uid):
        b = self.begin(uid)
        self.assertEqual(b["status"], "ready", b)
        ok, out = self.as_role("authenticated", f"insert into storage.objects (bucket_id, name, owner_id, metadata) values ('library', '{b['file']}', '{uid}', jsonb_build_object('size', 1000, 'mimetype', 'application/json'));", uid)
        self.assertTrue(ok, out)
        self.assertEqual(self.value(f"select finish_publish('{b['id']}');", uid), "live")
        return b["id"]

    def browse(self, uid=None, role="anon"):
        out = self.value("select browse_library('', null, null, null, 48);", uid, role)
        return None if out == "" else json.loads(out)

    def can_read(self, entry, uid=None, role="authenticated"):
        out = self.value(f"select count(*) from storage.objects where bucket_id = 'library' and name = '{entry}.spindle';", uid, role)
        return out == "1"

    # Hand-worked: the whole story of one tester's link, worked out from the migration's rule
    # ("on when the switch is on, or when the person asking is a tester"): switch off, so for each caller the answer is
    # simply "are they on the list?". Ada yes, Bo yes, Cy no, anon (no account) no.

    def test_a_testers_link_opens_for_testers_and_for_nobody_else(self):
        self.assertEqual(self.owner("select sharing_on from share_switch;"), "f")  # the switch was never touched
        r = self.share(ADA)
        self.assertEqual(r["status"], "shared")  # Ada is a tester: she may share
        link = r["id"]
        self.assertEqual(self.open_as(link, ADA)["name"], "Box")  # Ada: tester
        self.assertEqual(self.open_as(link, BO)["name"], "Box")  # Bo: tester
        self.assertIsNone(self.open_as(link, CY))  # Cy: signed in, not a tester: as if no link
        self.assertIsNone(self.open_as(link, role="anon"))  # signed out: as if no link

    def test_someone_off_the_list_sees_exactly_what_they_saw_before(self):
        self.assertEqual(self.share(CY)["status"], "off")
        link = self.share(ADA)["id"]
        self.assertEqual(self.value(f"select report_share('{link}', 'copied', 'it copies mine');", CY), "off")
        self.assertEqual(self.value(f"select report_share('{link}', 'copied', 'it copies mine');", role="anon"), "off")
        self.assertEqual(self.value(f"select like_share('{link}');", CY), "off")
        self.assertEqual(self.value(f"select like_count('{link}');", role="anon"), "")
        self.assertEqual(self.value(f"select like_count('{link}');", CY), "")
        self.assertEqual(self.begin(CY)["status"], "off")

    def test_testers_report_and_like_each_others_links(self):
        link = self.share(ADA)["id"]
        self.assertEqual(self.value(f"select like_share('{link}');", BO), "liked")
        self.assertEqual(self.value(f"select like_count('{link}');", BO), "1")
        self.assertEqual(self.value(f"select report_share('{link}', 'copied', 'testing reports');", BO), "kept")

    def test_a_testers_library_entry_is_listed_and_downloaded_by_testers_only(self):
        entry = self.publish(ADA)
        self.assertEqual([e["id"] for e in self.browse(BO, "authenticated")], [entry])
        self.assertTrue(self.can_read(entry, BO))
        self.assertIsNone(self.browse())  # signed out: the library is closed
        self.assertIsNone(self.browse(CY, "authenticated"))
        self.assertFalse(self.can_read(entry, CY))
        self.assertFalse(self.can_read(entry, role="anon"))

    # Friends waits on the same legal items.

    def test_only_testers_can_turn_friends_on(self):
        self.assertEqual(self.value("select set_friends(true);", ADA), "on")
        self.assertEqual(self.value("select set_friends(true);", CY), "not-yet")
        self.assertEqual(self.owner(f"select count(*) from friend_codes where user_id = '{CY}';"), "0")
        self.assertEqual(self.value("select set_friends(false);", CY), "off")  # off always works

    def test_someone_already_on_stays_on_and_can_turn_off(self):
        # Cy turned Friends on before this migration (made here as the owner would find it).
        self.owner(f"select friend_code_give('{CY}');")
        self.assertEqual(self.value("select set_friends(true);", CY), "on")
        self.assertEqual(self.value("select set_friends(false);", CY), "off")
        self.assertEqual(self.value("select set_friends(true);", CY), "not-yet")

    def test_a_held_tester_is_still_held(self):
        self.owner(f"set role service_role; select hold_account('{BO}', null, 'test', false, 'mod', ''); reset role;")
        self.assertEqual(self.value("select set_friends(true);", BO), "held")
        self.assertEqual(self.share(BO)["status"], "held")

    # The list itself

    def test_the_browser_can_neither_read_nor_change_the_list(self):
        for role, uid in [("anon", None), ("authenticated", CY), ("authenticated", ADA)]:
            self.denied(self.as_role(role, "select count(*) from community_testers;", uid))
            self.denied(self.as_role(role, f"insert into community_testers (user_id) values ('{CY}');", uid))
            self.denied(self.as_role(role, f"delete from community_testers where user_id = '{ADA}';", uid))
            self.denied(self.as_role(role, "select sharing_on();", uid))
        self.assertEqual(self.owner("select count(*) from community_testers;"), "2")

    def test_taking_a_tester_off_the_list_closes_everything_they_shared_again(self):
        link = self.share(ADA)["id"]
        self.owner("delete from community_testers where user_id = (select id from auth.users where email = 'bo@example.com');")
        self.assertIsNone(self.open_as(link, BO))
        self.assertEqual(self.share(BO)["status"], "off")
        self.owner("delete from community_testers where user_id = (select id from auth.users where email = 'ada@example.com');")
        self.assertIsNone(self.open_as(link, ADA))
        self.assertEqual(self.value("select set_friends(true);", ADA), "not-yet")

    def test_deleting_a_testers_account_takes_them_off_the_list(self):
        self.owner(f"delete from auth.users where id = '{ADA}';")
        self.assertEqual(self.owner("select count(*) from community_testers;"), "1")

    def test_the_server_itself_is_no_tester(self):
        self.assertEqual(self.owner("set role service_role; select public.sharing_on(); reset role;").splitlines()[0], "f")

    # Once sharing opens for everyone, the list no longer matters.

    def test_turning_sharing_on_opens_it_for_everyone_as_before(self):
        link = self.share(ADA)["id"]
        self.owner("select set_sharing(true);")
        self.assertEqual(self.open_as(link, CY)["name"], "Box")
        self.assertEqual(self.open_as(link, role="anon")["name"], "Box")
        self.assertEqual(self.share(CY)["status"], "shared")
        self.assertEqual(self.value("select set_friends(true);", CY), "on")


if __name__ == "__main__":
    unittest.main()
