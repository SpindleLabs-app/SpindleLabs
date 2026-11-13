"""Friends by profile ID (supabase/migrations/20261113180000_friends.sql), on a real PostgreSQL.

Same throwaway cluster, roles and helpers as test_designs.py. The points: nobody can be found except by their exact
ID, and having none (Friends off) means nobody can reach you; a request shows the asker's display name and nothing
else, and the asker sees only the ID they typed until it is accepted; decline and block are never told; a block
holds through everything until taken away; nobody can read or change another person's friends, requests or blocks;
every limit holds at 0.9x and refuses at 1.1x; and seeded random sessions of four people agree with a plain model.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import random
import re
import unittest

from test_database import ADA, BO
import test_designs  # its class, imported by name, would be run twice

CY = "33333333-3333-4333-8333-333333333333"
DI = "44444444-4444-4444-8444-444444444444"
NAMES = {ADA: "Ada M", BO: "Bo Builds", CY: "Cy3D", DI: "Di Prints"}
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


class FriendsDatabase(unittest.TestCase):
    setUpClass = classmethod(test_designs.DesignsDatabase.setUpClass.__func__)
    tearDownClass = classmethod(test_designs.DesignsDatabase.tearDownClass.__func__)
    owner = test_designs.DesignsDatabase.owner
    as_role = test_designs.DesignsDatabase.as_role
    as_user = test_designs.DesignsDatabase.as_user
    denied = test_designs.DesignsDatabase.denied

    def setUp(self):
        test_designs.DesignsDatabase.setUp(self)
        for uid in (CY, DI):
            self.owner(f"insert into auth.users (id, email) values ('{uid}', '{uid[:2]}@example.com');")
        for uid, name in NAMES.items():
            self.assertEqual(self.call(uid, f"set_display_name('{name}')"), "saved")

    # Helpers

    def call(self, uid, expr):
        ok, out = self.as_user(uid, f"select {expr};")
        self.assertTrue(ok, out)
        return out

    def on(self, *uids):
        for uid in uids:
            self.assertEqual(self.call(uid, "set_friends(true)"), "on")

    def shown(self, uid):
        return json.loads(self.call(uid, "my_friends()"))

    def code(self, uid):
        return self.shown(uid)["code"]

    def ask(self, uid, code):
        return self.call(uid, "send_friend_request(" + ("null" if code is None else "'" + code.replace("'", "''") + "'") + ")")

    def asking(self, uid):
        return self.shown(uid)["asking_me"]

    def friends(self, uid):
        return self.shown(uid)["friends"]

    def friend_names(self, uid):
        return sorted(f["name"] for f in self.friends(uid))

    def make_friends(self, one, two):
        self.on(one, two)
        self.assertEqual(self.ask(one, self.code(two)), "sent")
        req = self.asking(two)[0]["id"]
        self.assertEqual(self.call(two, f"accept_friend_request('{req}')"), "friends")

    # The ID

    def test_off_by_default_with_no_id_and_nothing_shown(self):
        self.assertEqual(self.shown(ADA), {"on": False, "code": None, "friends": [], "asking_me": [], "i_asked": [], "blocked": [], "tries_left": 20})

    def test_turning_on_gives_ten_characters_of_the_alphabet_and_again_the_same(self):
        self.on(ADA)
        code = self.code(ADA)
        self.assertRegex(code, r"^[0-9A-HJKMNP-TV-Z]{10}$")
        self.on(ADA)
        self.assertEqual(self.code(ADA), code, "turning on again keeps the ID")

    def test_ids_are_random_and_use_every_character(self):
        # 400 IDs, 4,000 characters: each of the 32 is expected 125 times; one missing or never-random would show.
        out = self.owner("select string_agg(friend_code_new(), ',') from generate_series(1, 400);")
        codes = out.split(",")
        self.assertEqual(len(set(codes)), 400, "no two alike")
        counts = {c: 0 for c in ALPHABET}
        for code in codes:
            self.assertRegex(code, r"^[0-9A-HJKMNP-TV-Z]{10}$")
            for c in code:
                counts[c] += 1
        # Worked by hand: a binomial count with n = 4000, p = 1/32 has mean 125 and spread sqrt(4000 * 1/32 * 31/32)
        # = 11.0, so 125 +- 60 is over five spreads either side: a fair draw stays inside, a biased alphabet doesn't.
        for c, n in counts.items():
            self.assertTrue(65 <= n <= 185, f"{c} came {n} times")
        # Each place in the ID on its own: the second half of the alphabet (16 of 32 characters) should come about
        # half the time. Worked by hand: binomial n = 400, p = 1/2, mean 200 and spread sqrt(400 / 4) = 10, so 140 to
        # 260 is six spreads either side. A place fed by a UUID's fixed version bits (0100....: never past the 16th
        # character) would come 0 times.
        for place in range(10):
            upper = sum(1 for code in codes if ALPHABET.index(code[place]) >= 16)
            self.assertTrue(140 <= upper <= 260, f"place {place}: second half {upper} times of 400")

    def test_a_typed_id_is_read_with_spaces_dashes_small_letters_and_o_i_l(self):
        cases = {"7KX2M-QD9TA": "7KX2MQD9TA", " 7kx2m qd9ta ": "7KX2MQD9TA", "OIL23-45678": "01123456 78".replace(" ", ""),
                 "7KX2MQD9T": None, "7KX2MQD9TAB": None, "7KX2MQD9TU": None, "7KX2M_QD9TA": None, "": None}
        for typed, want in cases.items():
            got = self.owner(f"select coalesce(friend_code_key('{typed}'), '-');")
            self.assertEqual(got, want or "-", typed)

    def test_a_new_id_stops_the_old_one_at_once(self):
        self.on(ADA, BO)
        old = self.code(BO)
        new = self.call(BO, "new_friend_code()")
        self.assertNotEqual(new, old)
        self.assertEqual(self.code(BO), new)
        self.assertEqual(self.ask(ADA, old), "not-found")
        self.assertEqual(self.ask(ADA, new), "sent")
        self.assertEqual(self.call(CY, "coalesce(new_friend_code(), 'none')"), "none", "off: no ID to change")

    def test_turning_on_needs_a_display_name_and_no_hold(self):
        self.owner(f"delete from display_names where user_id = '{ADA}';")
        self.assertEqual(self.call(ADA, "set_friends(true)"), "no-name")
        self.assertFalse(self.shown(ADA)["on"])
        self.owner(f"insert into account_holds (user_id, until, reason) values ('{BO}', now() + interval '1 day', 'test');")
        self.assertEqual(self.call(BO, "set_friends(true)"), "held")
        self.assertFalse(self.shown(BO)["on"])

    # Asking

    def test_a_request_shows_only_the_askers_name_and_the_asker_only_the_id_typed(self):
        self.on(ADA, BO)
        typed = self.code(BO).lower()
        self.assertEqual(self.ask(ADA, typed), "sent")
        got = self.asking(BO)
        self.assertEqual([set(r) for r in got], [{"id", "name", "sent_at"}])
        self.assertEqual(got[0]["name"], "Ada M")
        mine = self.shown(ADA)["i_asked"]
        self.assertEqual([set(r) for r in mine], [{"id", "code", "sent_at"}])
        self.assertEqual(mine[0]["code"], self.code(BO), "the ID as kept, never Bo's name")
        self.assertNotIn("Bo Builds", json.dumps(self.shown(ADA)), "nothing of Bo's before Bo says yes")
        self.assertNotIn(BO, json.dumps(self.shown(ADA)) + json.dumps(self.shown(BO)), "never an account ID")
        self.assertNotIn(ADA, json.dumps(self.shown(BO)))

    def test_each_refusal_of_a_request(self):
        self.assertEqual(self.ask(ADA, "7KX2MQD9TA"), "off", "Friends off: can't ask")
        self.on(ADA, BO)
        self.assertEqual(self.ask(ADA, "not an id"), "bad")
        self.assertEqual(self.ask(ADA, None), "bad")
        self.assertEqual(self.ask(ADA, self.code(ADA)), "self")
        unused = "0000000000" if self.code(BO) != "0000000000" else "1111111111"
        self.assertEqual(self.ask(ADA, unused), "not-found")
        self.assertEqual(self.ask(ADA, self.code(BO)), "sent")
        self.assertEqual(self.ask(ADA, self.code(BO)), "waiting")
        self.assertEqual(self.shown(ADA)["tries_left"], 20 - 4, "bad IDs cost no try; self, not-found, sent and waiting do")
        req = self.asking(BO)[0]["id"]
        self.assertEqual(self.call(BO, f"accept_friend_request('{req}')"), "friends")
        self.assertEqual(self.ask(ADA, self.code(BO)), "already")
        self.assertEqual(self.ask(BO, self.code(ADA)), "already")

    def test_someone_with_friends_off_cannot_be_reached(self):
        self.on(ADA, BO)
        code = self.code(BO)
        self.assertEqual(self.call(BO, "set_friends(false)"), "off")
        self.assertEqual(self.ask(ADA, code), "not-found")

    def test_asking_back_is_a_yes(self):
        self.on(ADA, BO)
        self.assertEqual(self.ask(ADA, self.code(BO)), "sent")
        self.assertEqual(self.ask(BO, self.code(ADA)), "friends")
        self.assertEqual(self.friend_names(ADA), ["Bo Builds"])
        self.assertEqual(self.friend_names(BO), ["Ada M"])
        self.assertEqual((self.asking(BO), self.shown(ADA)["i_asked"]), ([], []), "the request is gone both ways")

    def test_friends_see_only_a_name_and_since(self):
        self.make_friends(ADA, BO)
        f = self.friends(ADA)
        self.assertEqual([set(x) for x in f], [{"id", "name", "since"}])
        self.assertNotIn(self.code(BO), json.dumps(self.shown(ADA)), "a friend's ID is never shown")

    def test_a_removed_name_shows_as_none(self):
        self.make_friends(ADA, BO)
        self.owner(f"select reset_display_name('{BO}');")
        self.assertEqual([x["name"] for x in self.friends(ADA)], [None])

    # Answering

    def test_decline_is_never_told_and_stops_asking_again(self):
        self.on(ADA, BO)
        self.ask(ADA, self.code(BO))
        req = self.asking(BO)[0]["id"]
        self.assertEqual(self.call(BO, f"decline_friend_request('{req}')"), "t")
        self.assertEqual(self.call(BO, f"decline_friend_request('{req}')"), "f")
        self.assertEqual(self.asking(BO), [])
        self.assertEqual(len(self.shown(ADA)["i_asked"]), 1, "Ada still sees it waiting")
        self.assertNotIn("declined", json.dumps(self.shown(ADA)))
        self.assertEqual(self.ask(ADA, self.code(BO)), "waiting")
        self.assertEqual(self.call(BO, f"accept_friend_request('{req}')"), "gone", "a declined request can't be accepted")
        # Bo changing their mind and asking Ada is a yes from both.
        self.assertEqual(self.ask(BO, self.code(ADA)), "friends")

    def test_requests_go_after_30_days_at_0_9x_and_1_1x(self):
        self.on(ADA, BO)
        self.ask(ADA, self.code(BO))
        self.owner("update friend_requests set sent_at = now() - interval '27 days';")  # 0.9 x 30
        self.assertEqual(len(self.asking(BO)), 1)
        self.assertEqual(self.ask(ADA, self.code(BO)), "waiting")
        self.owner("update friend_requests set sent_at = now() - interval '33 days';")  # 1.1 x 30
        self.assertEqual(self.asking(BO), [])
        self.assertEqual(self.shown(ADA)["i_asked"], [])
        self.assertEqual(self.owner("select count(*) from friend_requests;"), "0", "deleted, not just hidden")
        self.assertEqual(self.ask(ADA, self.code(BO)), "sent", "may ask again")

    def test_cancel_takes_a_request_back(self):
        self.on(ADA, BO)
        self.ask(ADA, self.code(BO))
        mine = self.shown(ADA)["i_asked"][0]["id"]
        self.assertEqual(self.call(BO, f"cancel_friend_request('{mine}')"), "f", "only the asker can")
        self.assertEqual(self.call(ADA, f"cancel_friend_request('{mine}')"), "t")
        self.assertEqual(self.asking(BO), [])

    def test_remove_is_silent_and_both_lists_lose_it(self):
        self.make_friends(ADA, BO)
        fid = self.friends(ADA)[0]["id"]
        self.assertEqual(self.call(CY, f"remove_friend('{fid}')"), "f", "nobody else can")
        self.assertEqual(self.call(BO, f"remove_friend('{fid}')"), "t")
        self.assertEqual((self.friends(ADA), self.friends(BO)), ([], []))
        self.assertEqual(self.ask(ADA, self.code(BO)), "sent", "may ask again")

    # Blocking

    def test_block_from_a_request_hides_every_later_one_and_is_never_told(self):
        self.on(ADA, BO)
        self.ask(BO, self.code(ADA))
        req = self.asking(ADA)[0]["id"]
        self.assertEqual(self.call(ADA, f"block_friend('{req}')"), "t")
        self.assertEqual([b["name"] for b in self.shown(ADA)["blocked"]], ["Bo Builds"])
        self.assertEqual(self.shown(BO)["i_asked"], [], "the request is gone")
        self.assertEqual(self.ask(BO, self.code(ADA)), "sent", "Bo is never told")
        self.assertEqual(self.asking(ADA), [], "and Ada never sees it")
        self.assertEqual(self.ask(ADA, self.code(BO)), "blocked", "Ada must unblock first")
        block = self.shown(ADA)["blocked"][0]["id"]
        self.assertEqual(self.call(BO, f"unblock_friend('{block}')"), "f", "only the blocker can unblock")
        self.assertEqual(self.call(ADA, f"unblock_friend('{block}')"), "t")
        self.assertEqual(self.asking(ADA), [], "requests sent while blocked are deleted, never shown")
        self.assertEqual(self.shown(BO)["i_asked"], [])
        self.assertEqual(self.ask(BO, self.code(ADA)), "sent")
        self.assertEqual([r["name"] for r in self.asking(ADA)], ["Bo Builds"], "a request after unblocking shows")

    def test_block_a_friend_ends_the_friendship_and_asking_back_does_not_join(self):
        self.make_friends(ADA, BO)
        fid = self.friends(BO)[0]["id"]
        self.assertEqual(self.call(CY, f"block_friend('{fid}')"), "f", "not Cy's friendship")
        self.assertEqual(self.call(BO, f"block_friend('{fid}')"), "t")
        self.assertEqual((self.friends(ADA), self.friends(BO)), ([], []))
        self.assertEqual(self.ask(ADA, self.code(BO)), "sent")
        self.assertEqual(self.asking(BO), [])
        # Bo asking Ada while Ada's hidden request waits: Bo blocked Ada, so it is refused, never a yes.
        self.assertEqual(self.ask(BO, self.code(ADA)), "blocked")
        self.assertEqual(self.friends(ADA), [])

    def test_asking_back_is_no_yes_when_the_asker_blocked_you(self):
        # The functions never leave a request from someone who blocked the person it went to (a block deletes both
        # ways), but should one ever be there (a later change, a restore), asking back must not make them friends.
        self.on(ADA, BO)
        self.owner(f"insert into friend_requests (from_user, to_user, code) values ('{BO}', '{ADA}', 'X');")
        self.owner(f"insert into friend_blocks (blocker, blocked) values ('{BO}', '{ADA}');")
        self.assertEqual(self.ask(ADA, self.code(BO)), "sent")
        self.assertEqual(self.friends(ADA), [])
        self.assertEqual(self.asking(BO), [], "and Bo never sees Ada's")

    def test_a_blocked_persons_request_can_not_be_accepted(self):
        self.on(ADA, BO)
        self.ask(BO, self.code(ADA))
        req = self.asking(ADA)[0]["id"]
        self.owner(f"insert into friend_blocks (blocker, blocked) values ('{ADA}', '{BO}');")
        self.assertEqual(self.call(ADA, f"accept_friend_request('{req}')"), "gone")
        self.assertEqual(self.friends(ADA), [])

    def test_turning_off_deletes_friends_and_requests_but_keeps_blocks(self):
        self.make_friends(ADA, BO)
        self.on(CY, DI)
        self.ask(CY, self.code(ADA))
        self.ask(ADA, self.code(DI))
        req = self.asking(ADA)[0]["id"]
        self.call(ADA, f"block_friend('{req}')")
        self.assertEqual(self.call(ADA, "set_friends(false)"), "off")
        got = self.shown(ADA)
        self.assertEqual((got["on"], got["code"], got["friends"], got["asking_me"], got["i_asked"]), (False, None, [], [], []))
        self.assertEqual([b["name"] for b in got["blocked"]], ["Cy3D"])
        self.assertEqual((self.friends(BO), self.asking(DI)), ([], []))
        self.on(ADA)
        self.assertEqual(self.ask(CY, self.code(ADA)), "sent")
        self.assertEqual(self.asking(ADA), [], "the block still holds")

    # Limits

    def test_tries_a_day_at_0_9x_and_1_1x(self):
        self.on(ADA)
        # 18 tries (0.9 x 20) left two; 22 (1.1 x 20) is past it.
        self.owner(f"insert into friend_tries (user_id) select '{ADA}' from generate_series(1, 18);")
        self.assertEqual(self.ask(ADA, "0000000000"), "not-found")
        self.assertEqual(self.ask(ADA, "0000000000"), "not-found")
        self.assertEqual(self.shown(ADA)["tries_left"], 0)
        self.assertEqual(self.ask(ADA, "0000000000"), "too-many")
        self.owner(f"insert into friend_tries (user_id) select '{ADA}' from generate_series(1, 2);")
        self.assertEqual(self.ask(ADA, "0000000000"), "too-many")
        # A day later they are gone.
        self.owner("update friend_tries set tried_at = now() - interval '1 day 1 minute';")
        self.assertEqual(self.shown(ADA)["tries_left"], 20)
        self.assertEqual(self.ask(ADA, "0000000000"), "not-found")

    def fake_people(self, n, start=100):
        """n more people with Friends on, each with an ID of their own made from its number."""
        ids = [f"{start + i:08d}-0000-4000-8000-000000000000" for i in range(n)]
        self.owner("insert into auth.users (id, email) values " + ", ".join(f"('{u}', 'x{u[:8]}@example.com')" for u in ids) + ";")
        codes = [f"Z{start + i:09d}" for i in range(n)]
        self.owner("insert into friend_codes (user_id, code) values " + ", ".join(f"('{u}', '{c}')" for u, c in zip(ids, codes)) + ";")
        return ids, codes

    def test_waiting_requests_at_0_9x_and_1_1x(self):
        self.on(ADA)
        ids, codes = self.fake_people(22)
        for code in codes[:18]:
            self.assertEqual(self.ask(ADA, code), "sent")
        self.owner("delete from friend_tries;")
        self.assertEqual(self.ask(ADA, codes[18]), "sent")
        self.assertEqual(self.ask(ADA, codes[19]), "sent")
        self.assertEqual(self.ask(ADA, codes[20]), "full", "20 waiting")
        self.assertEqual(self.ask(ADA, codes[21]), "full")
        self.assertEqual(len(self.shown(ADA)["i_asked"]), 20)

    def befriend(self, uid, others):
        self.owner("insert into friendships (a, b) values " + ", ".join(f"(least('{uid}'::uuid, '{o}'::uuid), greatest('{uid}'::uuid, '{o}'::uuid))" for o in others) + ";")

    def test_friends_at_0_9x_and_1_1x(self):
        # 180 friends (0.9 x 200): Bo's request accepted. 220 (1.1 x 200): refused, both ways.
        self.on(ADA, BO, CY)
        ids, _ = self.fake_people(220)
        self.befriend(ADA, ids[:180])
        self.ask(BO, self.code(ADA))
        self.assertEqual(self.call(ADA, f"accept_friend_request('{self.asking(ADA)[0]['id']}')"), "friends")
        self.befriend(ADA, ids[180:])
        self.assertEqual(self.ask(ADA, self.code(CY)), "full", "Ada has 221")
        self.ask(CY, self.code(ADA))
        self.assertEqual(self.call(ADA, f"accept_friend_request('{self.asking(ADA)[0]['id']}')"), "full")
        self.assertEqual(self.ask(ADA, self.code(CY)), "full", "asking back is a yes only within the limit")
        self.assertEqual(len(self.friends(ADA)), 221)

    # Other people

    def test_nobody_can_read_or_change_the_tables_directly(self):
        for table in ("friend_codes", "friend_requests", "friendships", "friend_blocks", "friend_tries"):
            self.denied(self.as_user(ADA, f"select * from {table};"))
            self.denied(self.as_role("anon", f"select * from {table};"))
            self.denied(self.as_user(ADA, f"delete from {table};"))
        for fn in ("friends_shown('" + BO + "')", "friend_code_give('" + ADA + "')", "friends_join('" + ADA + "', '" + BO + "')", "friends_tidy('" + BO + "')", "my_data_part_friends()"):
            self.denied(self.as_user(ADA, f"select {fn};"))

    def test_signed_out_can_do_nothing(self):
        for fn in ("my_friends()", "set_friends(true)", "send_friend_request('0000000000')", "new_friend_code()"):
            self.denied(self.as_role("anon", f"select {fn};"))
        ok, out = self.as_role("authenticated", "select my_friends();")
        self.assertFalse(ok)
        self.assertIn("not signed in", out)

    def test_ids_of_other_peoples_rows_do_nothing(self):
        self.make_friends(ADA, BO)
        self.on(CY)
        self.ask(CY, self.code(BO))
        fid = self.friends(ADA)[0]["id"]
        req = self.asking(BO)[0]["id"]
        for fn in (f"remove_friend('{fid}')", f"block_friend('{fid}')", f"decline_friend_request('{req}')", f"cancel_friend_request('{req}')"):
            self.assertEqual(self.call(DI, fn), "f", fn)
        self.assertEqual(self.call(DI, f"accept_friend_request('{req}')"), "gone")
        self.assertEqual(self.call(ADA, f"accept_friend_request('{req}')"), "gone", "Ada can't accept Bo's request")
        self.assertEqual(len(self.friends(ADA)), 1)
        self.assertEqual(len(self.asking(BO)), 1)

    # Download my data, deleting the account

    def test_download_my_data_has_the_id_friends_requests_and_blocks(self):
        self.make_friends(ADA, BO)
        self.on(CY)
        self.ask(ADA, self.code(CY))
        data = json.loads(self.call(ADA, "my_data()"))["friends"]
        self.assertEqual(data["profile_id"], self.code(ADA))
        self.assertEqual([f["name"] for f in data["friends"]], ["Bo Builds"])
        self.assertEqual([r["code"] for r in data["i_asked"]], [self.code(CY)])
        self.assertEqual(len(data["ids_typed_last_day"]), 2)
        self.assertEqual(json.loads(self.call(DI, "my_data()"))["friends"]["friends"], [], "Di has none")

    def test_deleting_the_account_deletes_everything_friends_kept(self):
        self.make_friends(ADA, BO)
        self.on(CY)
        self.ask(ADA, self.code(CY))
        req = self.asking(CY)[0]["id"]
        self.ask(CY, self.code(BO))
        self.call(BO, f"block_friend('{self.asking(BO)[0]['id']}')")
        self.assertTrue(self.as_user(ADA, "select delete_my_account();")[0])
        for table, col in (("friend_codes", "user_id"), ("friend_tries", "user_id")):
            self.assertEqual(self.owner(f"select count(*) from {table} where {col} = '{ADA}';"), "0")
        self.assertEqual(self.owner(f"select count(*) from friendships where a = '{ADA}' or b = '{ADA}';"), "0")
        self.assertEqual(self.friends(BO), [])
        self.assertEqual(self.asking(CY), [])
        self.assertNotIn(req, json.dumps(self.shown(CY)))
        self.assertEqual(len(self.shown(BO)["blocked"]), 1, "Bo's block of Cy is Bo's, and stays")

    # Seeded random sessions against a plain model

    def test_random_sessions_agree_with_a_model(self):
        for seed in (1, 2, 3):
            with self.subTest(seed=seed):
                self.setUp()
                self.session(seed, 70)

    def session(self, seed, steps):
        rng = random.Random(seed)
        people = [ADA, BO, CY, DI]
        model = Model(NAMES)
        codes = {}
        for step in range(steps):
            me = rng.choice(people)
            them = rng.choice([p for p in people if p != me])
            kind = rng.choice(["on", "on", "off", "ask", "ask", "ask", "accept", "decline", "cancel", "remove", "block", "unblock", "newcode"])
            shown = self.shown(me)
            where = f"seed {seed} step {step}: {kind} {NAMES[me]} -> {NAMES[them]}"
            if kind == "on":
                self.assertEqual(self.call(me, "set_friends(true)"), "on", where)
                model.turn_on(me)
            elif kind == "off":
                self.assertEqual(self.call(me, "set_friends(false)"), "off", where)
                model.turn_off(me)
            elif kind == "newcode":
                got = self.call(me, "coalesce(new_friend_code(), 'none')")
                self.assertEqual(got != "none", model.is_on(me), where)
            elif kind == "ask":
                code = self.code(them) if model.is_on(them) else "0000000000"
                got = self.ask(me, code)
                self.assertEqual(got, model.ask(me, them if model.is_on(them) else None), where)
                if got == "sent":
                    codes[(me, them)] = code
            elif kind in ("accept", "decline", "block") and shown["asking_me"]:
                row = rng.choice(shown["asking_me"])
                asker = next(p for p in people if NAMES[p] == row["name"])
                fn = {"accept": "accept_friend_request", "decline": "decline_friend_request", "block": "block_friend"}[kind]
                want = {"accept": model.accept, "decline": model.decline, "block": model.block}[kind](me, asker)
                self.assertEqual(self.call(me, f"{fn}('{row['id']}')"), want, where)
            elif kind in ("remove", "block") and shown["friends"]:
                row = rng.choice(shown["friends"])
                other = next(p for p in people if NAMES[p] == row["name"])
                fn = "remove_friend" if kind == "remove" else "block_friend"
                self.assertEqual(self.call(me, f"{fn}('{row['id']}')"), "t", where)
                model.remove(me, other) if kind == "remove" else model.block(me, other)
            elif kind == "cancel" and shown["i_asked"]:
                row = rng.choice(shown["i_asked"])
                to = next(p for p in people if (me, p) in model.requests and codes.get((me, p)) == row["code"])
                self.assertEqual(self.call(me, f"cancel_friend_request('{row['id']}')"), "t", where)
                model.cancel(me, to)
            elif kind == "unblock" and shown["blocked"]:
                row = rng.choice(shown["blocked"])
                other = next(p for p in people if NAMES[p] == row["name"])
                self.assertEqual(self.call(me, f"unblock_friend('{row['id']}')"), "t", where)
                model.unblock(me, other)
            # Everyone's view matches the model's after every step.
            for p in people:
                got = self.shown(p)
                self.assertEqual(got["on"], model.is_on(p), where)
                self.assertEqual(sorted(f["name"] for f in got["friends"]), model.friend_names(p), f"{where}: {NAMES[p]}'s friends")
                self.assertEqual(sorted(r["name"] for r in got["asking_me"]), model.asking_names(p), f"{where}: asking {NAMES[p]}")
                self.assertEqual(len(got["i_asked"]), model.asked_count(p), f"{where}: {NAMES[p]} asked")
                self.assertEqual(sorted(b["name"] for b in got["blocked"]), model.blocked_names(p), f"{where}: {NAMES[p]} blocked")


class Model:
    """Friends as plain Python sets: who is on, who are friends, requests (with declined), blocks."""

    def __init__(self, names):
        self.names = names
        self.on = set()
        self.friends = set()  # frozenset pairs
        self.requests = {}  # (from, to) -> declined
        self.blocks = set()  # (blocker, blocked)

    def is_on(self, p):
        return p in self.on

    def turn_on(self, p):
        self.on.add(p)

    def turn_off(self, p):
        self.on.discard(p)
        self.friends = {f for f in self.friends if p not in f}
        self.requests = {k: v for k, v in self.requests.items() if p not in k}

    def ask(self, me, them):
        if me not in self.on:
            return "off"
        if them is None:
            return "not-found"
        if (me, them) in self.blocks:
            return "blocked"
        if frozenset((me, them)) in self.friends:
            return "already"
        if (me, them) in self.requests:
            return "waiting"
        if (them, me) in self.requests and (them, me) not in self.blocks:
            self.join(me, them)
            return "friends"
        self.requests[(me, them)] = False
        return "sent"

    def join(self, a, b):
        self.requests.pop((a, b), None)
        self.requests.pop((b, a), None)
        self.friends.add(frozenset((a, b)))

    def accept(self, me, asker):
        self.join(me, asker)
        return "friends"

    def decline(self, me, asker):
        self.requests[(asker, me)] = True
        return "t"

    def cancel(self, me, to):
        del self.requests[(me, to)]

    def remove(self, me, other):
        self.friends.discard(frozenset((me, other)))

    def block(self, me, other):
        self.blocks.add((me, other))
        self.friends.discard(frozenset((me, other)))
        self.requests.pop((me, other), None)
        self.requests.pop((other, me), None)
        return "t"

    def unblock(self, me, other):
        self.blocks.discard((me, other))
        self.requests.pop((other, me), None)

    def friend_names(self, p):
        return sorted(self.names[next(iter(f - {p}))] for f in self.friends if p in f)

    def asking_names(self, p):
        if p not in self.on:
            return []
        return sorted(self.names[a] for (a, b), declined in self.requests.items() if b == p and not declined and (p, a) not in self.blocks)

    def asked_count(self, p):
        return sum(1 for (a, _b) in self.requests if a == p)

    def blocked_names(self, p):
        return sorted(self.names[b] for (a, b) in self.blocks if a == p)


if __name__ == "__main__":
    unittest.main()
