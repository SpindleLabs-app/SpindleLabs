"""The public library (supabase/migrations/20261112030000_library.sql), checked on a real PostgreSQL.

Same throwaway cluster and roles as test_database.py, with Supabase Storage's tables from auth_stub.sql. Storage runs
uploads, download links and deletes as the person's own role against storage.objects' row level security, so the tests
do exactly that: an upload is an insert into storage.objects as the person, a download link needs a select, a delete a
delete. The point of most tests is abuse: nobody uploads to someone else's entry, overwrites a file, downloads without
an account or downloads something taken down, held or switched off; every limit holds at 0.9x and refuses at 1.1x.
Run: python3 -m unittest discover -s supabase/test
"""

import json
import os
import unittest

from test_database import ADA, BO, HERE, MIGRATIONS, Cluster

CY = "33333333-3333-4333-8333-333333333333"
MIB = 1024 * 1024
# library_limits()
MAX_ENTRIES, MAX_BYTES, MAX_FILE, MAX_PICTURE, PER_DAY, MAX_TITLE, MAX_DESCRIPTION, MAX_TAGS, MAX_TAG = 50, 50 * MIB, 5 * MIB, 32768, 10, 100, 2000, 8, 24


class LibraryDatabase(unittest.TestCase):
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
        for uid, email in [(ADA, "ada@example.com"), (BO, "bo@example.com"), (CY, "cy@example.com")]:
            self.owner(f"insert into auth.users (id, email) values ('{uid}', '{email}');")
        self.owner("update share_switch set sharing_on = true;")

    def owner(self, sql):
        ok, out = self.pg.psql(sql)
        self.assertTrue(ok, out)
        return out

    def as_role(self, role, sql, uid=None):
        claim = f"select set_config('request.jwt.claim.sub', '{uid}', true);" if uid else ""
        return self.pg.psql(f"begin;\nset local role {role};\n\\o /dev/null\nselect 1; {claim}\n\\o\n{sql}\ncommit;")

    def as_user(self, uid, sql):
        return self.as_role("authenticated", sql, uid)

    def value(self, uid, sql, role="authenticated"):
        ok, out = self.as_role(role, sql, uid)
        self.assertTrue(ok, out)
        return out

    def begin(self, uid, title="Bracket", description="An L bracket.", licence="CC-BY-4.0", tags="array['bracket','3d-print']", picture="null"):
        title_sql = "null" if title is None else "'" + title.replace("'", "''") + "'"
        out = self.value(uid, f"select begin_publish({title_sql}, '{description}', '{licence}', {tags}::text[], {picture});")
        return json.loads(out)

    def upload(self, uid, name, size=1000):
        """What Storage does for an upload: the person's own insert, with the file's size in the metadata."""
        return self.as_user(uid, f"insert into storage.objects (bucket_id, name, owner_id, metadata) values ('library', '{name}', '{uid}', jsonb_build_object('size', {size}, 'mimetype', 'application/json'));")

    def finish(self, uid, entry):
        return self.value(uid, f"select finish_publish('{entry}');")

    def publish(self, uid, size=1000, **kw):
        b = self.begin(uid, **kw)
        self.assertEqual(b["status"], "ready", b)
        ok, out = self.upload(uid, b["file"], size)
        self.assertTrue(ok, out)
        self.assertEqual(self.finish(uid, b["id"]), "live")
        return b["id"]

    def can_read(self, uid, entry, role="authenticated"):
        """Whether Storage would make a download link: the person's select sees the object."""
        ok, out = self.as_role(role, f"select count(*) from storage.objects where bucket_id = 'library' and name = '{entry}.spindle';", uid)
        self.assertTrue(ok, out)
        return out == "1"

    def browse(self, role="anon", uid=None, search="", tag="null", before="null", before_id="null", limit=48):
        out = self.value(uid, f"select browse_library('{search}', {tag}, {before}, {before_id}, {limit});", role)
        return None if out == "" else json.loads(out)

    def hold(self, uid):
        self.owner(f"set role service_role; select hold_account('{uid}', null, 'test', false, 'mod', ''); reset role;")

    # Hand-worked

    def test_ada_publishes_a_bracket_and_anyone_finds_it_but_only_signed_in_people_download_it(self):
        entry = self.publish(ADA, size=4321)
        cards = self.browse()
        # One published entry: one card, with its title, licence, tags and no account id anywhere in it.
        self.assertEqual([c["id"] for c in cards], [entry])
        self.assertEqual((cards[0]["title"], cards[0]["licence"], cards[0]["tags"]), ("Bracket", "CC-BY-4.0", ["bracket", "3d-print"]))
        self.assertNotIn(ADA, json.dumps(cards))
        self.assertIsNone(cards[0]["author"], "no display name yet")
        got = json.loads(self.value(None, f"select library_entry('{entry}');", "anon"))
        self.assertEqual((got["bytes"], got["description"], got["file"], got["mine"]), (4321, "An L bracket.", f"{entry}.spindle", False))
        self.assertTrue(self.can_read(BO, entry), "Bo, signed in, may download")
        self.assertFalse(self.can_read(None, entry, "anon"), "nobody signed out may (AC2)")
        self.assertTrue(json.loads(self.value(ADA, f"select library_entry('{entry}');"))["mine"])

    def test_the_author_display_name_shows_never_the_account(self):
        self.owner(f"insert into display_names (user_id, name, name_key) values ('{ADA}', 'Ada Maker', 'adamaker');")
        self.publish(ADA)
        self.assertEqual(self.browse()[0]["author"], "Ada Maker")

    # Uploads

    def test_nobody_uploads_to_another_persons_entry_or_a_name_that_is_not_an_entry(self):
        b = self.begin(ADA)
        self.assertFalse(self.upload(BO, b["file"])[0], "Bo can't put a file in Ada's entry")
        self.assertFalse(self.upload(ADA, "anything.spindle")[0])
        self.assertFalse(self.upload(ADA, f"{ADA}/{b['id']}.spindle")[0], "only the bare name")
        ok, out = self.as_role("anon", f"insert into storage.objects (bucket_id, name, metadata) values ('library', '{b['file']}', '{{\"size\": 1}}');")
        self.assertFalse(ok, "nobody signed out uploads")
        self.assertTrue(self.upload(ADA, b["file"])[0])

    def test_a_file_is_uploaded_once_and_never_overwritten_even_by_its_author(self):
        entry = self.publish(ADA)
        self.assertFalse(self.upload(ADA, f"{entry}.spindle")[0], "the entry is live: no second upload")
        ok, out = self.as_user(ADA, f"update storage.objects set metadata = '{{\"size\": 9}}' where name = '{entry}.spindle' returning 1;")
        self.assertTrue(ok, out)
        self.assertEqual(out, "", "no update policy: nothing changes")

    def test_an_upload_must_come_within_the_hour(self):
        # 0.9 x 60 minutes = 54 minutes after begin_publish: allowed. 1.1 x 60 = 66 minutes: refused, and the entry is gone.
        early = self.begin(ADA)
        self.owner(f"update library_entries set created_at = now() - interval '54 minutes' where id = '{early['id']}';")
        self.assertTrue(self.upload(ADA, early["file"])[0])
        self.assertEqual(self.finish(ADA, early["id"]), "live")
        late = self.begin(ADA)
        self.owner(f"update library_entries set created_at = now() - interval '66 minutes' where id = '{late['id']}';")
        self.assertFalse(self.upload(ADA, late["file"])[0])
        self.assertEqual(self.finish(ADA, late["id"]), "gone")

    def test_finishing_without_a_file_says_missing_and_nothing_is_listed(self):
        b = self.begin(ADA)
        self.assertEqual(self.finish(ADA, b["id"]), "missing")
        self.assertEqual(self.browse(), [])
        self.assertEqual(self.finish(BO, b["id"]), "gone", "not Bo's")

    # Limits

    def test_file_size_at_0_9_and_1_1_of_5_mib(self):
        a = self.begin(ADA)
        self.upload(ADA, a["file"], int(0.9 * MAX_FILE))
        self.assertEqual(self.finish(ADA, a["id"]), "live")
        b = self.begin(ADA)
        self.upload(ADA, b["file"], int(1.1 * MAX_FILE))
        self.assertEqual(self.finish(ADA, b["id"]), "too-big")
        self.assertEqual(self.owner("select file_size_limit from storage.buckets where id = 'library';"), str(MAX_FILE), "the bucket refuses those too")

    def test_all_files_at_0_9_and_1_1_of_50_mib(self):
        # 9 files of 5 MiB = 45 MiB = 0.9 x 50: all live. A 10th and 11th of 5 MiB make 55 MiB = 1.1 x 50: the 11th is
        # refused (the 10th makes exactly 50 MiB, allowed).
        for _ in range(9):
            self.publish(ADA, size=MAX_FILE)
        self.publish(ADA, size=MAX_FILE)
        self.owner(f"update library_entries set created_at = now() - interval '2 days' where user_id = '{ADA}';")
        b = self.begin(ADA)
        self.upload(ADA, b["file"], MAX_FILE)
        self.assertEqual(self.finish(ADA, b["id"]), "full")

    def test_a_turned_off_entrys_file_counts_until_it_is_deleted(self):
        entries = [self.publish(ADA, size=MAX_FILE) for _ in range(10)]
        self.owner(f"update library_entries set created_at = now() - interval '2 days' where user_id = '{ADA}';")
        self.assertEqual(self.value(ADA, f"select unpublish('{entries[0]}');"), "t")
        b = self.begin(ADA)
        self.upload(ADA, b["file"], MAX_FILE)
        self.assertEqual(self.finish(ADA, b["id"]), "full", "50 MiB of files still in the bucket")
        ok, out = self.as_user(ADA, f"delete from storage.objects where name = '{entries[0]}.spindle' returning 1;")
        self.assertEqual((ok, out), (True, "1"))
        self.assertEqual(self.finish(ADA, b["id"]), "live")

    def test_entries_at_0_9_and_1_1_of_50(self):
        # 45 live entries (0.9 x 50) and 5 more make 50; the 51st and later (up to 1.1 x 50 = 55) are full.
        self.owner(f"insert into library_entries (user_id, title, licence, state, created_at) select '{ADA}', 'x', 'CC0-1.0', 'live', now() - interval '2 days' from generate_series(1, 45);")
        for _ in range(5):
            self.assertEqual(self.begin(ADA)["status"], "ready")
        # 10 a day allows 5 more today, so these are refused for being full, not for the day.
        for _ in range(5):
            self.assertEqual(self.begin(ADA)["status"], "full")

    def test_new_entries_a_day_at_0_9_and_1_1_of_10(self):
        # 9 in the last day (0.9 x 10) then a 10th is allowed; the 11th (1.1 x 10) is refused, counting turned-off ones.
        for _ in range(9):
            self.assertEqual(self.begin(ADA)["status"], "ready")
        self.owner(f"update library_entries set state = 'off' where user_id = '{ADA}';")
        self.assertEqual(self.begin(ADA)["status"], "ready")
        self.assertEqual(self.begin(ADA)["status"], "daily")
        self.owner(f"update library_entries set created_at = now() - interval '25 hours' where user_id = '{ADA}';")
        self.assertEqual(self.begin(ADA)["status"], "ready", "a day later")

    def test_title_description_tags_and_picture_at_their_limits(self):
        self.assertEqual(self.begin(ADA, title="t" * int(0.9 * MAX_TITLE))["status"], "ready")
        self.assertEqual(self.begin(ADA, title="t" * MAX_TITLE)["status"], "ready")
        self.assertEqual(self.begin(BO, title="t" * int(1.1 * MAX_TITLE))["status"], "bad")
        self.assertEqual(self.begin(BO, title="")["status"], "bad")
        self.assertEqual(self.begin(BO, title=" Bracket")["status"], "bad", "untrimmed")
        self.assertEqual(self.begin(BO, title=None)["status"], "bad")
        self.assertEqual(self.begin(BO, description="d" * int(1.1 * MAX_DESCRIPTION))["status"], "bad")
        self.assertEqual(self.begin(BO, licence="GPL-3.0")["status"], "bad")
        tags = lambda n: "array[" + ",".join(f"'t{i}'" for i in range(n)) + "]"
        self.assertEqual(self.begin(BO, tags=tags(7))["status"], "ready")  # 0.9 x 8 rounds to 7
        self.assertEqual(self.begin(BO, tags=tags(9))["status"], "bad")  # 1.1 x 8 rounds to 9
        for bad in ["array['Bracket']", "array['a']", "array['-x']", "array['x y']", "array['ok','ok']", f"array['{'t' * (MAX_TAG + 1)}']", "array[null]", "null"]:
            self.assertEqual(self.begin(BO, tags=bad)["status"], "bad", bad)
        self.assertEqual(self.begin(BO, tags=f"array['{'t' * MAX_TAG}']")["status"], "ready")
        b64 = lambda n: "'data:image/png;base64," + "A" * n + "'"
        prefix = len("data:image/png;base64,")
        self.assertEqual(self.begin(BO, picture=b64(int(0.9 * MAX_PICTURE) - prefix))["status"], "ready")
        self.assertEqual(self.begin(CY, picture=b64(int(1.1 * MAX_PICTURE) - prefix))["status"], "bad")
        self.assertEqual(self.begin(CY, picture="'javascript:alert(1)'")["status"], "bad")

    # Downloads, takedowns, holds, the switch

    def test_downloads_stop_when_taken_down_turned_off_held_or_switched_off_but_the_author_keeps_theirs(self):
        entry = self.publish(ADA)
        self.owner(f"update library_entries set removed_at = now() where id = '{entry}';")
        self.assertFalse(self.can_read(BO, entry))
        self.assertTrue(self.can_read(ADA, entry), "the author can still get their own file")
        self.assertEqual(self.browse(), [])
        self.assertEqual(self.value(None, f"select library_entry('{entry}');", "anon"), "")
        self.owner(f"update library_entries set removed_at = null where id = '{entry}';")
        self.assertTrue(self.can_read(BO, entry))
        self.hold(ADA)
        self.assertFalse(self.can_read(BO, entry), "a held author's designs are hidden")
        self.assertEqual(self.browse(), [])
        self.owner(f"delete from account_holds where user_id = '{ADA}';")
        self.owner("update share_switch set sharing_on = false;")
        self.assertFalse(self.can_read(BO, entry))
        self.assertIsNone(self.browse(), "nothing listed while off")
        self.owner("update share_switch set sharing_on = true;")
        self.assertEqual(self.value(ADA, f"select unpublish('{entry}');"), "t")
        self.assertFalse(self.can_read(BO, entry))
        self.assertEqual(self.value(ADA, f"select unpublish('{entry}');"), "", "already off")

    def test_nobody_else_deletes_or_unpublishes_a_file(self):
        entry = self.publish(ADA)
        ok, out = self.as_user(BO, f"delete from storage.objects where name = '{entry}.spindle' returning 1;")
        self.assertEqual((ok, out), (True, ""), "Bo's delete matches nothing")
        self.assertEqual(self.value(BO, f"select unpublish('{entry}');"), "")
        self.assertEqual([c["id"] for c in self.browse()], [entry])

    def test_held_and_switched_off_publishing_is_refused(self):
        b = self.begin(ADA)
        self.upload(ADA, b["file"])
        self.hold(ADA)
        self.assertEqual(self.begin(ADA)["status"], "held")
        self.assertEqual(self.finish(ADA, b["id"]), "held")
        self.assertFalse(self.upload(ADA, self.begin(BO)["file"])[0])
        self.owner("update share_switch set sharing_on = false;")
        self.assertEqual(self.begin(BO)["status"], "off")
        self.assertEqual(self.finish(BO, b["id"]), "off")

    def test_the_browser_never_reads_or_writes_the_table_and_signed_out_people_cannot_publish(self):
        for role, uid in [("anon", None), ("authenticated", ADA)]:
            ok, out = self.as_role(role, "select * from library_entries;", uid)
            self.assertFalse(ok)
            self.assertIn("permission denied", out)
        ok, out = self.as_role("anon", "select begin_publish('x', '', 'CC0-1.0', '{}', null);")
        self.assertFalse(ok)
        self.assertIn("permission denied", out)
        ok, out = self.as_role("anon", "select my_library();")
        self.assertFalse(ok)

    # Browsing

    def test_search_tags_and_pages(self):
        self.publish(ADA, title="Wall hook", tags="array['hook','wall']")
        self.owner("update library_entries set published_at = now() - interval '3 minutes';")
        self.publish(ADA, title="Cable clip", description="Holds a USB cable to a desk.", tags="array['clip']")
        self.owner("update library_entries set published_at = now() - interval '2 minutes' where published_at > now() - interval '1 minute';")
        third = self.publish(BO, title="Hook rack", tags="array['hook']")
        self.assertEqual([c["title"] for c in self.browse()], ["Hook rack", "Cable clip", "Wall hook"], "newest first")
        self.assertEqual({c["title"] for c in self.browse(search="hook")}, {"Wall hook", "Hook rack"})
        self.assertEqual([c["title"] for c in self.browse(search="usb desk")], ["Cable clip"], "the description is searched")
        self.assertEqual([c["title"] for c in self.browse(tag="'wall'")], ["Wall hook"])
        self.assertEqual(self.browse(search="\"unclosed"), [], "odd search words are words, never an error")
        page = self.browse(limit=1)
        self.assertEqual([c["id"] for c in page], [third])
        nxt = self.browse(before=f"'{page[0]['published_at']}'", before_id=f"'{page[0]['id']}'", limit=1)
        self.assertEqual([c["title"] for c in nxt], ["Cable clip"])
        self.assertEqual(len(self.browse(limit=1000)), 3, "the page is capped, never an error")

    # Own list and Download my data

    def test_my_library_lists_mine_with_state_and_hides_off_ones_without_a_file(self):
        live = self.publish(ADA, size=77)
        waiting = self.begin(ADA)["id"]
        off = self.publish(ADA)
        self.value(ADA, f"select unpublish('{off}');")
        mine = json.loads(self.value(ADA, "select my_library();"))
        self.assertEqual({(m["id"], m["state"]) for m in mine}, {(live, "live"), (waiting, "uploading"), (off, "off")})
        self.assertEqual(next(m["bytes"] for m in mine if m["id"] == live), 77)
        self.as_user(ADA, f"delete from storage.objects where name = '{off}.spindle';")
        mine = json.loads(self.value(ADA, "select my_library();"))
        self.assertEqual({m["id"] for m in mine}, {live, waiting}, "an off entry whose file is deleted is gone from the list")
        self.assertEqual(json.loads(self.value(BO, "select my_library();")), [])

    def test_download_my_data_has_every_entry_and_deleting_the_account_removes_them(self):
        self.publish(ADA)
        data = json.loads(self.value(ADA, "select my_data();", role="postgres"))
        self.assertEqual([e["title"] for e in data["library"]], ["Bracket"])
        self.owner(f"delete from auth.users where id = '{ADA}';")
        self.assertEqual(self.owner("select count(*) from library_entries;"), "0")

    def test_every_function_the_browser_may_call_is_granted_and_no_other(self):
        anon = {"library_limits", "browse_library", "library_entry"}
        signed_in = anon | {"begin_publish", "finish_publish", "unpublish", "my_library", "library_may_upload", "library_may_read", "library_may_delete"}
        for role, allowed in [("anon", anon), ("authenticated", signed_in)]:
            out = self.owner(f"select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'library%' or p.proname in ('begin_publish','finish_publish','unpublish','browse_library','my_library','my_data_part_library')) and has_function_privilege('{role}', p.oid, 'execute');")
            self.assertEqual(set(out.split()), allowed, role)


if __name__ == "__main__":
    unittest.main()
