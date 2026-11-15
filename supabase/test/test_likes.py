"""Likes (supabase/migrations/20261111170000_likes.sql), checked on a real PostgreSQL.

Same throwaway cluster and roles as test_database.py. The point of most tests here is abuse: nobody likes their own
link or likes twice, nobody learns who liked, the off switch and holds stop liking, held accounts' likes stop
counting, the daily cap holds at 0.9x and refuses at 1.1x, and nothing is left behind when a link or account goes.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import os
import unittest

from test_database import ADA, BO, HERE, MIGRATIONS, Cluster

CY = "33333333-3333-4333-8333-333333333333"
DEE = "44444444-4444-4444-8444-444444444444"
CAP = 300  # like_limits().changes_per_day


class LikesDatabase(unittest.TestCase):
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
        for uid, email in [(ADA, "ada@example.com"), (BO, "bo@example.com"), (CY, "cy@example.com"), (DEE, "dee@example.com")]:
            self.owner(f"insert into auth.users (id, email) values ('{uid}', '{email}');")
        self.owner("update share_switch set sharing_on = true;")
        # Ada shares a design; the others like it.
        self.link = self.share(ADA)

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

    def share(self, uid):
        ok, out = self.as_user(uid, "select share_design('Box', '{\"name\":\"Box\"}', null);")
        self.assertTrue(ok, out)
        answer = json.loads(out)
        self.assertEqual(answer["status"], "shared", answer)
        return answer["id"]

    def like(self, uid, link=None):
        ok, out = self.as_user(uid, f"select like_share('{link or self.link}');")
        self.assertTrue(ok, out)
        return out

    def unlike(self, uid, link=None):
        ok, out = self.as_user(uid, f"select unlike_share('{link or self.link}');")
        self.assertTrue(ok, out)
        return out

    def count(self, role="anon", uid=None, link=None):
        ok, out = self.as_role(role, f"select like_count('{link or self.link}');", uid)
        self.assertTrue(ok, out)
        return int(out) if out else None

    def hold(self, uid, until="null"):
        self.owner(f"set role service_role; select hold_account('{uid}', {until}, 'like ring', false, 'mod', ''); reset role;")

    def fill_changes(self, uid, n, age="0 seconds"):
        """n of `uid`'s daily changes, made `age` ago."""
        self.owner(f"insert into like_actions (user_id, at) select '{uid}', now() - interval '{age}' from generate_series(1, {n});")

    # Hand-worked

    def test_three_people_like_one_is_held_so_two_count(self):
        # Bo, Cy and Dee each like Ada's link once: 3. Dee is then held by moderation, and a held account's likes
        # don't count: 3 - 1 = 2. The hold ends: Dee's like counts again, 3. Ada's own try is refused and adds nothing.
        for uid in (BO, CY, DEE):
            self.assertEqual(self.like(uid), "liked")
        self.assertEqual(self.like(ADA), "own")
        self.assertEqual(self.count(), 3)
        self.hold(DEE)
        self.assertEqual(self.count(), 2)
        self.owner(f"set role service_role; select end_hold('{DEE}', 'mod', ''); reset role;")
        self.assertEqual(self.count(), 3)

    def test_a_hold_that_has_ended_by_its_date_counts_again(self):
        self.like(BO)
        self.hold(BO, "now() + interval '1 hour'")
        self.assertEqual(self.count(), 0)
        self.owner(f"update account_holds set until = now() - interval '1 second' where user_id = '{BO}';")
        self.assertEqual(self.count(), 1)

    # One per person, never your own

    def test_liking_twice_is_one_like_and_costs_nothing_the_second_time(self):
        self.assertEqual(self.like(BO), "liked")
        self.assertEqual(self.like(BO), "already")
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.owner(f"select count(*) from like_actions where user_id = '{BO}';"), "1")

    def test_the_table_itself_refuses_a_second_like(self):
        self.like(BO)
        ok, out = self.pg.psql(f"insert into share_likes (share_id, user_id) values ('{self.link}', '{BO}');")
        self.assertFalse(ok)
        self.assertIn("duplicate key", out)

    def test_nobody_likes_their_own_link(self):
        self.assertEqual(self.like(ADA), "own")
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.owner("select count(*) from share_likes;"), "0")

    def test_unlike_and_like_again(self):
        self.like(BO)
        self.assertEqual(self.unlike(BO), "unliked")
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.unlike(BO), "not-liked")
        self.assertEqual(self.like(BO), "liked")
        self.assertEqual(self.count(), 1)

    def test_signed_out_people_see_counts_but_cannot_like(self):
        self.like(BO)
        self.assertEqual(self.count("anon"), 1)
        self.denied(self.as_role("anon", f"select like_share('{self.link}');"))
        self.denied(self.as_role("anon", f"select unlike_share('{self.link}');"))
        self.denied(self.as_role("anon", f"select i_like('{self.link}');"))

    def test_a_link_that_never_was_is_gone(self):
        self.assertEqual(self.like(BO, "00000000-0000-4000-8000-000000000000"), "gone")
        self.assertIsNone(self.count(link="00000000-0000-4000-8000-000000000000"))

    # Never who

    def test_nobody_reads_who_liked(self):
        self.like(BO)
        for role, uid in [("anon", None), ("authenticated", ADA), ("authenticated", BO)]:
            self.denied(self.as_role(role, "select * from share_likes;", uid))
            self.denied(self.as_role(role, "select * from like_actions;", uid))
            self.denied(self.as_role(role, "insert into share_likes (share_id, user_id) values (gen_random_uuid(), gen_random_uuid());", uid))
            self.denied(self.as_role(role, "select take_like_change(gen_random_uuid());", uid))
            self.denied(self.as_role(role, "select setval('like_actions_id_seq', 1);", uid))

    def test_i_like_answers_only_for_me(self):
        self.like(BO)
        self.assertEqual(self.as_user(BO, f"select i_like('{self.link}');"), (True, "t"))
        self.assertEqual(self.as_user(CY, f"select i_like('{self.link}');"), (True, "f"))
        self.assertEqual(self.as_user(ADA, f"select i_like('{self.link}');"), (True, "f"))

    # The off switch, take-downs and turning a link off

    def test_while_sharing_is_off_nobody_likes_or_sees_counts_but_can_take_a_like_back(self):
        self.like(BO)
        self.like(CY)
        self.owner("update share_switch set sharing_on = false;")
        self.assertEqual(self.like(DEE), "off")
        self.assertIsNone(self.count())
        self.assertEqual(self.as_user(BO, f"select i_like('{self.link}');"), (True, "f"))
        self.assertEqual(self.unlike(CY), "unliked")
        self.owner("update share_switch set sharing_on = true;")
        self.assertEqual(self.count(), 1)

    def test_a_link_taken_down_shows_no_count_and_takes_no_likes_until_put_back(self):
        self.like(BO)
        self.owner(f"set role service_role; select decide_share('{self.link}', 'take-down', 'mod', ''); reset role;")
        self.assertIsNone(self.count())
        self.assertEqual(self.like(CY), "gone")
        self.owner(f"set role service_role; select decide_share('{self.link}', 'put-back', 'mod', ''); reset role;")
        self.assertEqual(self.count(), 1)

    def test_turning_a_link_off_deletes_its_likes(self):
        self.like(BO)
        self.like(CY)
        other = self.share(ADA)
        self.like(BO, other)
        self.assertEqual(self.as_user(ADA, f"select unshare('{self.link}');"), (True, "t"))
        self.assertEqual(self.owner(f"select count(*) from share_likes where share_id = '{self.link}';"), "0")
        self.assertIsNone(self.count())
        self.assertEqual(self.like(DEE), "gone")
        # Ada's other link keeps its like.
        self.assertEqual(self.count(link=other), 1)

    # Holds

    def test_a_held_account_cannot_like(self):
        self.hold(BO)
        self.assertEqual(self.like(BO), "held")
        self.assertEqual(self.owner("select count(*) from share_likes;"), "0")
        # The refused like took back the change it counted.
        self.assertEqual(self.owner(f"select count(*) from like_actions where user_id = '{BO}';"), "0")
        # Taking an old like back is still allowed.
        self.owner(f"delete from account_holds where user_id = '{BO}';")
        self.like(BO)
        self.hold(BO)
        self.assertEqual(self.unlike(BO), "unliked")

    def test_the_hold_is_enforced_by_the_table_not_only_the_function(self):
        self.hold(BO)
        ok, out = self.pg.psql(f"insert into share_likes (share_id, user_id) values ('{self.link}', '{BO}');")
        self.assertFalse(ok)
        self.assertIn("account held", out)

    # The daily cap (300 likes and unlikes together in the last 24 hours)

    def test_the_daily_cap_at_0_9x_likes(self):
        # 0.9 x 300 = 270: with 269 changes made, the 270th is a like.
        self.fill_changes(BO, int(0.9 * CAP) - 1)
        self.assertEqual(self.like(BO), "liked")

    def test_the_daily_cap_at_1_1x_is_refused(self):
        # 1.1 x 300 = 330: changes 301 to 330 are all refused, likes and unlikes alike.
        self.like(BO)
        self.fill_changes(BO, CAP - 1)
        other = self.share(CY)
        for _ in range(int(1.1 * CAP) - CAP):
            self.assertEqual(self.like(BO, other), "daily")
        self.assertEqual(self.unlike(BO), "daily")
        self.assertEqual(self.count(link=other), 0)
        self.assertEqual(self.count(), 1)

    def test_the_cap_is_exactly_300(self):
        self.fill_changes(BO, CAP - 1)
        self.assertEqual(self.like(BO), "liked")
        self.assertEqual(self.unlike(BO), "daily")

    def test_changes_older_than_a_day_are_forgotten(self):
        self.fill_changes(BO, CAP, "24 hours 1 second")
        self.assertEqual(self.like(BO), "liked")
        self.assertEqual(self.owner(f"select count(*) from like_actions where user_id = '{BO}';"), "1")

    def test_like_spam_by_toggling_never_inflates_the_count(self):
        for _ in range(20):
            self.like(BO)
            self.like(BO)
            self.unlike(BO)
        self.like(BO)
        self.assertEqual(self.count(), 1)

    # Download my data and deleting the account

    def test_my_data_lists_my_likes_and_nobody_elses(self):
        self.like(BO)
        self.like(CY)
        mine = json.loads(self.as_role("postgres", "select my_data();", BO)[1])["likes"]
        self.assertEqual([l["share_id"] for l in mine], [self.link])
        self.assertEqual(json.loads(self.as_role("postgres", "select my_data();", ADA)[1])["likes"], [])

    def test_deleting_an_account_takes_its_likes_and_the_likes_on_its_links(self):
        self.like(BO)
        other = self.share(BO)
        self.like(CY, other)
        ok, out = self.as_user(BO, "select delete_my_account();")
        self.assertTrue(ok, out)
        self.assertEqual(self.owner(f"select count(*) from share_likes where user_id = '{BO}' or share_id = '{other}';"), "0")
        self.assertEqual(self.owner(f"select count(*) from like_actions where user_id = '{BO}';"), "0")
        self.assertEqual(self.count(), 0)


if __name__ == "__main__":
    unittest.main()
