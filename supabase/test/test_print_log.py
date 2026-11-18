"""Print log (supabase/migrations/20261113120000_print_log.sql), on a real PostgreSQL.

Same throwaway cluster, roles and helpers as test_designs.py. The points: one person can never read, change or
delete another person's prints; every print is checked whole before anything is written; of two devices' changes
to one print the later is kept, and a clock running ahead can't win for good; 500 prints a person and 50 a save
hold at 0.9x and refuse at 1.1x; turning it off deletes what was kept and stops every save.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import unittest
import uuid

from test_database import ADA, BO
import test_designs  # its class, imported by name, would be run twice


def lit(obj):
    """A Python value as an SQL jsonb literal."""
    return "'" + json.dumps(obj).replace("'", "''") + "'::jsonb"


def pid(n):
    """The n-th made-up print id: a fixed UUID, so failures read the same every run."""
    return str(uuid.UUID(int=n + 1))


def print_(n=0, **change):
    """A good print as the app sends it, changed by `change`."""
    p = {
        "id": pid(n),
        "made_at": "2026-11-13T02:00:00.000Z",
        "name": "Box",
        "settings": "0.2 mm layers, 2 walls, 15% infill, no supports, standard nozzle",
        "grams": 12.5,
        "minutes": 80,
        "result": "waiting",
        "problem": None,
        "note": "",
        "updated_at": "2026-11-13T02:00:00.000Z",
    }
    p.update(change)
    return p


class PrintLogDatabase(unittest.TestCase):
    setUpClass = classmethod(test_designs.DesignsDatabase.setUpClass.__func__)
    tearDownClass = classmethod(test_designs.DesignsDatabase.tearDownClass.__func__)
    setUp = test_designs.DesignsDatabase.setUp
    owner = test_designs.DesignsDatabase.owner
    as_role = test_designs.DesignsDatabase.as_role
    as_user = test_designs.DesignsDatabase.as_user
    denied = test_designs.DesignsDatabase.denied

    def save(self, uid, prints):
        ok, out = self.as_user(uid, f"select save_prints({prints if isinstance(prints, str) else lit(prints)});")
        self.assertTrue(ok, out)
        return json.loads(out)

    def mine(self, uid, since=False):
        """my_print_log as `uid`, without its `since` unless asked."""
        ok, out = self.as_user(uid, "select my_print_log();")
        self.assertTrue(ok, out)
        answer = json.loads(out)
        if not since:
            answer.pop("since")
        return answer

    def stored(self, uid, n=0):
        """The print as my_print_log gives it, by its made-up number, or None."""
        return next((p for p in self.mine(uid)["prints"] if p["id"] == pid(n)), None)

    def delete(self, uid, ids):
        arr = "array[" + ", ".join(f"'{i}'" for i in ids) + "]::uuid[]" if ids else "'{}'::uuid[]"
        ok, out = self.as_user(uid, f"select delete_prints({arr});")
        self.assertTrue(ok, out)
        return int(out)

    # Saving and reading one's own

    def test_nothing_kept_reads_as_an_empty_log_with_keeping_on(self):
        self.assertEqual(self.mine(ADA), {"keep": True, "prints": []})

    def test_a_print_is_read_back_as_sent(self):
        p = print_(0, result="failed", problem="warped", note="Corner lifted at layer 12")
        self.assertEqual(self.save(ADA, [p]), {"status": "done", "saved": [pid(0)], "older": [], "full": []})
        got = self.stored(ADA)
        # PostgreSQL writes times as "+00:00"; the same moment as the "Z" sent.
        self.assertEqual(got["made_at"], "2026-11-13T02:00:00+00:00")
        self.assertEqual({k: got[k] for k in ("id", "name", "settings", "grams", "minutes", "result", "problem", "note")},
                         {k: p[k] for k in ("id", "name", "settings", "grams", "minutes", "result", "problem", "note")})
        self.assertEqual(self.save(ADA, [print_(1, grams=None, minutes=None)])["saved"], [pid(1)], "no weight or time is fine")

    def test_newest_made_first(self):
        self.save(ADA, [print_(0, made_at="2026-11-01T00:00:00Z"), print_(1, made_at="2026-11-03T00:00:00Z"), print_(2, made_at="2026-11-02T00:00:00Z")])
        self.assertEqual([p["id"] for p in self.mine(ADA)["prints"]], [pid(1), pid(2), pid(0)])

    # Two devices

    def test_the_later_change_of_two_devices_is_kept(self):
        # The laptop marks it failed at 03:00; the phone, not caught up, marked it well at 02:30 and sends it after.
        self.save(ADA, [print_(0)])
        laptop = print_(0, result="failed", problem="came-off", updated_at="2026-11-13T03:00:00Z")
        phone = print_(0, result="well", updated_at="2026-11-13T02:30:00Z")
        self.assertEqual(self.save(ADA, [laptop])["saved"], [pid(0)])
        self.assertEqual(self.save(ADA, [phone]), {"status": "done", "saved": [], "older": [pid(0)], "full": []})
        self.assertEqual((self.stored(ADA)["result"], self.stored(ADA)["problem"]), ("failed", "came-off"))
        # The same moment again is not later: the account's copy stays (a resend changes nothing).
        self.assertEqual(self.save(ADA, [print_(0, result="well", updated_at="2026-11-13T03:00:00Z")])["older"], [pid(0)])
        # One microsecond later is.
        self.assertEqual(self.save(ADA, [print_(0, result="well", updated_at="2026-11-13T03:00:00.000001Z")])["saved"], [pid(0)])
        self.assertEqual(self.stored(ADA)["result"], "well")

    def test_a_clock_ahead_cannot_win_for_good(self):
        # A device whose clock says 2099 is kept as changed now, so a real change a minute later still wins.
        self.save(ADA, [print_(0, result="failed", updated_at="2099-01-01T00:00:00Z", made_at="2099-01-01T00:00:00Z")])
        kept = self.owner(f"select updated_at <= now() and made_at <= now() from print_log where user_id = '{ADA}';")
        self.assertEqual(kept, "t")
        self.owner(f"update print_log set updated_at = now() - interval '1 minute' where user_id = '{ADA}';")
        self.assertEqual(self.save(ADA, [print_(0, result="well", updated_at="2098-01-01T00:00:00Z")])["saved"], [pid(0)])

    def test_grams_keep_at_most_three_decimals(self):
        # Security hunt 2026-11-13 A2: grams took up to 16,383 decimal digits, so 500 prints held 4.3 MB of free
        # space. The app sends grams to 0.1 g; three decimals (a milligram) is the most kept.
        self.assertEqual(self.save(ADA, [print_(1, grams=12.345)])["status"], "done", "three decimals")
        self.assertEqual(self.save(ADA, [print_(2, grams=12.3456)]), {"status": "invalid"}, "four")
        self.assertEqual(self.save(ADA, [print_(3, grams=0.5)])["status"], "done")
        huge = lit([print_(4, grams=0.5)]).replace('"grams": 0.5', '"grams": 0.' + "1" * 16383)
        self.assertEqual(self.save(ADA, huge), {"status": "invalid"}, "16,383 digits")
        self.assertEqual(self.save(ADA, lit([print_(5, grams=0.5)]).replace('"grams": 0.5', '"grams": 1.200')), {"status": "done", "saved": [pid(5)], "older": [], "full": []}, "trailing zeros are still three")
        self.assertEqual(self.save(ADA, lit([print_(6, grams=0.5)]).replace('"grams": 0.5', '"grams": 5e-4')), {"status": "invalid"}, "written with an exponent, four places")
        # The table holds it too, should a later function forget the check.
        ok, out = self.pg.psql(f"insert into print_log (user_id, id, made_at, name, settings, grams, result, updated_at) values ('{ADA}', '{pid(9)}', now(), 'Box', '', 1.2345, 'waiting', now());")
        self.assertFalse(ok, "the table refuses four decimals")
        self.assertIn("check constraint", out)

    # Other people

    def test_another_person_cannot_read_change_or_delete_your_prints(self):
        self.save(ADA, [print_(0, note="Ada's")])
        self.assertEqual(self.mine(BO), {"keep": True, "prints": []})
        # Bo sending the same id, later, makes a print of Bo's own and leaves Ada's.
        self.assertEqual(self.save(BO, [print_(0, note="Bo's", updated_at="2026-11-14T00:00:00Z")])["saved"], [pid(0)])
        self.assertEqual(self.stored(ADA)["note"], "Ada's")
        self.assertEqual(self.delete(BO, [pid(0)]), 1, "Bo's own copy")
        self.assertEqual(self.delete(BO, [pid(0)]), 0)
        self.assertEqual(self.as_user(BO, "select delete_my_print_log();"), (True, "f"))
        self.assertEqual(self.as_user(BO, "select set_keep_print_log(false);"), (True, "f"))
        self.assertEqual(self.stored(ADA)["note"], "Ada's")
        self.assertEqual(self.mine(ADA)["keep"], True)

    def test_changing_ones_own_print_never_touches_anyone_elses_with_that_id(self):
        # Both have a print with the same id (ids are made in browsers, so nothing stops it); Bo changes his later.
        self.save(ADA, [print_(0, note="Ada's")])
        self.save(BO, [print_(0, note="Bo's")])
        self.assertEqual(self.save(BO, [print_(0, note="Bo's, changed", updated_at="2026-11-14T00:00:00Z")])["saved"], [pid(0)])
        self.assertEqual((self.stored(ADA)["note"], self.stored(BO)["note"]), ("Ada's", "Bo's, changed"))

    def test_the_table_itself_is_closed_to_the_browser(self):
        self.save(ADA, [print_(0)])
        self.denied(self.as_user(ADA, "select * from print_log;"))
        self.denied(self.as_user(ADA, f"insert into print_log (user_id, id, made_at, name, settings, result, updated_at) values ('{ADA}', '{pid(9)}', now(), 'x', '', 'well', now());"))
        self.denied(self.as_user(ADA, "update print_log set note = 'x';"))
        self.denied(self.as_user(ADA, "delete from print_log;"))
        self.denied(self.as_role("anon", "select * from print_log;"))

    def test_the_keep_choice_changes_only_through_its_function(self):
        self.denied(self.as_user(ADA, "update profiles set keep_print_log = false;"))
        self.assertEqual(self.owner(f"select keep_print_log from profiles where id = '{ADA}';"), "t")

    def test_nobody_signed_in_can_use_any_print_log_function(self):
        calls = ["my_print_log()", "save_prints('[]')", "delete_prints('{}')", "set_keep_print_log(true)", "delete_my_print_log()"]
        for call in calls + ["print_log_limits()", "my_data_part_print_log()", "print_log_valid('{}')", "print_log_time('x')"]:
            self.denied(self.as_role("anon", f"select {call};"))
        for call in calls:
            ok, out = self.as_role("authenticated", f"select {call};")
            self.assertFalse(ok, call)
            self.assertIn("not signed in", out)
        for helper in ["my_data_part_print_log()", "print_log_valid('{}')", "print_log_time('x')"]:
            self.denied(self.as_user(ADA, f"select {helper};"))

    # What is taken

    def test_every_print_is_checked_and_one_bad_one_refuses_the_whole_save(self):
        bad = [
            print_(id="not-a-uuid"),
            print_(id="aaaaaaaa-0000-0000-0000-000000000001".upper()),  # the app writes lower case
            print_(made_at="13/11/2026"),
            print_(made_at="2026-02-30T00:00:00Z"),  # no such day
            print_(updated_at=None),
            print_(name=""),
            print_(name=7),
            print_(settings=None),
            print_(note=None),
            print_(grams="12"),
            print_(grams=-0.1),
            print_(minutes=1.5),
            print_(minutes=-1),
            print_(result="ok"),
            print_(result="well", problem="warped"),  # a problem only when it failed
            print_(result="failed", problem="melted"),  # not on the list
            print_(extra="x"),  # nothing but the fields the app sends
        ]
        no_name = print_()
        no_name.pop("name")
        bad.append(no_name)
        for b in bad:
            self.assertEqual(self.save(ADA, [print_(1), b]), {"status": "invalid"}, b)
        self.assertEqual(self.save(ADA, "'{}'::jsonb"), {"status": "invalid"}, "an object, not a list")
        self.assertEqual(self.save(ADA, "null"), {"status": "invalid"})
        self.assertEqual(self.save(ADA, [print_(0), print_(0)]), {"status": "invalid"}, "one id twice")
        self.assertEqual(self.mine(ADA)["prints"], [], "nothing was written, not even the good print before the bad one")
        for problem in ["came-off", "warped", "stringing", "layer-shift", "spaghetti", "supports", "gaps", "wrong-size", "stopped", "other"]:
            self.assertEqual(self.save(ADA, [print_(5, result="failed", problem=problem)])["status"], "done", problem)
        self.assertEqual(self.save(ADA, [print_(6, result="failed", problem=None, made_at="2026-11-13T10:00:00+08:00")])["status"], "done", "failed with nothing picked, and an offset")
        self.assertEqual(self.save(ADA, [])["status"], "done", "an empty save is no harm")

    def test_the_text_limits_at_0_9x_and_1_1x(self):
        # name 100 (90 taken, 110 refused, 100 taken, 101 refused); settings 200; note 500. Characters, not bytes.
        for field, limit in [("name", 100), ("settings", 200), ("note", 500)]:
            self.assertEqual(self.save(ADA, [print_(1, **{field: "é" * (limit * 9 // 10)})])["status"], "done", field)
            self.assertEqual(self.save(ADA, [print_(1, **{field: "a" * (limit * 11 // 10)})]), {"status": "invalid"}, field)
            self.assertEqual(self.save(ADA, [print_(1, **{field: "a" * limit})])["status"], "done", field)
            self.assertEqual(self.save(ADA, [print_(1, **{field: "a" * (limit + 1)})]), {"status": "invalid"}, field)

    def test_weight_and_time_limits(self):
        # 100,000 g and 100,000 minutes (about 69 days) at most: 90,000 taken, 110,000 refused.
        for field in ["grams", "minutes"]:
            self.assertEqual(self.save(ADA, [print_(1, **{field: 90000})])["status"], "done", field)
            self.assertEqual(self.save(ADA, [print_(1, **{field: 110000})]), {"status": "invalid"}, field)
            self.assertEqual(self.save(ADA, [print_(1, **{field: 100000})])["status"], "done", field)

    def test_at_most_50_prints_a_save(self):
        # 45 (0.9 x 50) taken, 55 (1.1 x 50) refused; 50 taken, 51 refused.
        many = lambda start, n: [print_(start + i) for i in range(n)]
        self.assertEqual(len(self.save(ADA, many(0, 45))["saved"]), 45)
        self.assertEqual(self.save(ADA, many(100, 55)), {"status": "invalid"})
        self.assertEqual(len(self.save(ADA, many(200, 50))["saved"]), 50)
        self.assertEqual(self.save(ADA, many(300, 51)), {"status": "invalid"})

    def test_at_most_500_prints_a_person(self):
        # 450 (0.9x) kept; the next 50 fill it to 500 exactly; then 50 more (to 550, 1.1x) are all full.
        for start in range(0, 450, 50):
            self.save(ADA, [print_(start + i) for i in range(50)])
        self.assertEqual(len(self.mine(ADA)["prints"]), 450)
        answer = self.save(ADA, [print_(450 + i) for i in range(50)])
        self.assertEqual((len(answer["saved"]), answer["full"]), (50, []))
        answer = self.save(ADA, [print_(500 + i) for i in range(50)])
        self.assertEqual((answer["saved"], len(answer["full"])), ([], 50))
        # A change to one already kept still goes through when full.
        self.assertEqual(self.save(ADA, [print_(3, result="well", updated_at="2026-11-14T00:00:00Z")])["saved"], [pid(3)])
        # One deleted makes room for exactly one.
        self.assertEqual(self.delete(ADA, [pid(0)]), 1)
        answer = self.save(ADA, [print_(600), print_(601)])
        self.assertEqual((answer["saved"], answer["full"]), ([pid(600)], [pid(601)]))
        self.assertEqual(self.save(BO, [print_(700)])["saved"], [pid(700)], "Bo's space is his own")

    def test_delete_prints_at_most_500_at_once(self):
        self.save(ADA, [print_(0)])
        ok, out = self.as_user(ADA, f"select delete_prints(array(select '{pid(0)}'::uuid from generate_series(1, 501)));")
        self.assertFalse(ok)
        self.assertIn("at most 500", out)
        ok, out = self.as_user(ADA, f"select delete_prints(array(select '{pid(0)}'::uuid from generate_series(1, 450)));")
        self.assertEqual((ok, out), (True, "1"))

    def test_the_limits_the_app_reads_are_the_ones_held(self):
        self.assertEqual(json.loads(self.as_user(ADA, "select print_log_limits();")[1]),
                         {"max_prints": 500, "max_batch": 50, "max_name": 100, "max_settings": 200, "max_note": 500})

    # Turning it off, deleting

    def test_off_stops_every_save_and_deletes_what_was_kept(self):
        self.save(ADA, [print_(0)])
        self.save(BO, [print_(0)])
        self.assertEqual(self.as_user(ADA, "select set_keep_print_log(false);"), (True, "f"))
        self.assertEqual(self.mine(ADA), {"keep": False, "prints": []})
        self.assertEqual(self.save(ADA, [print_(1)]), {"status": "off"})
        self.assertEqual(self.save(ADA, "null"), {"status": "off"}, "off is said before anything is read")
        self.assertEqual(self.owner(f"select count(*) from print_log where user_id = '{ADA}';"), "0")
        self.assertEqual(len(self.mine(BO)["prints"]), 1, "Bo's choice is his own")
        self.assertEqual(self.as_user(ADA, "select set_keep_print_log(true);"), (True, "t"))
        self.assertEqual(self.mine(ADA), {"keep": True, "prints": []}, "nothing comes back")
        self.assertEqual(self.as_user(ADA, "select set_keep_print_log(null);"), (True, "f"), "anything but true is off")

    def test_the_copy_starts_afresh_when_keeping_is_turned_back_on_or_deleted(self):
        # A device remembering the prints it last saw must not take an empty fresh copy for deletions elsewhere.
        first = self.mine(ADA, since=True)["since"]
        self.assertEqual(self.as_user(ADA, "select set_keep_print_log(true);"), (True, "t"))
        self.assertEqual(self.mine(ADA, since=True)["since"], first, "on and on again: the same copy")
        self.save(ADA, [print_(0)])
        self.assertEqual(self.mine(ADA, since=True)["since"], first, "a save: the same copy")
        self.as_user(ADA, "select set_keep_print_log(false);")
        off = self.mine(ADA, since=True)["since"]
        self.assertNotEqual(off, first)
        self.as_user(ADA, "select set_keep_print_log(true);")
        on = self.mine(ADA, since=True)["since"]
        self.assertNotEqual(on, off)
        self.save(ADA, [print_(0)])
        self.assertEqual(self.as_user(ADA, "select delete_my_print_log();"), (True, "t"))
        deleted = self.mine(ADA, since=True)["since"]
        self.assertNotEqual(deleted, on)
        self.assertEqual(self.as_user(ADA, "select delete_my_print_log();"), (True, "f"))
        self.assertEqual(self.mine(ADA, since=True)["since"], deleted, "nothing deleted: the same copy")
        self.assertEqual(self.mine(BO, since=True)["since"] < deleted, True, "Bo's copy is his own")

    def test_delete_my_print_log_empties_only_the_persons_own(self):
        self.save(ADA, [print_(0), print_(1)])
        self.save(BO, [print_(0)])
        self.assertEqual(self.as_user(ADA, "select delete_my_print_log();"), (True, "t"))
        self.assertEqual(self.as_user(ADA, "select delete_my_print_log();"), (True, "f"), "nothing left the second time")
        self.assertEqual(len(self.mine(BO)["prints"]), 1)

    def test_my_data_holds_the_prints_and_the_keep_choice(self):
        self.assertEqual(json.loads(self.as_role("postgres", "select my_data();", ADA)[1])["print_log"], [], "none kept: an empty list")
        self.save(ADA, [print_(0, note="Ada's note")])
        self.save(BO, [print_(1, note="Bo's note")])
        data = json.loads(self.as_role("postgres", "select my_data();", ADA)[1])
        self.assertEqual([p["note"] for p in data["print_log"]], ["Ada's note"])
        self.assertTrue(data["profile"]["keep_print_log"])
        self.assertIn("print_log_since", data["profile"])
        self.assertNotIn("Bo's", json.dumps(data))

    def test_deleting_the_account_deletes_its_prints_and_no_one_elses(self):
        self.save(ADA, [print_(0)])
        self.save(BO, [print_(0)])
        self.assertTrue(self.as_user(ADA, "select delete_my_account();")[0])
        self.assertEqual(self.owner("select count(*) from print_log;"), "1")
        self.assertEqual(self.owner(f"select count(*) from print_log where user_id = '{BO}';"), "1")


if __name__ == "__main__":
    unittest.main()
