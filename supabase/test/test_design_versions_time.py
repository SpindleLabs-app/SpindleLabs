"""save_design's save time and revision checks (supabase/migrations/20261111150000_design_versions_server_time.sql).

Same throwaway cluster and helpers as test_design_versions.py. The points: a save time that is not finite, or more
than a day ahead of the server's clock, is refused as "too-big" (0.9 and 1.1 days, and the exact day) and writes
nothing; a design already holding such a time can still be saved over; and a save over an existing design that names
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
    history = test_design_versions.DesignVersionsDatabase.history
    kept = test_design_versions.DesignVersionsDatabase.kept

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

    def test_a_save_time_ahead_of_the_server_at_0_9_and_1_1_days(self):
        # One day is 86400 s: 0.9 x = 77760 s ahead is a clock a little wrong, kept; 1.1 x = 95040 s is refused.
        self.assertEqual(round(0.9 * DAY_SECONDS), 77760)
        self.assertEqual(round(1.1 * DAY_SECONDS), 95040)
        self.assertEqual(self.save_at("now() + interval '77760 seconds'")["status"], "saved")
        self.assertEqual(self.save_at("now() + interval '95040 seconds'"), {"status": "too-big"})
        self.assertEqual(self.designs(), "1")

    def test_exactly_one_day_ahead_is_the_last_time_kept(self):
        # now() is the same within one statement, so these compare against the very now() save_design sees.
        self.assertEqual(self.save_at("now() + interval '1 day'")["status"], "saved")
        self.assertEqual(self.save_at("now() + interval '1 day 1 microsecond'"), {"status": "too-big"})
        # A clock behind the server is never refused: a year back still saves.
        self.assertEqual(self.save_at("now() - interval '1 year'")["status"], "saved")

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
        did = self.history(ADA, [("'A'", "2026-11-05 09:00+00"), ("'B'", "2026-11-05 09:20+00")])
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
