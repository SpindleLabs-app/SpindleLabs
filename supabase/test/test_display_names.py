"""Display names (supabase/migrations/20261111130000_display_names.sql), checked on a real PostgreSQL.

Same throwaway cluster and roles as test_database.py. A display name is the only thing a profile holds: these check
its character rules, that two people can't hold names that differ only in capitals or punctuation, the blocked
words, the once-a-week change at 0.9x and 1.1x, and that nobody else can read or change it.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import os
import unittest

from test_database import ADA, BO, HERE, MIGRATIONS, Cluster

DAY = 24 * 60 * 60


class DisplayNamesDatabase(unittest.TestCase):
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

    def name(self, uid, name):
        quoted = "null" if name is None else "'" + name.replace("'", "''") + "'"
        ok, out = self.as_user(uid, f"select set_display_name({quoted});")
        self.assertTrue(ok, out)
        return out

    def mine(self, uid):
        ok, out = self.as_user(uid, "select my_display_name();")
        self.assertTrue(ok, out)
        return json.loads(out) if out else None

    def age(self, uid, seconds):
        self.owner(f"update public.display_names set changed_at = now() - make_interval(secs => {seconds}) where user_id = '{uid}';")

    # Setting and reading one's own

    def test_a_name_is_set_and_read_back_with_when_it_may_change_next(self):
        self.assertIsNone(self.mine(ADA))
        self.assertEqual(self.name(ADA, "Ada Makes"), "saved")
        got = self.mine(ADA)
        self.assertEqual(got["name"], "Ada Makes")
        ok, out = self.as_user(ADA, "select (my_display_name()->>'next_change_at')::timestamptz - (my_display_name()->>'changed_at')::timestamptz;")
        self.assertEqual((ok, out), (True, "7 days"))

    def test_the_comparison_key_worked_by_hand(self):
        # Accents off, lower case, letters and digits only, then 0->o, 1 and i->l, 3->e, 4->a, 5->s:
        # "Ben_P.3D" -> "benp3d" -> "benped"; "Zoë-Ann" -> "zoeann"; "Spind1eLabs" -> "splndlelabs" (as "SpindleLabs" itself).
        for name, key in [("Ben_P.3D", "benped"), ("ben p 3d", "benped"), ("Zoë-Ann", "zoeann"), ("Spind1eLabs", "splndlelabs"),
                          ("SpindIeLabs", "splndlelabs")]:
            ok, out = self.as_role("anon", f"select display_name_key('{name}');")
            self.assertEqual((ok, out), (True, key), name)

    def test_look_alike_letters_cannot_copy_a_name_or_pass_as_spindlelabs(self):
        # Security review 2026-11-11: each of these got past the first version.
        self.assertEqual(self.name(ADA, "Ben"), "saved")
        self.assertEqual(self.name(BO, "B\u0435n"), "bad")  # Cyrillic e among Latin
        for bad in ["\u0405pindleLabs", "\uff33pindle", "\u0661\u0662\u0663"]:  # Cyrillic S, full-width S, Arabic digits
            self.assertEqual(self.name(BO, bad), "bad", bad)
        for blocked in ["Spind1eLabs", "SpindIeLabs", "Adm1n", "TheSpindleLabsTeam"]:
            self.assertEqual(self.name(BO, blocked), "blocked", blocked)

    def test_an_accented_look_alike_is_taken(self):
        self.assertEqual(self.name(ADA, "Zoe"), "saved")
        self.assertEqual(self.name(BO, "Zoë"), "taken")
        self.assertEqual(self.name(BO, "Zoë Two"), "saved")

    def test_names_in_one_other_writing_system_are_welcome(self):
        # A whole name in Cyrillic, Greek, Japanese or Arabic letters is fine; only mixing two is refused.
        for i, good in enumerate(["\u0410\u043d\u043d\u0430", "\u0395\u03bb\u03ad\u03bd\u03b7", "\u3055\u304f\u3089\u82b1", "\u0633\u0627\u0631\u0629"]):
            uid = [ADA, BO][i % 2]
            self.owner("delete from public.display_names;")
            self.assertEqual(self.name(uid, good), "saved", good)

    def test_names_that_differ_only_in_capitals_or_punctuation_are_taken(self):
        self.assertEqual(self.name(ADA, "Ben_P"), "saved")
        for other in ["ben p", "BENP", "Ben.P", "b-e-n-p"]:
            self.assertEqual(self.name(BO, other), "taken", other)
        self.assertEqual(self.name(BO, "Ben Q"), "saved")

    # The character rules, each with a name broken in exactly that way

    def test_length_from_3_to_30_characters(self):
        # The upper limit at 0.9x (27 characters) and 1.1x (33); the lower limit is exactly 3 (2 is refused).
        self.assertEqual(self.name(ADA, "a" * 27), "saved")
        self.assertEqual(self.name(BO, "b" * 33), "bad")
        self.assertEqual(self.name(BO, "b" * 30), "saved")
        self.owner("delete from public.display_names;")
        self.assertEqual(self.name(ADA, "abc"), "saved")
        self.assertEqual(self.name(BO, "ab"), "bad")

    def test_each_broken_rule_is_refused(self):
        for bad in [None, "", "<script>", "ada!", " Ada", "Ada ", "_ada", "ada.", "ada  makes", "a__", "a_b", "a.-b", "ada\nmakes"]:
            self.assertEqual(self.name(ADA, bad), "bad", repr(bad))
        self.assertIsNone(self.mine(ADA))
        # The same names mended are fine.
        for good in ["Ada", "ada makes", "a_bc", "a.b-c", "Ada3D", "Zoë"]:
            self.assertEqual(self.name(BO, good), "saved", good)
            self.owner("delete from public.display_names;")

    def test_names_passing_as_spindlelabs_are_blocked_but_a_word_inside_a_name_is_fine(self):
        for blocked in ["SpindleLabs", "Spindle Fan", "the_admin", "Moderator 7", "Official", "support"]:
            self.assertEqual(self.name(ADA, blocked), "blocked", blocked)
        self.assertEqual(self.name(ADA, "badminton"), "saved")

    def test_the_word_list_is_closed_to_the_browser(self):
        for sql in ["select * from public.blocked_name_words;", "delete from public.blocked_name_words;"]:
            self.denied(self.as_role("anon", sql))
            self.denied(self.as_user(ADA, sql))

    # Changing it once a week

    def test_a_name_changes_once_a_week(self):
        # Changed 0.9 x 7 days = 6.3 days ago: too soon. 1.1 x 7 days = 7.7 days ago: allowed.
        self.name(ADA, "Ada")
        self.age(ADA, int(6.3 * DAY))
        self.assertEqual(self.name(ADA, "Ada Two"), "too-soon")
        self.assertEqual(self.mine(ADA)["name"], "Ada")
        self.age(ADA, int(7.7 * DAY))
        self.assertEqual(self.name(ADA, "Ada Two"), "saved")
        self.assertEqual(self.name(ADA, "Ada Three"), "too-soon")

    def test_setting_the_same_name_again_is_not_a_change(self):
        self.name(ADA, "Ada")
        self.age(ADA, DAY)
        self.assertEqual(self.name(ADA, "Ada"), "saved")
        ok, out = self.as_user(ADA, "select now() - (my_display_name()->>'changed_at')::timestamptz >= interval '1 day';")
        self.assertEqual((ok, out), (True, "t"))

    def test_a_new_capital_is_a_change_but_never_taken_from_oneself(self):
        self.name(ADA, "ada")
        self.age(ADA, 8 * DAY)
        self.assertEqual(self.name(ADA, "Ada"), "saved")

    # Nobody else

    def test_nobody_else_reads_or_changes_my_name(self):
        self.name(ADA, "Ada")
        self.assertIsNone(self.mine(BO))
        for sql in ["select * from public.display_names;", f"update public.display_names set name = 'x' where user_id = '{ADA}';"]:
            self.denied(self.as_user(BO, sql))
            self.denied(self.as_role("anon", sql))
        self.denied(self.as_role("anon", "select set_display_name('Anon');"))
        self.denied(self.as_role("anon", "select my_display_name();"))

    def test_only_the_server_takes_a_name_away_and_the_person_may_pick_again_at_once(self):
        self.name(ADA, "Ada")
        self.denied(self.as_user(ADA, f"select reset_display_name('{ADA}');"))
        self.assertEqual(self.pg.psql(f"set role service_role; select reset_display_name('{ADA}');"), (True, "t"))
        self.assertIsNone(self.mine(ADA))
        self.assertEqual(self.name(ADA, "Ada Again"), "saved")

    # Download my data and deleting the account

    def test_my_data_holds_my_name_and_deleting_the_account_frees_it(self):
        self.name(ADA, "Ada")
        self.assertEqual(json.loads(self.as_role("postgres", "select my_data();", ADA)[1])["display_name"]["name"], "Ada")
        self.assertIsNone(json.loads(self.as_role("postgres", "select my_data();", BO)[1])["display_name"])
        ok, out = self.as_user(ADA, "select delete_my_account();")
        self.assertTrue(ok, out)
        self.assertEqual(self.name(BO, "ADA"), "saved")


if __name__ == "__main__":
    unittest.main()
