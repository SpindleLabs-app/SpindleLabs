"""Settings that follow you (supabase/migrations/20261106000000_settings.sql), on a real PostgreSQL.

Same throwaway cluster, roles and helpers as test_designs.py. The points: one person can never read, change or
delete another person's settings; only SpindleLabs' own setting names with text values are taken; the number and
size limits hold at 0.9x and refuse at 1.1x; two devices never silently overwrite each other (a save names the
revision it last saw); and turning it off stops every save and deletes what was kept.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import unittest

from test_database import ADA, BO
import test_designs  # its class, imported by name, would be run twice

KIB = 1024


def lit(obj):
    """A Python dict as an SQL jsonb literal."""
    return "'" + json.dumps(obj).replace("'", "''") + "'::jsonb"


class SettingsDatabase(unittest.TestCase):
    setUpClass = classmethod(test_designs.DesignsDatabase.setUpClass.__func__)
    tearDownClass = classmethod(test_designs.DesignsDatabase.tearDownClass.__func__)
    setUp = test_designs.DesignsDatabase.setUp
    owner = test_designs.DesignsDatabase.owner
    as_role = test_designs.DesignsDatabase.as_role
    as_user = test_designs.DesignsDatabase.as_user
    denied = test_designs.DesignsDatabase.denied

    def save(self, uid, settings, expected=0):
        ok, out = self.as_user(uid, f"select save_settings({settings if isinstance(settings, str) else lit(settings)}, {expected});")
        self.assertTrue(ok, out)
        return json.loads(out)

    def mine(self, uid):
        ok, out = self.as_user(uid, "select my_settings();")
        self.assertTrue(ok, out)
        return json.loads(out)

    # Saving and reading one's own

    def test_nothing_kept_reads_as_revision_0_and_keeping_is_on(self):
        self.assertEqual(self.mine(ADA), {"keep": True, "revision": 0, "settings": {}})

    def test_a_save_is_read_back_whole_and_each_save_bumps_the_revision(self):
        first = {"spindlelabs-settings": '{"theme":"light","unit":"in"}', "spindlelabs.slice.nozzle": "0.4"}
        self.assertEqual(self.save(ADA, first), {"status": "saved", "revision": 1})
        self.assertEqual(self.mine(ADA), {"keep": True, "revision": 1, "settings": first})
        second = {"spindlelabs.slice.nozzle": "0.6"}
        self.assertEqual(self.save(ADA, second, expected=1), {"status": "saved", "revision": 2})
        self.assertEqual(self.mine(ADA)["settings"], second, "a save replaces the whole set: the app sends all of them")

    def test_two_devices_never_overwrite_each_other(self):
        # Both devices read revision 0. The first saves (now revision 1); the second, still naming 0, is told it changed.
        self.assertEqual(self.save(ADA, {"spindlelabs.a": "laptop"}, expected=0)["status"], "saved")
        self.assertEqual(self.save(ADA, {"spindlelabs.a": "phone"}, expected=0), {"status": "changed", "revision": 1})
        self.assertEqual(self.mine(ADA)["settings"], {"spindlelabs.a": "laptop"}, "nothing written by the stale save")
        # Naming a revision ahead of the account's is just as stale.
        self.assertEqual(self.save(ADA, {"spindlelabs.a": "phone"}, expected=5), {"status": "changed", "revision": 1})
        # Having read revision 1 again (and merged), the second device saves.
        self.assertEqual(self.save(ADA, {"spindlelabs.a": "phone"}, expected=1), {"status": "saved", "revision": 2})

    # Other people

    def test_another_person_cannot_read_change_or_delete_your_settings(self):
        self.save(ADA, {"spindlelabs.a": "Ada's"})
        self.assertEqual(self.mine(BO), {"keep": True, "revision": 0, "settings": {}})
        # Bo saving, even naming Ada's revision, writes only Bo's own row.
        self.assertEqual(self.save(BO, {"spindlelabs.a": "Bo's"}, expected=1), {"status": "changed", "revision": 0})
        self.assertEqual(self.save(BO, {"spindlelabs.a": "Bo's"})["status"], "saved")
        self.assertEqual(self.as_user(BO, "select delete_my_settings();"), (True, "t"))
        self.assertEqual(self.as_user(BO, "select set_keep_settings(false);"), (True, "f"))
        self.assertEqual(self.mine(ADA), {"keep": True, "revision": 1, "settings": {"spindlelabs.a": "Ada's"}})

    def test_saving_over_ones_own_settings_never_touches_anyone_elses(self):
        self.save(BO, {"spindlelabs.a": "Bo's"})
        self.save(ADA, {"spindlelabs.a": "Ada's 1"})
        self.assertEqual(self.save(ADA, {"spindlelabs.a": "Ada's 2"}, expected=1)["status"], "saved")
        self.assertEqual(self.mine(BO), {"keep": True, "revision": 1, "settings": {"spindlelabs.a": "Bo's"}})
        self.assertEqual(self.mine(ADA)["settings"], {"spindlelabs.a": "Ada's 2"})

    def test_the_table_itself_is_closed_to_the_browser(self):
        self.save(ADA, {"spindlelabs.a": "x"})
        self.denied(self.as_user(ADA, "select * from account_settings;"))
        self.denied(self.as_user(ADA, f"insert into account_settings (user_id, settings) values ('{ADA}', '{{}}');"))
        self.denied(self.as_user(ADA, "update account_settings set settings = '{}';"))
        self.denied(self.as_user(ADA, "delete from account_settings;"))
        self.denied(self.as_role("anon", "select * from account_settings;"))

    def test_the_keep_choice_changes_only_through_its_function(self):
        self.denied(self.as_user(ADA, "update profiles set keep_settings = false;"))
        self.assertEqual(self.owner(f"select keep_settings from profiles where id = '{ADA}';"), "t")

    def test_nobody_signed_in_can_use_any_settings_function(self):
        for call in ["my_settings()", "save_settings('{}', 0)", "set_keep_settings(true)", "delete_my_settings()", "settings_limits()"]:
            self.denied(self.as_role("anon", f"select {call};"))
        for call in ["my_settings()", "save_settings('{}', 0)", "set_keep_settings(true)", "delete_my_settings()"]:
            ok, out = self.as_role("authenticated", f"select {call};")
            self.assertFalse(ok, call)
            self.assertIn("not signed in", out)

    # What is taken

    def test_only_spindlelabs_setting_names_with_text_values(self):
        for bad in [
            {"ai-key": "sk-ant-secret"},  # not one of ours
            {"spindle.account.session": "{}"},  # the sign-in: "spindle." is the account code's, never sent
            {"SpindleLabs-settings": "x"},  # not the exact start
            {"spindlelabs settings": "x"},  # a space
            {"spindlelabs.slice.nozzle": 0.4},  # a number, not text
            {"spindlelabs.slice.presets": {"version": 1}},  # an object, not text
            {"spindlelabs.a": None},
        ]:
            self.assertEqual(self.save(ADA, bad), {"status": "invalid"}, bad)
        self.assertEqual(self.save(ADA, "'[]'::jsonb"), {"status": "invalid"}, "a list, not an object")
        self.assertEqual(self.save(ADA, "'\"text\"'::jsonb"), {"status": "invalid"})
        self.assertEqual(self.save(ADA, "null"), {"status": "invalid"})
        self.assertEqual(self.save(ADA, {}, expected="null"), {"status": "invalid"})
        self.assertEqual(self.save(ADA, {}, expected=-1), {"status": "invalid"})
        self.assertEqual(self.mine(ADA)["revision"], 0, "nothing was written")
        good = {"spindlelabs-settings": "{}", "spindlelabs.design.buildArea": "shown", "spindlelabs.fits.0.4/x_y-z": ""}
        self.assertEqual(self.save(ADA, good)["status"], "saved")

    def test_a_name_up_to_100_characters(self):
        # "spindlelabs." is 12 characters: 78 more make 90 (0.9x), 98 more make 110 (1.1x).
        self.assertEqual(self.save(ADA, {"spindlelabs." + "a" * 78: "x"})["status"], "saved")
        self.assertEqual(self.save(ADA, {"spindlelabs." + "a" * 98: "x"}, expected=1), {"status": "invalid"})
        self.assertEqual(self.save(ADA, {"spindlelabs." + "a" * 88: "x"}, expected=1)["status"], "saved", "exactly 100")

    def test_at_most_64_settings(self):
        # 57 (0.9 x 64, rounded down) are taken, 71 (1.1 x 64, rounded up) are not; 64 exactly is, 65 is not.
        many = lambda n: {f"spindlelabs.s{i}": "x" for i in range(n)}
        self.assertEqual(self.save(ADA, many(57))["status"], "saved")
        self.assertEqual(self.save(ADA, many(71), expected=1), {"status": "too-big"})
        self.assertEqual(self.save(ADA, many(65), expected=1), {"status": "too-big"})
        self.assertEqual(self.save(ADA, many(64), expected=1)["status"], "saved")

    def test_256_kib_in_all_worked_by_hand(self):
        # The size is each name's bytes plus its text's bytes. The name "spindlelabs.p" is 13 bytes.
        # 0.9 x 262144 = 235929.6, so text of 235916 bytes makes 235929: taken.
        # 1.1 x 262144 = 288358.4, so text of 288346 bytes makes 288359: refused.
        self.assertEqual(self.save(ADA, f"jsonb_build_object('spindlelabs.p', repeat('a', 235916))")["status"], "saved")
        self.assertEqual(self.save(ADA, f"jsonb_build_object('spindlelabs.p', repeat('a', 288346))", expected=1), {"status": "too-big"})
        # The edge: 262131 + 13 = 262144 is taken, one byte more is not.
        self.assertEqual(self.save(ADA, f"jsonb_build_object('spindlelabs.p', repeat('a', 262131))", expected=1)["status"], "saved")
        self.assertEqual(self.save(ADA, f"jsonb_build_object('spindlelabs.p', repeat('a', 262132))", expected=2), {"status": "too-big"})
        # Bytes, not characters: "é" is 2 bytes in UTF-8, so 131066 of them (262132 bytes) + 13 is over.
        self.assertEqual(self.save(ADA, f"jsonb_build_object('spindlelabs.p', repeat('é', 131066))", expected=2), {"status": "too-big"})
        # JSON's own escaping doesn't count: a quote is one byte of text (the browser keeps it as one).
        self.assertEqual(self.save(ADA, f"jsonb_build_object('spindlelabs.p', repeat('\"', 262131))", expected=2)["status"], "saved")

    def test_the_limits_the_app_reads_are_the_ones_held(self):
        self.assertEqual(json.loads(self.as_user(ADA, "select settings_limits();")[1]), {"max_settings": 64, "max_bytes": 262144, "max_name": 100})

    # Turning it off, deleting

    def test_off_stops_every_save_and_deletes_what_was_kept(self):
        self.save(ADA, {"spindlelabs.a": "x"})
        self.save(BO, {"spindlelabs.a": "y"})
        self.assertEqual(self.as_user(ADA, "select set_keep_settings(false);"), (True, "f"))
        self.assertEqual(self.mine(ADA), {"keep": False, "revision": 0, "settings": {}})
        self.assertEqual(self.save(ADA, {"spindlelabs.a": "x"}), {"status": "off"})
        self.assertEqual(self.save(ADA, {"spindlelabs.a": "x"}, expected=1), {"status": "off"})
        self.assertEqual(self.owner(f"select count(*) from account_settings where user_id = '{ADA}';"), "0")
        self.assertEqual(self.mine(BO)["settings"], {"spindlelabs.a": "y"}, "Bo's choice is his own")
        # On again: nothing comes back, and the next save starts from revision 0.
        self.assertEqual(self.as_user(ADA, "select set_keep_settings(true);"), (True, "t"))
        self.assertEqual(self.mine(ADA), {"keep": True, "revision": 0, "settings": {}})
        self.assertEqual(self.save(ADA, {"spindlelabs.a": "z"}), {"status": "saved", "revision": 1})
        self.assertEqual(self.as_user(ADA, "select set_keep_settings(null);"), (True, "f"), "anything but true is off")

    def test_delete_my_settings_empties_only_the_persons_own(self):
        self.save(ADA, {"spindlelabs.a": "x"})
        self.save(BO, {"spindlelabs.a": "y"})
        self.assertEqual(self.as_user(ADA, "select delete_my_settings();"), (True, "t"))
        self.assertEqual(self.as_user(ADA, "select delete_my_settings();"), (True, "f"), "nothing left the second time")
        self.assertEqual(self.mine(ADA)["revision"], 0)
        self.assertEqual(self.mine(BO)["settings"], {"spindlelabs.a": "y"})

    def test_my_data_holds_the_settings_and_the_keep_choice(self):
        self.assertIsNone(json.loads(self.as_role("postgres", "select my_data();", ADA)[1])["settings"], "none kept: null")
        self.save(ADA, {"spindlelabs-settings": '{"theme":"dark"}'})
        self.save(BO, {"spindlelabs.a": "Bo's"})
        data = json.loads(self.as_role("postgres", "select my_data();", ADA)[1])
        self.assertEqual((data["settings"]["settings"], data["settings"]["revision"]), ({"spindlelabs-settings": '{"theme":"dark"}'}, 1))
        self.assertTrue(data["profile"]["keep_settings"])
        self.assertNotIn("Bo's", json.dumps(data))
        self.denied(self.as_user(ADA, "select my_data_part_settings();"))

    def test_deleting_the_account_deletes_its_settings_and_no_one_elses(self):
        self.save(ADA, {"spindlelabs.a": "x"})
        self.save(BO, {"spindlelabs.a": "y"})
        self.assertTrue(self.as_user(ADA, "select delete_my_account();")[0])
        self.assertEqual(self.owner("select count(*) from account_settings;"), "1")
        self.assertEqual(self.owner(f"select count(*) from account_settings where user_id = '{BO}';"), "1")


if __name__ == "__main__":
    unittest.main()
