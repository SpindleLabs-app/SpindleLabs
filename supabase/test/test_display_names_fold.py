"""Display names compared by Unicode's look-alike list (supabase/migrations/20261113210000_display_names_fold.sql),
checked on a real PostgreSQL.

Security hunt 2026-11-13 (private bug-reports#4 B5): Latin letters with no accent to strip (dotless i, o with a
stroke, the dental click that looks like l) and several Greek capitals were not folded, so "Admın" passed as staff
and "ΒΟΒ" as Bob. The key now folds every letter Unicode's confusables data says looks like a plain letter or digit
onto it, and a Latin name whose key is still not plain a-z and 0-9 is refused.
Run: python3 -m unittest discover -s supabase/test
"""

import os
import unittest

from test_database import ADA, BO, HERE, MIGRATIONS, Cluster

CY = "33333333-3333-4333-8333-333333333333"
DI = "44444444-4444-4444-8444-444444444444"


class DisplayNamesFold(unittest.TestCase):
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
        for uid in [ADA, BO, CY, DI]:
            self.owner(f"insert into auth.users (id, email) values ('{uid}', '{uid[:2]}@example.com');")

    def owner(self, sql):
        ok, out = self.pg.psql(sql)
        self.assertTrue(ok, out)
        return out

    def name(self, uid, name):
        ok, out = self.pg.psql(f"begin; set local role authenticated; \\o /dev/null\nselect set_config('request.jwt.claim.sub', '{uid}', true);\n\\o\nselect set_display_name('{name}'); commit;")
        self.assertTrue(ok, out)
        return out

    def key(self, name):
        return self.owner(f"select display_name_key('{name}');")

    def test_the_key_worked_by_hand(self):
        # "Admın": A d m stay; ı (dotless i) looks like i, so i; n stays; lower case "admin". The old key kept ı.
        # "Suppørt": ø is o with a stroke, so o: "support". "ΒΟΒ" (Greek capitals beta, omicron, beta): B O B, "bob".
        # "Søren": "soren", the same as "Soren". "Łukasz": Ł is L with a stroke: "lukasz". Then, as before, 1 and i
        # become l, so "Admin" and "Admın" are both "admln".
        for name, key in [("Admın", "admln"), ("Suppørt", "support"), ("ΒΟΒ", "bob"), ("Søren", "soren"), ("Łukasz", "lukasz"),
                          ("Ben_P.3D", "benped"), ("Zoë-Ann", "zoeann")]:
            self.assertEqual(self.key(name), key, name)

    def test_the_hunts_look_alikes_cannot_pass_as_staff(self):
        for impostor in ["SpındleLabs", "SpǀndleLabs", "SpinđleLabs", "Admın", "Ađmin", "Admǀn", "Suppørt", "Suƿport", "Møderator", "Moderatør"]:
            self.assertEqual(self.name(ADA, impostor), "blocked", impostor)

    def test_the_hunts_look_alikes_cannot_copy_a_person(self):
        pairs = [("Bella", ["Bełła", "Beǀǀa", "Веӏӏа"]), ("BOB", ["ΒΟΒ"]), ("MAX", ["ΜΑΧ"]), ("ZOE", ["ΖΟΕ"]), ("HANNA", ["ΗΑΝΝΑ"]),
                 ("Willow", ["ԝіӏӏоԝ"]), ("Diego", ["Dıego", "Điego", "Ɖiego"])]
        for victim, impostors in pairs:
            self.owner("delete from display_names;")
            self.assertEqual(self.name(ADA, victim), "saved", victim)
            for impostor in impostors:
                self.assertIn(self.name(BO, impostor), ("taken", "bad"), f"{impostor} copies {victim}")

    def test_real_names_with_these_letters_still_work(self):
        for uid, name in [(ADA, "Søren"), (BO, "Łukasz"), (CY, "Đorđe"), (DI, "Æsa")]:
            self.assertEqual(self.name(uid, name), "saved", name)
        self.owner(f"delete from display_names where user_id = '{DI}';")
        self.assertEqual(self.name(DI, "Soren"), "taken", "Soren looks like Søren")

    def test_every_latin_letter_a_name_may_use_keys_to_plain_letters_or_is_refused(self):
        # Every letter of the Latin blocks set_display_name could take (a letter, unchanged by NFKC): either its key is
        # plain a-z and 0-9, or a name holding it is refused.
        odd = self.owner("""select string_agg(chr(i), '') from (select i from generate_series(192, 591) i union all select i from generate_series(7680, 7935) i) g
                            where chr(i) ~ '[[:alpha:]]' and normalize(chr(i), NFKC) = chr(i) and display_name_key('ab' || chr(i)) !~ '^[a-z0-9]+$';""")
        for ch in odd:
            self.assertEqual(self.name(ADA, f"Ab{ch}cd"), "bad", f"U+{ord(ch):04X} {ch}")
        self.assertGreater(len(odd), 0, "some letters, such as the click U+01C3, look like no plain letter")

    def test_names_saved_before_are_keyed_again_the_oldest_kept_and_the_rest_reset(self):
        # As the live project may hold: names saved under the old key. Bob first, then ΒΟΒ two days later (the old key
        # kept its Greek letters, so both were saved), then Admın (old key "admın", not blocked then).
        self.owner(f"""insert into display_names (user_id, name, name_key, changed_at) values
            ('{ADA}', 'Bob', 'bob', now() - interval '3 days'), ('{BO}', 'ΒΟΒ', 'βoβ', now() - interval '1 day'),
            ('{CY}', 'Admın', 'admın', now() - interval '2 days'), ('{DI}', 'Søren', 'søren', now() - interval '4 days');""")
        self.owner("set role service_role; select rekey_display_names(); reset role;")
        rows = self.owner("select name || '=' || name_key from display_names order by changed_at;").split()
        self.assertEqual(rows, ["Søren=soren", "Bob=bob"])
        log = self.owner("select user_id || ' ' || action from moderation_log order by user_id;").split("\n")
        self.assertEqual(log, [f"{BO} reset-name", f"{CY} reset-name"])
        self.assertEqual(self.name(BO, "Bo Two"), "saved", "a reset name is picked again at once")

    def test_only_the_server_rekeys(self):
        ok, out = self.pg.psql(f"begin; set local role authenticated; select rekey_display_names(); commit;")
        self.assertFalse(ok)
        self.assertIn("permission denied", out)


if __name__ == "__main__":
    unittest.main()
