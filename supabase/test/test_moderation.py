"""Moderation (supabase/migrations/20261111140000_moderation.sql), checked on a real PostgreSQL.

Same throwaway cluster and roles as test_database.py. These check that only the server can moderate, that the review
list counts open reports correctly, that each decision does exactly what it says and is kept in the record, that a
held account can't make links or change its name (and can still turn its links off), the hold's end at 0.9x and 1.1x
of its length, the takedown process, and what the person sees in Download my data.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import os
import unittest
import uuid

from test_database import ADA, BO, HERE, MIGRATIONS, Cluster


class ModerationDatabase(unittest.TestCase):
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

    def server(self, sql):
        ok, out = self.pg.psql(f"set role service_role; {sql}")
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

    def share(self, uid, name="Box"):
        ok, out = self.as_user(uid, f"select share_design('{name}', '{{}}', null);")
        self.assertTrue(ok, out)
        return json.loads(out)

    def report(self, link, kind="copied", uid=None):
        role = "authenticated" if uid else "anon"
        ok, out = self.as_role(role, f"select report_share('{link}', '{kind}', '');", uid)
        self.assertEqual((ok, out), (True, "kept"))

    def opens(self, link):
        ok, out = self.as_role("anon", f"select open_share('{link}') is not null;")
        self.assertTrue(ok, out)
        return out == "t"

    def queue(self):
        out = self.server("select share_id, open_reports, array_to_string(kinds, ',') from review_queue();")
        return [tuple(line.split("|")) for line in out.splitlines()] if out else []

    def log(self):
        out = self.server("select action, coalesce(share_id::text, ''), coalesce(user_id::text, ''), moderator from moderation_log order by id;")
        return [tuple(line.split("|")) for line in out.splitlines()] if out else []

    # Only the server

    def test_the_browser_can_neither_read_the_records_nor_moderate(self):
        link = self.share(ADA)["id"]
        for sql in ["select * from public.moderation_log;", "select * from public.account_holds;", "select * from public.takedown_claims;",
                    "select * from review_queue();", f"select decide_share('{link}', 'take-down', 'me', '');",
                    f"select moderate_name('{BO}', 'me', '');", f"select hold_account('{BO}', null, 'x', true, 'me', '');",
                    f"select end_hold('{ADA}', 'me', '');", f"select record_claim('{link}', 'a', 'b', 'c', 'me');",
                    "select decide_claim(1, 'rejected', 'me', '');", f"select account_held('{ADA}');"]:
            self.denied(self.as_role("anon", sql))
            self.denied(self.as_user(ADA, sql))

    def test_the_id_sequences_are_closed_to_the_browser(self):
        # As for share_reports (security review 2026-11-11): Supabase's default grants would let the browser move
        # them to their end and break every later decision or claim.
        for seq in ["moderation_log_id_seq", "takedown_claims_id_seq"]:
            for role in ["anon", "authenticated"]:
                self.denied(self.as_role(role, f"select setval('public.{seq}', 9223372036854775807);"))

    # The review list

    def test_the_review_list_worked_by_hand(self):
        # Link one: 3 reports (copied, weapon, copied); link two: 1 report (other). Most reported first; each kind once.
        one, two = self.share(ADA, "One")["id"], self.share(BO, "Two")["id"]
        self.report(two, "other")
        self.report(one, "copied")
        self.report(one, "weapon", uid=BO)
        self.report(one, "copied")
        self.assertEqual(self.queue(), [(one, "3", "copied,weapon"), (two, "1", "other")])

    def test_a_decided_link_leaves_the_list_until_a_new_report(self):
        one = self.share(ADA)["id"]
        self.report(one)
        self.assertEqual(self.server(f"select decide_share('{one}', 'dismiss', 'Ben', 'not a copy');"), "t")
        self.assertEqual(self.queue(), [])
        self.report(one, "weapon")
        self.assertEqual(self.queue(), [(one, "1", "weapon")])

    # Decisions

    def test_take_down_put_back_and_dismiss_each_do_what_they_say_and_are_kept(self):
        link = self.share(ADA)["id"]
        self.report(link)
        self.assertEqual(self.server(f"select decide_share('{link}', 'take-down', 'Ben', 'copied');"), "t")
        self.assertFalse(self.opens(link))
        self.assertEqual(self.server(f"select decide_share('{link}', 'take-down', 'Ben', 'again');"), "f")  # already down
        self.assertEqual(self.server(f"select decide_share('{link}', 'put-back', 'Dad', 'appeal upheld');"), "t")
        self.assertTrue(self.opens(link))
        self.assertEqual(self.server(f"select decide_share('{link}', 'put-back', 'Dad', 'again');"), "f")  # already up
        self.assertEqual(self.server(f"select decide_share('{link}', 'dismiss', 'Ben', '');"), "t")
        self.assertTrue(self.opens(link))
        self.assertEqual(self.log(), [("take-down", link, ADA, "Ben"), ("put-back", link, ADA, "Dad"), ("dismiss", link, ADA, "Ben")])

    def test_a_link_turned_off_by_its_owner_stays_off_when_put_back(self):
        link = self.share(ADA)["id"]
        self.server(f"select decide_share('{link}', 'take-down', 'Ben', '');")
        self.as_user(ADA, f"select unshare('{link}');")
        self.server(f"select decide_share('{link}', 'put-back', 'Ben', '');")
        self.assertFalse(self.opens(link))

    def test_a_decision_on_a_link_that_never_was_keeps_nothing_and_an_unknown_one_is_refused(self):
        self.assertEqual(self.server(f"select decide_share('{uuid.uuid4()}', 'take-down', 'Ben', '');"), "f")
        self.assertEqual(self.log(), [])
        link = self.share(ADA)["id"]
        ok, out = self.pg.psql(f"set role service_role; select decide_share('{link}', 'delete', 'Ben', '');")
        self.assertFalse(ok)
        self.assertIn("unknown decision", out)

    def test_a_decision_needs_who_made_it(self):
        link = self.share(ADA)["id"]
        ok, out = self.pg.psql(f"set role service_role; select decide_share('{link}', 'take-down', '', '');")
        self.assertFalse(ok)
        self.assertIn("moderation_log_moderator_check", out)
        self.assertTrue(self.opens(link))  # the whole decision went back

    def test_taking_a_name_away_is_kept_and_they_pick_again(self):
        self.as_user(BO, "select set_display_name('Bad Name');")
        self.assertEqual(self.server(f"select moderate_name('{BO}', 'Ben', 'rude');"), "t")
        self.assertEqual(self.as_user(BO, "select my_display_name() is null;"), (True, "t"))
        self.assertEqual(self.server(f"select moderate_name('{BO}', 'Ben', 'again');"), "f")
        self.assertEqual(self.log(), [("reset-name", "", BO, "Ben")])

    # Holds

    def test_a_held_account_cant_share_or_rename_but_can_still_turn_its_links_off(self):
        link = self.share(BO)["id"]
        self.as_user(BO, "select set_display_name('Bo');")
        self.assertEqual(self.server(f"select hold_account('{BO}', now() + interval '7 days', 'Reports of copied models.', false, 'Ben', '');"), "t")
        for sql in ["select share_design('Box', '{}', null);", "select set_display_name('Bo Two');"]:
            ok, out = self.as_user(BO, sql)
            self.assertFalse(ok, sql)
            self.assertIn("account held", out)
        self.assertTrue(self.opens(link))  # not taken down: p_take_links was false
        self.assertEqual(self.as_user(BO, f"select unshare('{link}');"), (True, "t"))
        self.assertEqual(self.share(ADA)["status"], "shared")  # someone else is not held

    def test_a_hold_can_take_every_link_down(self):
        a, b = self.share(BO)["id"], self.share(BO)["id"]
        mine = self.share(ADA)["id"]
        self.server(f"select hold_account('{BO}', null, 'Closed.', true, 'Ben', 'weapons');")
        self.assertEqual((self.opens(a), self.opens(b), self.opens(mine)), (False, False, True))

    def test_a_hold_ends_when_its_time_is_up(self):
        # A hold of 10 days, 9 days in (0.9x): still held. 11 days in (1.1x): over.
        self.server(f"select hold_account('{BO}', now() + interval '10 days', 'A week off.', false, 'Ben', '');")
        self.owner(f"update public.account_holds set since = now() - interval '9 days', until = now() + interval '1 day' where user_id = '{BO}';")
        self.assertIn("account held", self.as_user(BO, "select share_design('Box', '{}', null);")[1])
        self.owner(f"update public.account_holds set since = now() - interval '11 days', until = now() - interval '1 day' where user_id = '{BO}';")
        self.assertEqual(self.share(BO)["status"], "shared")

    def test_ending_a_hold_early_is_kept(self):
        self.server(f"select hold_account('{BO}', null, 'Closed.', false, 'Ben', '');")
        self.assertEqual(self.server(f"select end_hold('{BO}', 'Dad', 'appeal');"), "t")
        self.assertEqual(self.share(BO)["status"], "shared")
        self.assertEqual(self.server(f"select end_hold('{BO}', 'Dad', 'again');"), "f")
        self.assertEqual([a for a, *_ in self.log()], ["hold", "end-hold"])

    def test_no_hold_on_an_account_that_doesnt_exist(self):
        self.assertEqual(self.server(f"select hold_account('{uuid.uuid4()}', null, 'x', true, 'Ben', '');"), "f")
        self.assertEqual(self.log(), [])

    # The takedown process

    def test_a_claim_takes_the_link_down_and_its_decision_settles_it(self):
        link = self.share(ADA)["id"]
        claim = self.server(f"select record_claim('{link}', 'Maker Co', 'legal@example.com', 'Our bracket model', 'Ben');")
        self.assertFalse(self.opens(link))
        self.assertEqual(self.server(f"select decide_claim({claim}, 'rejected', 'Ben', 'Ada drew it first');"), "t")
        self.assertTrue(self.opens(link))
        self.assertEqual(self.server(f"select decide_claim({claim}, 'upheld', 'Ben', 'changed my mind');"), "f")  # decided
        claim2 = self.server(f"select record_claim('{link}', 'Maker Co', 'legal@example.com', 'Again', 'Ben');")
        self.assertEqual(self.server(f"select decide_claim({claim2}, 'upheld', 'Ben', '');"), "t")
        self.assertFalse(self.opens(link))
        self.assertEqual(self.server("select string_agg(outcome, ',' order by id) from takedown_claims;"), "rejected,upheld")
        self.assertEqual([a for a, *_ in self.log()], ["claim", "put-back", "claim", "dismiss"])

    # The person's view and deleting the account

    def test_my_data_shows_my_hold_and_the_decisions_about_me_but_never_who_decided(self):
        link = self.share(BO)["id"]
        self.server(f"select decide_share('{link}', 'take-down', 'SecretModerator', 'note text');")
        self.server(f"select hold_account('{BO}', null, 'Shared a weapon part.', false, 'SecretModerator', '');")
        data = json.loads(self.as_user(BO, "select my_data();")[1])
        self.assertEqual(data["account_hold"]["reason"], "Shared a weapon part.")
        self.assertEqual([m["action"] for m in data["moderation"]], ["take-down", "hold"])
        self.assertNotIn("SecretModerator", json.dumps(data))
        self.assertNotIn("note text", json.dumps(data))
        other = json.loads(self.as_user(ADA, "select my_data();")[1])
        self.assertEqual((other["account_hold"], other["moderation"]), (None, []))

    def test_the_record_outlives_the_account(self):
        link = self.share(BO)["id"]
        self.server(f"select decide_share('{link}', 'take-down', 'Ben', '');")
        self.server(f"select hold_account('{BO}', null, 'Closed.', false, 'Ben', '');")
        ok, out = self.as_user(BO, "select delete_my_account();")
        self.assertTrue(ok, out)
        self.assertEqual(len(self.log()), 2)
        self.assertEqual(self.owner(f"select count(*) from public.account_holds where user_id = '{BO}';"), "0")


if __name__ == "__main__":
    unittest.main()
