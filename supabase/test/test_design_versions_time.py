"""save_design's save time and revision checks (supabase/migrations/20261111150000_design_versions_server_time.sql).

Same throwaway cluster and helpers as test_design_versions.py. The points: versions are decided by the server's clock,
whatever the devices' clocks say (a device a day fast, the 10-minute gap at 0.9x/1.1x of server time, labels 0.9 and
1.1 days ahead); a save time that is not finite is refused as "too-big" and writes nothing; a design already holding
one can still be saved over; and a save over an existing design that names
no revision is "changed", never "gone".
Run: python3 -m unittest discover -s supabase/test
"""

import json
import unittest

from test_database import ADA
import test_design_versions  # their classes, imported by name, would be run twice
import test_designs

DAY_SECONDS = 24 * 3600


class DesignSaveTimeDatabase(unittest.TestCase):
    setUpClass = classmethod(test_designs.DesignsDatabase.setUpClass.__func__)
    tearDownClass = classmethod(test_designs.DesignsDatabase.tearDownClass.__func__)
    setUp = test_design_versions.DesignVersionsDatabase.setUp
    owner = test_design_versions.DesignVersionsDatabase.owner
    as_role = test_design_versions.DesignVersionsDatabase.as_role
    as_user = test_design_versions.DesignVersionsDatabase.as_user
    denied = test_design_versions.DesignVersionsDatabase.denied
    save = test_design_versions.DesignVersionsDatabase.save
    kept = test_design_versions.DesignVersionsDatabase.kept
    pass_time = test_design_versions.DesignVersionsDatabase.pass_time
    history_in_time = test_design_versions.DesignVersionsDatabase.history_in_time

    def save_at(self, when_sql, body="'A'", design_id=None, expected=None):
        """save_design with saved_at given as an SQL expression (so it can use the server's now())."""
        did = f"'{design_id}'" if design_id else "null"
        exp = str(expected) if expected is not None else "null"
        ok, out = self.as_user(ADA, f"select save_design({did}, {exp}, 'Box', 'design', {body}, null, {when_sql});")
        self.assertTrue(ok, out)
        return json.loads(out)

    def designs(self):
        return self.owner("select count(*) from designs;")

    # A save time no clock gives

    def test_an_infinite_save_time_is_refused_and_writes_nothing(self):
        for when in ["'infinity'::timestamptz", "'-infinity'::timestamptz"]:
            self.assertEqual(self.save_at(when), {"status": "too-big"}, when)
        self.assertEqual(self.designs(), "0")
        # Over an existing design too: nothing changes, no version is kept.
        first = self.save_at("now()")
        self.assertEqual(self.save_at("'infinity'::timestamptz", "'B'", first["id"], first["revision"]), {"status": "too-big"})
        self.assertEqual(self.owner(f"select revision || ' ' || body from designs where id = '{first['id']}';"), "1 A")
        self.assertEqual(self.kept(ADA, first["id"]), [])

    def labels(self, did):
        """The design's version labels (device times) as text, newest label first."""
        ok, out = self.as_user(ADA, f"select string_agg(saved_at::text, ',') from design_versions('{did}');")
        self.assertTrue(ok, out)
        return out.split(",") if out else []

    # The server's clock decides, whatever the devices' clocks say

    def test_a_device_a_day_fast_then_a_right_one_every_30_minutes_for_2_hours(self):
        # Real time 09:00: device A, its clock a day fast, saves the design (label 2026-11-06 09:00).
        # Device B, its clock right, saves over it at 09:30, 10:00, 10:30 and 11:00 (real and device time).
        # Each of B's saves replaces a state that reached the server 30 min (>= 10) after the newest version did,
        # or the design has none yet, so each replaced state is kept: A's (09:00 server), B's 09:30, 10:00 and 10:30.
        # 4 versions. (With the device clocks deciding, A's label a day ahead kept every one of B's out: 1 version.)
        first = self.save_at("'2026-11-06 09:00+00'")
        did, rev = first["id"], first["revision"]
        for when in ["09:30", "10:00", "10:30", "11:00"]:
            self.pass_time(30 * 60)
            answer = self.save_at(f"'2026-11-05 {when}+00'", f"'B {when}'", did, rev)
            self.assertEqual(answer["status"], "saved", answer)
            rev = answer["revision"]
        # Listed newest label first: A's label a day ahead is still its label.
        self.assertEqual(self.labels(did), ["2026-11-06 09:00:00+00", "2026-11-05 10:30:00+00", "2026-11-05 10:00:00+00", "2026-11-05 09:30:00+00"])

    def test_the_ten_minute_gap_by_the_servers_clock_at_0_9x_and_1_1x(self):
        # The labels are deliberately wrong and out of order (a year back, a day ahead, now): only server time counts.
        # A reaches the server at 0 s; 540 s later (0.9 x 600 s) B replaces it: no version yet, so A is kept (0 s).
        # 100 s later C replaces B, which reached the server at 540 s: 540 - 0 = 540 < 600, so B is not kept.
        first = self.save_at("now() - interval '1 year'")
        self.pass_time(540)
        self.save_at("now() + interval '1 day'", "'B'", first["id"], 1)
        self.pass_time(100)
        self.save_at("now()", "'C'", first["id"], 2)
        self.assertEqual(len(self.labels(first["id"])), 1)
        # The same at 660 s (1.1 x 600 s): 660 - 0 = 660 >= 600, so B is kept too.
        first = self.save_at("now() - interval '1 year'")
        self.pass_time(660)
        self.save_at("now() + interval '1 day'", "'B'", first["id"], 1)
        self.pass_time(100)
        self.save_at("now()", "'C'", first["id"], 2)
        self.assertEqual(len(self.labels(first["id"])), 2)

    def test_a_save_time_0_9_or_1_1_days_ahead_is_kept_as_its_label_and_blocks_nothing(self):
        # One day is 86400 s: 0.9 x = 77760 s and 1.1 x = 95040 s ahead are both saved (only the label is wrong).
        self.assertEqual(round(0.9 * DAY_SECONDS), 77760)
        self.assertEqual(round(1.1 * DAY_SECONDS), 95040)
        self.assertEqual(self.save_at("now() + interval '77760 seconds'")["status"], "saved")
        first = self.save_at("now() + interval '95040 seconds'")
        self.assertEqual(first["status"], "saved")
        # A right clock then saves over it twice, 11 min of server time apart: the 1.1-day copy is kept (the first
        # version), and the right clock's own copy too (11 >= 10 min after the first by the server), so 2.
        self.pass_time(11 * 60)
        self.assertEqual(self.save_at("now()", "'B'", first["id"], 1)["status"], "saved")
        self.pass_time(11 * 60)
        self.assertEqual(self.save_at("now()", "'C'", first["id"], 2)["status"], "saved")
        self.assertEqual(len(self.labels(first["id"])), 2)

    def test_a_design_already_holding_an_infinite_time_can_still_be_saved_over(self):
        # A design kept before this check with saved_at 'infinity' (made by hand here): saving over it used to raise
        # "cannot subtract infinite timestamps" every time, so that project stopped every later sync round.
        first = self.save_at("now()")
        did = first["id"]
        self.owner(f"update designs set saved_at = 'infinity' where id = '{did}';")
        answer = self.save_at("'2026-11-05 09:00+00'", "'B'", did, 1)
        self.assertEqual(answer["status"], "saved", answer)
        # The replaced copy has no real time to label it, so it is not kept as a version.
        self.assertEqual(self.kept(ADA, did), [])
        # Saves after it keep versions as usual: B (09:00) replaced by C is the first version.
        self.assertEqual(self.save_at("'2026-11-05 09:30+00'", "'C'", did, 2)["status"], "saved")
        self.assertEqual(self.kept(ADA, did), ["09:00:00"])

    def test_an_infinite_newest_version_does_not_stop_versions(self):
        # A version labelled 'infinity' (kept before this check, made by hand here) is the newest; the next replaced
        # copy is still kept instead of the save raising.
        did, _ = self.history_in_time(ADA, [("'A'", "2026-11-05 09:00+00"), ("'B'", "2026-11-05 09:20+00")])
        self.pass_time(20 * 60)
        self.owner(f"update design_versions set saved_at = 'infinity' where design_id = '{did}';")
        self.assertEqual(self.save_at("'2026-11-05 09:40+00'", "'C'", did, 2)["status"], "saved")
        ok, out = self.as_user(ADA, f"select string_agg(saved_at::text, ',') from design_versions('{did}');")
        self.assertEqual((ok, out), (True, "infinity,2026-11-05 09:20:00+00"))

    # The revision a save names

    def test_a_save_over_an_existing_design_naming_no_revision_is_changed_not_gone(self):
        first = self.save_at("now()")
        # The design is there at revision 1; a null revision is not "the one last seen", so the save is refused as
        # "changed" with the current revision (1), and nothing is written.
        self.assertEqual(self.save_at("now()", "'B'", first["id"], None), {"status": "changed", "revision": 1})
        self.assertEqual(self.owner(f"select revision || ' ' || body from designs where id = '{first['id']}';"), "1 A")
        # The right revision still saves.
        self.assertEqual(self.save_at("now()", "'B'", first["id"], 1)["status"], "saved")


if __name__ == "__main__":
    unittest.main()
