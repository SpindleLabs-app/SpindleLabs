"""Earlier versions in the account (supabase/migrations/20261105180000_design_versions.sql), on a real PostgreSQL.

Same throwaway cluster, roles and helpers as test_designs.py. The points: a save keeps the copy it replaces as a
version at most every 10 minutes of the server's clock (0.9x not kept, 1.1x kept; the server's clock is moved on in
step with the save times, see history_in_time; test_design_versions_time.py has devices whose clocks are wrong), the
newest 20 of each design; versions never cost a save (the oldest go first when the space is full); and nobody can
list, read or delete another person's versions.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import unittest

from test_database import ADA, BO, Cluster
import test_designs  # its class, imported by name, would be run twice


MIB = 1024 * 1024
DAY = "2026-11-05"


def at(minutes, seconds=0):
    """A save time on the test day, `minutes` (and `seconds`) after 09:00 UTC."""
    total = 9 * 3600 + minutes * 60 + seconds
    return f"{DAY} {total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}+00"


class DesignVersionsDatabase(unittest.TestCase):
    setUpClass = classmethod(test_designs.DesignsDatabase.setUpClass.__func__)
    tearDownClass = classmethod(test_designs.DesignsDatabase.tearDownClass.__func__)
    setUp = test_designs.DesignsDatabase.setUp
    owner = test_designs.DesignsDatabase.owner
    as_role = test_designs.DesignsDatabase.as_role
    as_user = test_designs.DesignsDatabase.as_user
    denied = test_designs.DesignsDatabase.denied

    def save(self, uid, body, when, design_id=None, expected=None):
        """save_design as `uid` with file text `body` (an SQL expression) saved at `when`; the answer as a dict."""
        did = f"'{design_id}'" if design_id else "null"
        exp = str(expected) if expected is not None else "null"
        ok, out = self.as_user(uid, f"select save_design({did}, {exp}, 'Box', 'design', {body}, null, '{when}');")
        self.assertTrue(ok, out)
        return json.loads(out)

    def history(self, uid, bodies_and_times):
        """Saves one design through each (body, when) in turn; returns its id."""
        first = self.save(uid, *bodies_and_times[0])
        did, rev = first["id"], first["revision"]
        for body, when in bodies_and_times[1:]:
            answer = self.save(uid, body, when, did, rev)
            self.assertEqual(answer["status"], "saved", answer)
            rev = answer["revision"]
        return did

    def pass_time(self, seconds):
        """The server's clock moving on `seconds`: now() can't be moved, so every server time already written (designs'
        updated_at, versions' kept_at) moves back by that much instead."""
        self.owner(f"update designs set updated_at = updated_at - make_interval(secs => {seconds}); "
                   f"update design_versions set kept_at = kept_at - make_interval(secs => {seconds});")

    def history_in_time(self, uid, bodies_and_times):
        """As history, from a device whose clock is right: between saves the server's clock moves on as much as the
        save times do. Returns the design's id and its revision."""
        first = self.save(uid, *bodies_and_times[0])
        did, rev, before = first["id"], first["revision"], bodies_and_times[0][1]
        for body, when in bodies_and_times[1:]:
            self.pass_time(self.owner(f"select extract(epoch from '{when}'::timestamptz - '{before}'::timestamptz);"))
            answer = self.save(uid, body, when, did, rev)
            self.assertEqual(answer["status"], "saved", answer)
            rev, before = answer["revision"], when
        return did, rev

    def kept(self, uid, did):
        """The design's version times as minutes:seconds after 09:00, newest first."""
        ok, out = self.as_user(uid, f"select string_agg(to_char(saved_at at time zone 'UTC', 'HH24:MI:SS'), ',') from design_versions('{did}');")
        self.assertTrue(ok, out)
        return out.split(",") if out else []

    # Which saves are kept

    def test_hand_worked_one_version_every_ten_minutes(self):
        # A at 09:00, B at 09:05, C at 09:12, D at 09:20.
        # Saving B replaces A (09:00): no version yet, so A is kept.
        # Saving C replaces B (09:05): the newest version is 09:00, only 5 min older: not kept.
        # Saving D replaces C (09:12): 12 min after 09:00, at least 10: kept. So 09:12 and 09:00, newest first.
        # (Each save reaches the server as many minutes after the one before as its device time says.)
        did, _ = self.history_in_time(ADA, [("'A'", at(0)), ("'B'", at(5)), ("'C'", at(12)), ("'D'", at(20))])
        self.assertEqual(self.kept(ADA, did), ["09:12:00", "09:00:00"])
        # Each is the text it had then.
        self.assertEqual(self.as_user(ADA, f"select get_design_version('{did}', '{at(12)}')->>'body';"), (True, "C"))
        self.assertEqual(self.as_user(ADA, f"select get_design_version('{did}', '{at(0)}')->>'body';"), (True, "A"))
        self.assertEqual(self.as_user(ADA, f"select get_design_version('{did}', '{at(5)}') is null;"), (True, "t"), "B was never kept")

    def test_the_ten_minute_gap_at_0_9x_and_1_1x(self):
        # Versions at 09:00 then a replaced copy that reached the server 540 s later (0.9 x 600 s): not kept. (Each
        # replaced copy here stood 8 minutes, under 10, so only the gap after the newest version decides; how long a
        # copy stood is test_design_versions_session.py's.)
        did, _ = self.history_in_time(ADA, [("'A'", at(0)), ("'B'", at(9)), ("'C'", at(17))])
        self.assertEqual(self.kept(ADA, did), ["09:00:00"])
        # 660 s later (1.1 x 600 s): kept.
        did, _ = self.history_in_time(ADA, [("'A'", at(0)), ("'B'", at(11)), ("'C'", at(19))])
        self.assertEqual(self.kept(ADA, did), ["09:11:00", "09:00:00"])

    def test_a_save_of_the_same_text_keeps_no_version(self):
        did = self.history(ADA, [("'A'", at(0)), ("'A'", at(30))])
        self.assertEqual(self.kept(ADA, did), [])

    def test_the_newest_20_of_each_design(self):
        # 26 saves 11 minutes apart replace 25 copies, each kept; only the newest 20 stay (the 6th to the 25th).
        did, _ = self.history_in_time(ADA, [(f"'v{i}'", at(11 * i)) for i in range(26)])
        times = self.kept(ADA, did)
        self.assertEqual(len(times), 20)
        self.assertEqual(times[0], at(11 * 24)[11:19])
        self.assertEqual(times[-1], at(11 * 5)[11:19])
        # Another design's versions are counted on their own.
        other = self.history(ADA, [("'x'", at(0)), ("'y'", at(20))])
        self.assertEqual(len(self.kept(ADA, other)), 1)
        self.assertEqual(len(self.kept(ADA, did)), 20)

    def test_a_new_design_and_a_refused_save_keep_no_version(self):
        first = self.save(ADA, "'A'", at(0))
        self.assertEqual(self.kept(ADA, first["id"]), [])
        stale = self.save(ADA, "'B'", at(20), first["id"], first["revision"] + 5)
        self.assertEqual(stale["status"], "changed")
        self.assertEqual(self.kept(ADA, first["id"]), [])

    # Space

    def test_versions_count_in_the_space_and_the_oldest_go_first_worked_by_hand(self):
        # One design saved four times 11 min apart at 4 MiB each: the design (4) and three versions (12) = 16 MiB.
        big = lambda c: f"repeat('{c}', {4 * MIB})"
        did, rev = self.history_in_time(ADA, [(big("a"), at(0)), (big("b"), at(11)), (big("c"), at(22)), (big("d"), at(33))])
        space = json.loads(self.as_user(ADA, "select my_design_space();")[1])
        self.assertEqual((space["bytes"], space["version_bytes"]), (16 * MIB, 12 * MIB))
        # A second design of 3 MiB: designs alone 7 MiB fit, but with the versions 19 MiB, still under 20.
        self.pass_time(7 * 60)  # 09:33 to 09:40
        self.assertEqual(self.save(ADA, f"repeat('z', {3 * MIB})", at(40))["status"], "saved")
        self.assertEqual(self.kept(ADA, did), ["09:22:00", "09:11:00", "09:00:00"])
        # Saving the first design again keeps 09:33 as a version: designs 7 + versions 16 = 23 MiB, over 20. The oldest
        # (09:00, 4 MiB) goes: 19 MiB, under 20, so it is the only one to go.
        self.pass_time(4 * 60)  # 09:40 to 09:44
        self.assertEqual(rev, 4)
        self.assertEqual(self.save(ADA, big("e"), at(44), did, 4)["status"], "saved")
        self.assertEqual(self.kept(ADA, did), ["09:33:00", "09:22:00", "09:11:00"])
        space = json.loads(self.as_user(ADA, "select my_design_space();")[1])
        self.assertEqual(space["bytes"], 19 * MIB)
        self.assertLessEqual(space["bytes"], space["max_bytes"])

    def test_a_save_too_big_for_the_designs_alone_is_full_and_deletes_no_version(self):
        big = lambda c, mib: f"repeat('{c}', {mib * MIB})"
        did = self.history(ADA, [(big("a", 5), at(0)), (big("b", 5), at(11))])
        for i in range(3):
            self.assertEqual(self.save(ADA, big(str(i), 5), at(20 + i))["status"], "saved")
        # Designs: 4 x 5 = 20 MiB; Ada's one version (5 MiB) was given up to make room on the way.
        self.assertEqual(self.save(ADA, "'one more byte'", at(30))["status"], "full")
        self.assertEqual(json.loads(self.as_user(ADA, "select my_design_space();")[1])["bytes"], 20 * MIB)
        self.assertEqual(self.kept(ADA, did), [])

    # Nobody else

    def test_another_person_can_neither_list_nor_read_your_versions(self):
        did = self.history(ADA, [("'secret A'", at(0)), ("'B'", at(20))])
        self.assertEqual(self.kept(BO, did), [])
        self.assertEqual(self.as_user(BO, f"select get_design_version('{did}', '{at(0)}') is null;"), (True, "t"))
        self.assertNotIn("secret A", self.as_user(BO, "select my_data()::text;")[1])
        self.assertIn("secret A", self.as_user(ADA, "select my_data()::text;")[1])

    def test_the_table_and_the_part_are_closed_to_the_browser(self):
        self.history(ADA, [("'A'", at(0)), ("'B'", at(20))])
        for role in ["anon", "authenticated"]:
            self.denied(self.as_role(role, "select * from design_versions;", ADA))
            self.denied(self.as_role(role, f"delete from design_versions where user_id = '{ADA}';", ADA))
        self.denied(self.as_user(ADA, "select my_data_part_design_versions();"))
        for call in [f"design_versions('{ADA}')", f"get_design_version('{ADA}', now())"]:
            self.denied(self.as_role("anon", f"select {call};"))

    def test_saving_over_someone_elses_design_keeps_no_version_in_it(self):
        did = self.history(ADA, [("'A'", at(0))])
        self.assertEqual(self.save(BO, "'mine now'", at(20), did, 1)["status"], "gone")
        self.assertEqual(self.owner("select count(*) from design_versions;"), "0")

    # Deleting

    def test_deleting_a_design_or_the_account_deletes_its_versions_and_no_one_elses(self):
        mine = self.history(ADA, [("'A'", at(0)), ("'B'", at(20))])
        also = self.history(ADA, [("'C'", at(0)), ("'D'", at(20))])
        bos = self.history(BO, [("'E'", at(0)), ("'F'", at(20))])
        self.assertEqual(self.as_user(ADA, f"select delete_design('{mine}');"), (True, "t"))
        self.assertEqual(self.owner(f"select count(*) from design_versions where design_id = '{mine}';"), "0")
        self.assertEqual(self.owner(f"select count(*) from design_versions where design_id = '{also}';"), "1")
        self.owner(f"delete from auth.users where id = '{ADA}';")
        self.assertEqual(self.owner(f"select count(*) from design_versions where user_id = '{ADA}';"), "0")
        self.assertEqual(self.owner(f"select count(*) from design_versions where design_id = '{bos}';"), "1")

    def test_download_my_data_holds_every_version_whole(self):
        did = self.history(ADA, [("'{\"v\":1}'", at(0)), ("'{\"v\":2}'", at(20))])
        data = json.loads(self.as_user(ADA, "select my_data();")[1])
        self.assertEqual([(v["design_id"], v["file"]) for v in data["design_versions"]], [(did, '{"v":1}')])
        self.assertEqual(json.loads(self.as_user(BO, "select my_data();")[1])["design_versions"], [])


if __name__ == "__main__":
    unittest.main()
