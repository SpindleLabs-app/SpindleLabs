"""Earlier versions keep the state a work session ended in
(supabase/migrations/20261112140000_design_versions_session_end.sql; issue #628, item 3).

Same throwaway cluster and helpers as test_design_versions.py. The points: a replaced copy that stood in the account
for the 10-minute gap is kept whatever the newest version's time (a week later, and at 0.9x/1.1x of the gap by the
server's clock); copies replaced sooner are still one every 10 minutes at most; the newest 20 and the same-text rule
are as before.
Run: python3 -m unittest discover -s supabase/test
"""

import unittest

from test_database import ADA
import test_design_versions  # their classes, imported by name, would be run twice
import test_designs


class DesignVersionsSessionEnd(unittest.TestCase):
    setUpClass = classmethod(test_designs.DesignsDatabase.setUpClass.__func__)
    tearDownClass = classmethod(test_designs.DesignsDatabase.tearDownClass.__func__)
    setUp = test_design_versions.DesignVersionsDatabase.setUp
    owner = test_design_versions.DesignVersionsDatabase.owner
    as_role = test_design_versions.DesignVersionsDatabase.as_role
    as_user = test_design_versions.DesignVersionsDatabase.as_user
    save = test_design_versions.DesignVersionsDatabase.save
    pass_time = test_design_versions.DesignVersionsDatabase.pass_time
    history_in_time = test_design_versions.DesignVersionsDatabase.history_in_time

    def bodies(self, did):
        """The file text of each kept version, newest label first."""
        ok, out = self.as_user(ADA, f"select string_agg((get_design_version('{did}', v.saved_at)->>'body'), ',' order by v.saved_at desc) from design_versions('{did}') v;")
        self.assertTrue(ok, out)
        return out.split(",") if out else []

    def test_hand_worked_the_state_a_session_ended_in_is_kept_a_week_later(self):
        # Monday 09:00 to 09:09: a save a minute, w50 to w59. w50 is the first version (kept when w51 replaces it).
        # w51 to w58 each reached the account 1 to 8 min after it (under 10) and stood 1 min (under 10): not kept.
        monday = [(f"'w{50 + m}'", f"2026-11-02 09:{m:02d}:00+00") for m in range(10)]
        # The Monday after, 09:00: 'wrong1' replaces w59, which reached the account only 9 min after the newest
        # version but stood 7 days - 9 min: kept. 09:01: 'wrong2' replaces 'wrong1', which reached the account a
        # week after the newest version: kept, as before.
        later = [("'wrong1'", "2026-11-09 09:00:00+00"), ("'wrong2'", "2026-11-09 09:01:00+00")]
        did, _ = self.history_in_time(ADA, monday + later)
        self.assertEqual(self.bodies(did), ["wrong1", "w59", "w50"])

    def test_how_long_the_replaced_copy_stood_at_0_9x_and_1_1x(self):
        # A at 0 s; B replaces it 60 s later (A is the first version). B reached the account 60 s after the newest
        # version, under 600. C replaces B after B stood 540 s (0.9 x 600): B is not kept.
        first = self.save(ADA, "'A'", "2026-11-05 09:00:00+00")
        self.pass_time(60)
        self.save(ADA, "'B'", "2026-11-05 09:01:00+00", first["id"], 1)
        self.pass_time(540)
        self.save(ADA, "'C'", "2026-11-05 09:10:00+00", first["id"], 2)
        self.assertEqual(self.bodies(first["id"]), ["A"])
        # The same with B standing 660 s (1.1 x 600): kept.
        first = self.save(ADA, "'A'", "2026-11-05 09:00:00+00")
        self.pass_time(60)
        self.save(ADA, "'B'", "2026-11-05 09:01:00+00", first["id"], 1)
        self.pass_time(660)
        self.save(ADA, "'C'", "2026-11-05 09:12:00+00", first["id"], 2)
        self.assertEqual(self.bodies(first["id"]), ["B", "A"])

    def test_the_same_text_saved_again_keeps_no_version_however_long_it_stood(self):
        first = self.save(ADA, "'A'", "2026-11-05 09:00:00+00")
        self.pass_time(7 * 24 * 3600)
        self.assertEqual(self.save(ADA, "'A'", "2026-11-12 09:00:00+00", first["id"], 1)["status"], "saved")
        self.assertEqual(self.bodies(first["id"]), [])

    def test_the_newest_20_still(self):
        # 26 saves, each 11 minutes after the one before: 25 replaced copies, all kept by either rule; the newest 20 stay.
        did, _ = self.history_in_time(ADA, [(f"'v{i}'", f"2026-11-05 {9 + (11 * i) // 60:02d}:{(11 * i) % 60:02d}:00+00") for i in range(26)])
        self.assertEqual(self.bodies(did), [f"v{i}" for i in range(24, 4, -1)])


if __name__ == "__main__":
    unittest.main()
