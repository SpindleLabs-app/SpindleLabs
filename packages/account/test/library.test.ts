import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient, type StorageReply } from "../src/auth.ts";
import { DEFAULT_LICENCE, DOWNLOAD_SECONDS, draftProblem, fileBytes, LIBRARY_LIMITS, libraryApi, type LibraryCard, type LibraryDraft, LICENCES, LICENCE_WORDS, PUBLISH_WORDS } from "../src/library.ts";
import { fakeLibrary, type FakeLibrary, pgTime } from "./fake-library.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom } from "./fake-service.ts";

const MiB = 1024 * 1024;
const draft = (over: Partial<LibraryDraft> = {}): LibraryDraft => ({ title: "Cable clip", description: "Clips onto a desk edge.", licence: DEFAULT_LICENCE, tags: ["desk", "clip"], picture: null, body: '{"format":"spindle"}', ...over });
const value = <T>(r: { kind: string; value?: T }) => (r.kind === "ok" ? r.value : r);
const as = (lib: FakeLibrary, user: string | null) => libraryApi(lib.as(user));
async function publish(lib: FakeLibrary, user: string, over: Partial<LibraryDraft> = {}) {
  const r = await as(lib, user).publish(draft(over));
  assert.ok(r.kind === "ok" && r.value.status === "published", JSON.stringify(r));
  return r.kind === "ok" && r.value.status === "published" ? r.value.id : "";
}

test("hand-worked: Ada publishes a clip; Bo finds it signed out, and downloads it signed in; the file is named by the entry, never by Ada", async () => {
  const lib = fakeLibrary();
  lib.names.set("ada", "Ada M");
  const id = await publish(lib, "ada", { body: '{"format":"spindle","name":"clip"}' });
  // Three calls in order: make the waiting entry, send its file, put it live.
  assert.deepEqual(lib.calls, ["rpc/begin_publish", `storage POST object/library/${id}.spindle`, "rpc/finish_publish"]);
  assert.deepEqual([...lib.objects.keys()], [`${id}.spindle`]);
  assert.ok(![...lib.objects.keys()].some((k) => k.includes("ada")));
  const page = value(await as(lib, null).browse("", null));
  assert.ok(page && "cards" in page);
  assert.equal(page.cards.length, 1);
  const card = page.cards[0] as LibraryCard;
  assert.equal(card.title, "Cable clip");
  assert.equal(card.author, "Ada M", "the display name, never the account");
  assert.equal(card.licence, "CC-BY-4.0");
  assert.equal(page.next, null, "1 card < a page of 48: the last page");
  const e = value(await as(lib, null).entry(id));
  assert.ok(e && "description" in e);
  // '{"format":"spindle","name":"clip"}' is 34 ASCII characters, one byte each: 34 bytes.
  assert.equal(e.bytes, 34);
  assert.equal(e.mine, false);
  assert.equal((value(await as(lib, "ada").entry(id)) as { mine: boolean }).mine, true);
  assert.deepEqual(await as(lib, null).download(id), { kind: "signed-out" }, "downloading needs an account (AC2)");
  assert.deepEqual(await as(lib, "bo").download(id), { kind: "ok", value: '{"format":"spindle","name":"clip"}' });
  assert.ok(lib.calls.includes(`storage POST object/sign/library/${id}.spindle`));
});

test("hand-worked sizes: Storage counts UTF-8 bytes, so 'é' is 2; 5 MiB exactly is taken, one byte more is refused without asking", async () => {
  // é is U+00E9, encoded in UTF-8 as 0xC3 0xA9: two bytes. 5 MiB = 5,242,880 bytes = 2,621,440 é.
  assert.equal(fileBytes("é"), 2);
  const exact = "é".repeat(2_621_440);
  assert.equal(draftProblem(draft({ body: exact })), null);
  assert.equal(draftProblem(draft({ body: `${exact}a` })), "too-big");
  const lib = fakeLibrary();
  await publish(lib, "ada", { body: exact });
  const before = lib.calls.length;
  assert.deepEqual(await as(lib, "ada").publish(draft({ body: `${exact}a` })), { kind: "ok", value: { status: "too-big" } });
  assert.equal(lib.calls.length, before, "refused here: no waiting entry eats the day's ten");
});

test("the file limit at 0.9× (4.5 MiB, published) and 1.1× (5.5 MiB, refused)", async () => {
  const lib = fakeLibrary();
  await publish(lib, "ada", { body: "x".repeat(Math.round(0.9 * 5 * MiB)) });
  assert.deepEqual(await as(lib, "ada").publish(draft({ body: "x".repeat(Math.round(1.1 * 5 * MiB)) })), { kind: "ok", value: { status: "too-big" } });
});

test("the title counts characters as the database does: 100 emoji are 100, though JavaScript's length says 200; 0.9×/1.1× of 100", () => {
  const bolt = "🔩"; // U+1F529: one code point, two UTF-16 units
  assert.equal(bolt.length, 2);
  assert.equal(draftProblem(draft({ title: bolt.repeat(100) })), null);
  assert.equal(draftProblem(draft({ title: bolt.repeat(101) })), "title");
  assert.equal(draftProblem(draft({ title: "a".repeat(90) })), null);
  assert.equal(draftProblem(draft({ title: "a".repeat(110) })), "title");
  assert.equal(draftProblem(draft({ title: " clip" })), "title", "spaces at either end");
  assert.equal(draftProblem(draft({ title: "   " })), "title");
  assert.equal(draftProblem(draft({ description: "d".repeat(1800) })), null);
  assert.equal(draftProblem(draft({ description: "d".repeat(2200) })), "description");
});

test("tags, licence and picture are checked as the database checks them, and each refusal asks nothing", async () => {
  const cases: [Partial<LibraryDraft>, string | null][] = [
    [{ tags: ["a"] }, "tags"], // 1 character: under 2
    [{ tags: ["ab"] }, null],
    [{ tags: ["x".repeat(24)] }, null],
    [{ tags: ["x".repeat(25)] }, "tags"],
    [{ tags: ["Desk"] }, "tags"], // capitals
    [{ tags: ["-desk"] }, "tags"],
    [{ tags: ["desk", "desk"] }, "tags"],
    [{ tags: Array.from({ length: 8 }, (_, i) => `t${i}`) }, null],
    [{ tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }, "tags"],
    [{ licence: "MIT" }, "licence"],
    [{ licence: "CC0-1.0" }, null],
    [{ picture: "data:image/png;base64,AAAA" }, null],
    [{ picture: "data:image/svg+xml;base64,AAAA" }, "picture"],
    [{ picture: `data:image/png;base64,${"A".repeat(32 * 1024)}` }, "picture"],
    [{ body: "" }, "empty"],
  ];
  const lib = fakeLibrary();
  for (const [over, want] of cases) {
    assert.equal(draftProblem(draft(over)), want, JSON.stringify(over).slice(0, 80));
    // The fake answers as the SQL does: where the local check passes, the database must take it too (and the other way round).
    const r = await lib.as("ada").asPerson("POST", "rpc/begin_publish", { p_title: draft(over).title, p_description: draft(over).description, p_licence: draft(over).licence, p_tags: draft(over).tags, p_picture: draft(over).picture });
    if (want !== "empty") assert.equal((r as { body: { status: string } }).body.status === "bad", want !== null, JSON.stringify(over).slice(0, 80));
  }
  const before = lib.calls.length;
  assert.deepEqual(await as(lib, "ada").publish(draft({ tags: ["a"] })), { kind: "ok", value: { status: "bad", problem: "tags" } });
  assert.equal(lib.calls.length, before);
});

test("ten new a day: 0.9× (9) all go through; 1.1× (11 tries) the 11th is daily, until a day has passed", async () => {
  const lib = fakeLibrary();
  for (let i = 0; i < 9; i++) await publish(lib, "ada");
  const lib2 = fakeLibrary(2);
  const answers: string[] = [];
  for (let i = 0; i < 11; i++) {
    const r = await as(lib2, "bo").publish(draft());
    answers.push(r.kind === "ok" ? r.value.status : r.kind);
  }
  assert.deepEqual(answers, [...Array(10).fill("published"), "daily"]);
  assert.equal(await publish(lib2, "cy") !== "", true, "the cap is Bo's own (control)");
  lib2.clock += 86_400_000_000;
  await publish(lib2, "bo");
});

test("fifty designs: 0.9× (45) all live; 1.1× (55 tries) the last five are full; taking one down makes room", async () => {
  const run = async (tries: number, seed: number) => {
    const lib = fakeLibrary(seed);
    const out: string[] = [];
    for (let i = 0; i < tries; i++) {
      if (i > 0 && i % 10 === 0) lib.clock += 86_400_000_000; // a new day every ten, so the daily cap never bites
      const r = await as(lib, "ada").publish(draft({ title: `Part ${i}` }));
      out.push(r.kind === "ok" ? r.value.status : r.kind);
    }
    return { lib, out };
  };
  assert.ok((await run(45, 1)).out.every((s) => s === "published"));
  const { lib, out } = await run(55, 2);
  assert.deepEqual(out, [...Array(50).fill("published"), ...Array(5).fill("full")]);
  lib.clock += 86_400_000_000;
  const first = lib.entries[0]!.id;
  assert.deepEqual(await as(lib, "ada").remove(first), { kind: "ok", value: { wasOn: true, fileDeleted: true } });
  await publish(lib, "ada");
});

test("50 MiB in all: 0.9× (9 × 5 MiB = 45 MiB) fine; ten make exactly 50 (not over); the 11th, at 55 MiB, is full and leaves nothing behind", async () => {
  const lib = fakeLibrary();
  const five = "x".repeat(5 * MiB);
  for (let i = 0; i < 9; i++) await publish(lib, "ada", { body: five });
  await publish(lib, "ada", { body: five }); // 10 × 5 MiB = 50 MiB: the limit itself, allowed
  lib.clock += 86_400_000_000;
  // 11 × 5 MiB = 55 MiB > 50 MiB: refused once the file is there, so it is taken back.
  assert.deepEqual(await as(lib, "ada").publish(draft({ body: five })), { kind: "ok", value: { status: "full" } });
  assert.equal(lib.objects.size, 10, "the 11th file was deleted");
  const last = lib.entries[lib.entries.length - 1]!;
  assert.equal(last.state, "off", "and its waiting entry turned off, so it doesn't hold a place");
  const mine = value(await as(lib, "ada").mine());
  assert.ok(Array.isArray(mine));
  assert.equal(mine.length, 10);
});

test("paging keeps the database's microseconds: 120 designs published within a few milliseconds come back once each, in order", async () => {
  const lib = fakeLibrary();
  lib.tick = 37; // 37 µs between calls: many designs share each millisecond
  const ids = new Set<string>();
  for (const who of ["ada", "bo", "cy"]) for (let i = 0; i < 40; i++) {
    if (i === 10 || i === 20 || i === 30) lib.clock += 86_400_000_000;
    ids.add(await publish(lib, who, { title: `${who} ${i}` }));
  }
  const seen: string[] = [];
  let after = null;
  let pages = 0;
  do {
    const p = value(await as(lib, null).browse("", null, after));
    assert.ok(p && "cards" in p);
    seen.push(...p.cards.map((c) => c.id));
    after = p.next;
    pages++;
  } while (after);
  // 120 cards, 48 a page: 48 + 48 + 24, three pages.
  assert.equal(pages, 3);
  assert.equal(seen.length, 120);
  assert.deepEqual(new Set(seen), ids);
  // Deliberate break: the same cursor rounded to milliseconds (as a Date would keep it) skips or repeats cards.
  const p1 = value(await as(lib, null).browse("", null));
  assert.ok(p1 && "cards" in p1 && p1.next);
  const rounded = { publishedAt: pgTime(p1.cards[47]!.publishedAt.getTime() * 1000), id: p1.next.id };
  assert.notEqual(rounded.publishedAt, p1.next.publishedAt, "this card's time has microseconds a Date can't hold");
  const p2 = value(await as(lib, null).browse("", null, rounded));
  const exact = value(await as(lib, null).browse("", null, p1.next));
  assert.ok(p2 && "cards" in p2 && exact && "cards" in exact);
  assert.notDeepEqual(p2.cards.map((c) => c.id), exact.cards.map((c) => c.id));
});

test("search and tags: words in the title, tags or description; one tag; a tag that can't exist asks nothing", async () => {
  const lib = fakeLibrary();
  const clip = await publish(lib, "ada", { title: "Cable clip", tags: ["desk"] });
  const hook = await publish(lib, "ada", { title: "Wall hook", tags: ["wall"], description: "Holds a desk lamp cable." });
  const ids = async (search: string, tag: string | null) => {
    const p = value(await as(lib, null).browse(search, tag));
    return p && "cards" in p ? p.cards.map((c) => c.id).sort() : p;
  };
  assert.deepEqual(await ids("cable", null), [clip, hook].sort());
  assert.deepEqual(await ids("  hook ", null), [hook]);
  assert.deepEqual(await ids("", "desk"), [clip]);
  assert.deepEqual(await ids("cable", "wall"), [hook]);
  const before = lib.calls.length;
  assert.deepEqual(await ids("", "No Such Tag"), []);
  assert.equal(lib.calls.length, before);
});

test("taken down, held or switched off: nobody else sees or downloads it; the author can still fetch their own file", async () => {
  const lib = fakeLibrary();
  const id = await publish(lib, "ada");
  lib.entries[0]!.removedAt = lib.clock;
  assert.equal(value(await as(lib, null).entry(id)), null);
  assert.equal(value(await as(lib, "bo").download(id)), null);
  assert.equal(typeof value(await as(lib, "ada").download(id)), "string", "the author's own file, whatever its state");
  lib.entries[0]!.removedAt = null;
  lib.held.add("ada");
  assert.equal(value(await as(lib, "bo").download(id)), null);
  assert.deepEqual(value(await as(lib, null).browse("", null)), { cards: [], next: null });
  assert.deepEqual(await as(lib, "ada").publish(draft()), { kind: "ok", value: { status: "held" } });
  lib.held.delete("ada");
  lib.sharingOn = false;
  assert.equal(value(await as(lib, null).browse("", null)), null);
  assert.deepEqual(await as(lib, "ada").publish(draft()), { kind: "ok", value: { status: "off" } });
  assert.deepEqual(await as(lib, "ada").remove(id), { kind: "ok", value: { wasOn: true, fileDeleted: true } }, "taking down works while off");
});

test("only the author takes an entry down or deletes its file", async () => {
  const lib = fakeLibrary();
  const id = await publish(lib, "ada");
  assert.deepEqual(await as(lib, "bo").remove(id), { kind: "ok", value: { wasOn: false, fileDeleted: false } });
  assert.equal(lib.objects.size, 1);
  assert.equal(typeof value(await as(lib, "cy").download(id)), "string");
  assert.deepEqual(await as(lib, "ada").remove(id), { kind: "ok", value: { wasOn: true, fileDeleted: true } });
  assert.deepEqual(await as(lib, "ada").remove(id), { kind: "ok", value: { wasOn: false, fileDeleted: false } }, "a second time finds nothing");
  assert.deepEqual(value(await as(lib, "ada").mine()), [], "off with no file: gone from My library");
});

test("an upload that fails is tidied up: too big, refused, offline; a file already there (an earlier try) goes on", async () => {
  const cases: [StorageReply, unknown][] = [
    [{ kind: "failed", reason: "rejected", code: 413 }, { kind: "ok", value: { status: "too-big" } }],
    [{ kind: "failed", reason: "rejected", code: 403 }, { kind: "ok", value: { status: "refused" } }],
    [{ kind: "failed", reason: "offline" }, { kind: "failed", reason: "offline" }],
    [{ kind: "failed", reason: "unavailable" }, { kind: "failed", reason: "unavailable" }],
  ];
  for (const [storage, want] of cases) {
    const lib = fakeLibrary();
    lib.nextStorage = storage;
    assert.deepEqual(await as(lib, "ada").publish(draft()), want, JSON.stringify(storage));
    assert.equal(lib.entries[0]!.state, "off", `${JSON.stringify(storage)}: the waiting entry no longer holds a place`);
    assert.ok(lib.calls.includes("rpc/unpublish") && lib.calls.includes("storage DELETE object/library"));
  }
  // 409: the file is there already (sent by an earlier try whose answer was lost): finish it.
  const lib = fakeLibrary();
  const real = lib.as("ada");
  let first = true;
  const client = {
    ...real,
    asPersonStorage: async (...a: Parameters<typeof real.asPersonStorage>) => {
      const r = await real.asPersonStorage(...a);
      if (first && a[0] === "POST" && !a[1].startsWith("object/sign/")) {
        first = false;
        return { kind: "failed", reason: "rejected", code: 409 } as const;
      }
      return r;
    },
  };
  assert.deepEqual(await libraryApi(client).publish(draft()), { kind: "ok", value: { status: "published", id: lib.entries[0]!.id } });
});

test("a refused finish is tidied up (missing size, gone after the hour); a finish with no answer undoes nothing", async () => {
  const lib = fakeLibrary();
  lib.writesSize = false; // the unknown: Storage not writing metadata.size
  assert.deepEqual(await as(lib, "ada").publish(draft()), { kind: "ok", value: { status: "missing" } });
  assert.equal(lib.objects.size, 0, "the file sent was deleted");
  assert.equal(lib.entries[0]!.state, "off");
  // Gone: the upload went in, then more than an hour passed before the finish.
  const lib2 = fakeLibrary(2);
  const real = lib2.as("ada");
  const late = { ...real, asPersonStorage: async (...a: Parameters<typeof real.asPersonStorage>) => {
    const r = await real.asPersonStorage(...a);
    if (a[0] === "POST") lib2.clock += 60 * 60_000_000 + 1;
    return r;
  } };
  assert.deepEqual(await libraryApi(late).publish(draft()), { kind: "ok", value: { status: "gone" } });
  assert.equal(lib2.objects.size, 0);
  // No answer to the finish: it may have gone live, so nothing is undone and My library shows which.
  const lib3 = fakeLibrary(3);
  const r3 = lib3.as("ada");
  const lost = { ...r3, asPerson: async (...a: Parameters<typeof r3.asPerson>) => {
    const r = await r3.asPerson(...a);
    return a[1] === "rpc/finish_publish" ? ({ kind: "failed", reason: "offline" } as const) : r;
  } };
  assert.deepEqual(await libraryApi(lost).publish(draft()), { kind: "failed", reason: "offline" });
  assert.equal(lib3.entries[0]!.state, "live");
  assert.ok(!lib3.calls.includes("rpc/unpublish"));
});

test("signed out: browsing and an entry's page work; publishing, My library and downloading ask nothing", async () => {
  const lib = fakeLibrary();
  const id = await publish(lib, "ada");
  const anon = as(lib, null);
  assert.equal(value(await anon.browse("", null))!.cards.length, 1);
  assert.deepEqual(await anon.publish(draft()), { kind: "signed-out" });
  assert.deepEqual(await anon.mine(), { kind: "signed-out" });
  assert.deepEqual(await anon.download(id), { kind: "signed-out" });
  assert.ok(!lib.calls.slice(3).some((c) => c.startsWith("storage")), "no Storage call signed out");
});

test("a download link is asked for 600 seconds and must name this file; the file it fetches is capped at 5 MiB", async () => {
  const id = "20000000-0000-4000-8000-000000000abc";
  let asked: unknown;
  let got: [string, number] | undefined;
  const client = (signed: unknown) => ({
    asPerson: async () => ({ kind: "ok", body: null }) as const,
    asAnyone: async () => ({ kind: "ok", body: null }) as const,
    asPersonStorage: async (_m: string, _p: string, b: unknown) => ((asked = b), { kind: "ok", body: signed }) as const,
    getSignedFile: async (p: string, max: number) => ((got = [p, max]), { kind: "ok", text: "{}" }) as const,
  });
  const good = `/object/sign/library/${id}.spindle?token=eyJhbGciOi.J9-x_y`;
  assert.deepEqual(await libraryApi(client({ signedURL: good })).download(id), { kind: "ok", value: "{}" });
  assert.deepEqual(asked, { json: { expiresIn: DOWNLOAD_SECONDS } });
  assert.equal(DOWNLOAD_SECONDS, 600);
  assert.deepEqual(got, [good, 5 * MiB]);
  // Deliberate breaks: a link to another file, outside the bucket, or with more in it than a token.
  for (const bad of [
    `/object/sign/library/20000000-0000-4000-8000-000000000abd.spindle?token=t`,
    `/object/sign/other/${id}.spindle?token=t`,
    `https://elsewhere.example/object/sign/library/${id}.spindle?token=t`,
    `/object/sign/library/${id}.spindle?token=t&download=../x`,
    `/object/sign/library/${id}.spindle?token=`,
    null,
  ]) {
    got = undefined;
    assert.deepEqual(await libraryApi(client({ signedURL: bad })).download(id), { kind: "failed", reason: "malformed" }, String(bad));
    assert.equal(got, undefined, "nothing fetched");
  }
});

test("every answer is checked: a wrongly shaped one is malformed, never shown (deliberate breaks)", async () => {
  const id = "20000000-0000-4000-8000-000000000001";
  const at = "2026-11-12T03:00:00.123456+00:00";
  const card = { id, title: "Clip", picture: null, licence: "CC-BY-4.0", tags: ["desk"], published_at: at, author: null };
  const answering = (body: unknown) => libraryApi({
    asPerson: async () => ({ kind: "ok", body }),
    asAnyone: async () => ({ kind: "ok", body }),
    asPersonStorage: async () => ({ kind: "ok", body }),
    getSignedFile: async () => ({ kind: "failed", reason: "rejected" }),
  });
  const bad = { kind: "failed", reason: "malformed" };
  assert.equal((value(await answering([card]).browse("", null)) as { cards: unknown[] }).cards.length, 1, "control: the good shape");
  for (const c of [{ ...card, id: "x" }, { ...card, licence: "MIT" }, { ...card, tags: ["Desk"] }, { ...card, published_at: null }, { ...card, picture: "javascript:1" }, { ...card, author: 7 }, { ...card, title: 1 }])
    assert.deepEqual(await answering([c]).browse("", null), bad, JSON.stringify(c));
  assert.deepEqual(await answering({}).browse("", null), bad);
  assert.deepEqual(await answering(Array(49).fill(card)).browse("", null), bad, "more than a page");
  const older = { ...card, id: "20000000-0000-4000-8000-000000000002", published_at: "2026-11-12T02:00:00+00:00" };
  assert.equal((value(await answering([card, older]).browse("", null)) as { cards: unknown[] }).cards.length, 2);
  assert.deepEqual(await answering([older, card]).browse("", null), bad, "out of order");
  const entry = { ...card, description: "", bytes: 34, file: `${id}.spindle`, mine: false };
  assert.equal((value(await answering(entry).entry(id)) as { bytes: number }).bytes, 34);
  for (const e of [{ ...entry, file: "x.spindle" }, { ...entry, bytes: -1 }, { ...entry, mine: "no" }, { ...entry, id: older.id }])
    assert.deepEqual(await answering(e).entry(id), bad, JSON.stringify(e));
  const row = { ...card, published_at: null, state: "uploading", removed_at: null, created_at: at, file: `${id}.spindle`, bytes: null };
  assert.equal((value(await answering([row]).mine()) as unknown[]).length, 1);
  for (const r of [{ ...row, state: "live" }, { ...row, state: "gone" }, { ...row, bytes: "1" }, { ...row, created_at: "soon" }])
    assert.deepEqual(await answering([r]).mine(), bad, JSON.stringify(r));
  for (const b of [{ status: "ready", id, file: "other.spindle" }, { status: "ready", id: "x", file: "x.spindle" }, { status: "great" }, null])
    assert.deepEqual(await answering(b).publish(draft()), bad, JSON.stringify(b));
  assert.deepEqual(await answering({ status: "bad" }).publish(draft()), { kind: "ok", value: { status: "bad", problem: "other" } }, "never guesses which field");
  assert.deepEqual(await answering("yes").unpublish(id), bad);
  assert.deepEqual(await answering({}).deleteFile(id), bad);
});

test("a service without the library (migration not applied) answers rejected; a service down offline", async () => {
  const lib = fakeLibrary();
  lib.mode = "missing";
  assert.deepEqual(await as(lib, null).browse("", null), { kind: "failed", reason: "rejected" });
  assert.deepEqual(await as(lib, "ada").publish(draft()), { kind: "failed", reason: "rejected" });
  lib.mode = "down";
  assert.deepEqual(await as(lib, null).entry("20000000-0000-4000-8000-000000000001"), { kind: "failed", reason: "offline" });
});

test("words: every refusal and every licence has a sentence", () => {
  for (const k of ["too-big", "full", "daily", "held", "off", "refused", "missing", "gone"] as const) assert.ok(PUBLISH_WORDS[k].length > 10, k);
  for (const k of Object.keys(PUBLISH_WORDS.bad) as (keyof typeof PUBLISH_WORDS.bad)[]) assert.ok(PUBLISH_WORDS.bad[k].length > 10, k);
  for (const l of LICENCES) assert.ok(LICENCE_WORDS[l].says.length > 20, l);
  assert.match(PUBLISH_WORDS["too-big"], /5 MB/);
  assert.match(PUBLISH_WORDS.full, /50 designs or 50 MB/);
});

test("security hunt B6: search text over 200 characters finds nothing and asks nothing; 180 still finds", async () => {
  // "hook" then spaces inside: 180 characters (0.9 x 200) is a search; 220 (1.1 x 200) finds nothing without a request.
  const lib = fakeLibrary();
  await publish(lib, "ada", { title: "Wall hook", tags: ["hook"] });
  const at = (n: number) => "hook" + " ".repeat(n - 8) + "wall";
  assert.deepEqual(value(await as(lib, null).browse(at(180), null)).cards.map((c) => c.title), ["Wall hook"]);
  const before = lib.calls.length;
  assert.deepEqual(value(await as(lib, null).browse(at(220), null)), { cards: [], next: null });
  assert.equal(lib.calls.length, before, "nothing asked");
});

test("security hunt B4: files never finished count, so one account's files stop at 50 MiB and one file", async () => {
  // Ten 5 MiB uploads a day with no finish, for three days, straight at the fake service as the database does it. Each
  // waiting entry counts 5 MiB at begin_publish, and an upload is refused once the files pass 50 MiB: at most 55 MiB.
  const lib = fakeLibrary();
  const ada = lib.as("ada");
  for (let day = 0; day < 3; day++) {
    for (let i = 0; i < 10; i++) {
      const b = await ada.asPerson("POST", "rpc/begin_publish", { p_title: "x", p_description: "", p_licence: "CC0-1.0", p_tags: [], p_picture: null });
      const body = (b as { body?: { status: string; file?: string } }).body;
      if (body?.status !== "ready") break;
      const r = await ada.asPersonStorage("POST", `object/library/${body.file}`, { file: "x".repeat(5 * MiB), type: "application/json" });
      assert.equal(day === 0 ? r.kind : "ok", "ok", "the first day's uploads go in");
    }
    lib.clock += 86_400_000_000 + 1;
  }
  const total = [...lib.objects.values()].reduce((t, o) => t + o.text.length, 0);
  assert.ok(total <= 55 * MiB, `${total / MiB} MiB`);
});

test("the limits, licences and answers match the migration", async () => {
  const { readFileSync } = await import("node:fs");
  const { repoFile } = await import("./repo-file.ts");
  const sql = readFileSync(repoFile("supabase/migrations/20261112030000_library.sql"), "utf8");
  const lim = /jsonb_build_object\(([\s\S]*?)'licences', jsonb_build_array\(([^)]*)\)/.exec(sql);
  assert.ok(lim, "library_limits() found");
  const nums = Object.fromEntries([...lim[1]!.matchAll(/'([a-z_]+)', (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(nums, {
    max_entries: LIBRARY_LIMITS.maxEntries,
    max_bytes: LIBRARY_LIMITS.maxBytes,
    max_file_bytes: LIBRARY_LIMITS.maxFileBytes,
    max_picture_bytes: LIBRARY_LIMITS.maxPictureBytes,
    entries_per_day: LIBRARY_LIMITS.entriesPerDay,
    max_title: LIBRARY_LIMITS.maxTitle,
    max_description: LIBRARY_LIMITS.maxDescription,
    max_tags: LIBRARY_LIMITS.maxTags,
    max_tag: LIBRARY_LIMITS.maxTag,
    upload_minutes: LIBRARY_LIMITS.uploadMinutes,
    page: LIBRARY_LIMITS.page,
  });
  // 20261113200000_library_limits.sql replaces library_limits() with max_search added, every other number the same.
  const newer = readFileSync(repoFile("supabase/migrations/20261113200000_library_limits.sql"), "utf8");
  const lim2 = /jsonb_build_object\(([\s\S]*?)'licences', jsonb_build_array\(([^)]*)\)/.exec(newer);
  assert.ok(lim2, "the newer library_limits() found");
  assert.deepEqual(Object.fromEntries([...lim2[1]!.matchAll(/'([a-z_]+)', (\d+)/g)].map((m) => [m[1], Number(m[2])])), { ...nums, max_search: LIBRARY_LIMITS.maxSearch });
  assert.equal(lim2[2], lim[2]);
  assert.deepEqual([...lim[2]!.matchAll(/'([^']+)'/g)].map((m) => m[1]), [...LICENCES]);
  assert.ok(sql.includes(`file_size_limit, allowed_mime_types)\nvalues ('library', 'library', false, ${LIBRARY_LIMITS.maxFileBytes}, array['application/json'])`));
  assert.ok(sql.includes("p_id::text || '.spindle'"), "the file name");
  const begin = new Set([...sql.matchAll(/'status', '([a-z-]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...begin].sort(), ["bad", "daily", "full", "held", "off", "ready"]);
  const finish = /create function public\.finish_publish[\s\S]*?end \$\$;/.exec(sql)![0];
  assert.deepEqual([...new Set([...finish.matchAll(/return '([a-z-]+)'/g)].map((m) => m[1]))].sort(), ["full", "gone", "held", "live", "missing", "off", "too-big"]);
});

/** mulberry32: a small seeded random source. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("60 seeded sessions against a plain model: publish, take down, hold, the switch, browse and download", async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = mulberry(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;
    const lib = fakeLibrary(seed);
    const people = ["ada", "bo", "cy"] as const;
    // The model: each live entry's author and text; how many each person started today.
    const live = new Map<string, { who: string; body: string }>();
    const today = new Map<string, number>();
    const held = new Set<string>();
    let on = true;
    for (let step = 0; step < 50; step++) {
      const who = pick(people);
      const roll = rand();
      const where = `seed ${seed} step ${step}`;
      if (roll < 0.35) {
        const body = `{"n":${step}}`;
        const mineLive = [...live.values()].filter((e) => e.who === who).length;
        const want = !on ? "off" : mineLive >= LIBRARY_LIMITS.maxEntries ? "full" : (today.get(who) ?? 0) >= LIBRARY_LIMITS.entriesPerDay ? "daily" : held.has(who) ? "held" : "published";
        const r = await as(lib, who).publish(draft({ body, title: `Part ${step}` }));
        assert.equal(r.kind === "ok" ? r.value.status : r.kind, want, where);
        if (r.kind === "ok" && r.value.status === "published") {
          live.set(r.value.id, { who, body });
          today.set(who, (today.get(who) ?? 0) + 1);
        }
      } else if (roll < 0.5 && live.size > 0) {
        const id = pick([...live.keys()]);
        const e = live.get(id)!;
        const r = value(await as(lib, who).remove(id));
        assert.deepEqual(r, e.who === who ? { wasOn: true, fileDeleted: true } : { wasOn: false, fileDeleted: false }, where);
        if (e.who === who) live.delete(id);
      } else if (roll < 0.58) {
        if (held.has(who)) held.delete(who), lib.held.delete(who);
        else held.add(who), lib.held.add(who);
      } else if (roll < 0.62) {
        on = !on;
        lib.sharingOn = on;
      } else if (roll < 0.66) {
        lib.clock += 86_400_000_000;
        today.clear();
      } else if (roll < 0.83) {
        const p = value(await as(lib, null).browse("", null));
        const want = on ? [...live].filter(([, e]) => !held.has(e.who)).map(([id]) => id).sort() : null;
        assert.deepEqual(p === null ? null : (p as { cards: LibraryCard[] }).cards.map((c) => c.id).sort(), want, where);
      } else if (live.size > 0) {
        const id = pick([...live.keys()]);
        const e = live.get(id)!;
        const visible = (on && !held.has(e.who)) || e.who === who;
        assert.equal(value(await as(lib, who).download(id)), visible ? e.body : null, where);
      }
    }
  }
});

test("Storage requests: the person's token and the public key, the file sent as it is, no overwrite flag; Storage's 400 codes read", async () => {
  let ms = 1_800_000_000_000;
  const svc = fakeService(() => ms / 1000);
  const seen: { url: string; init: RequestInit }[] = [];
  let answer: () => Response = () => new Response('{"Key":"library/x"}', { status: 200 });
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${SERVICE}/storage/v1/`)) {
      seen.push({ url, init: init ?? {} });
      return answer();
    }
    return svc.fetch(input, init);
  }) as typeof fetch;
  const store = memoryStore();
  const client = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: "https://spindlelabs.app/" }, fetch: fetcher, store, now: () => ms, random: seededRandom(5) });
  assert.deepEqual(await client.asPersonStorage("POST", "object/library/a.spindle", { file: "{}", type: "application/json" }), { kind: "signed-out" });
  assert.equal(seen.length, 0, "signed out: nothing sent");
  const go = new URL((await client.beginSignIn())!);
  assert.equal((await client.finishSignIn(`https://spindlelabs.app/?code=${svc.approve(go.searchParams.get("code_challenge")!)}`)).kind, "signed-in");

  assert.deepEqual(await client.asPersonStorage("POST", "object/library/a.spindle", { file: '{"é":1}', type: "application/json" }), { kind: "ok", body: { Key: "library/x" } });
  const up = seen[0]!;
  assert.equal(up.url, `${SERVICE}/storage/v1/object/library/a.spindle`);
  const h = up.init.headers as Record<string, string>;
  assert.equal(h.apikey, KEY);
  assert.match(h.authorization!, /^Bearer access-/);
  assert.equal(h["content-type"], "application/json");
  assert.equal(h["x-upsert"], undefined, "never overwrite");
  assert.equal(up.init.body, '{"é":1}', "the text as it is, not JSON inside JSON");
  assert.equal(up.init.credentials, "omit");

  const codes: [number, string, unknown][] = [
    [400, '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}', { kind: "failed", reason: "rejected", code: 413 }],
    [400, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}', { kind: "failed", reason: "rejected", code: 409 }],
    [400, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}', { kind: "failed", reason: "rejected", code: 403 }],
    [413, '{"statusCode":"413"}', { kind: "failed", reason: "rejected", code: 413 }],
    [404, "not json", { kind: "failed", reason: "rejected", code: 404 }],
    [400, '{"statusCode":"teapot"}', { kind: "failed", reason: "rejected", code: 400 }],
    [503, "{}", { kind: "failed", reason: "unavailable" }],
    [400, '{"statusCode":"500"}', { kind: "failed", reason: "unavailable" }],
  ];
  for (const [status, body, want] of codes) {
    answer = () => new Response(body, { status });
    assert.deepEqual(await client.asPersonStorage("POST", "object/library/a.spindle", { file: "{}", type: "application/json" }), want, `${status} ${body}`);
  }

  // Refused for its token: renewed once and sent again with the new one.
  const before = seen.length;
  let once = true;
  answer = () => {
    if (once) {
      once = false;
      return new Response('{"statusCode":"403","error":"Unauthorized","message":"jwt expired"}', { status: 400 });
    }
    return new Response("[]", { status: 200 });
  };
  assert.deepEqual(await client.asPersonStorage("DELETE", "object/library", { json: { prefixes: ["a.spindle"] } }), { kind: "ok", body: [] });
  assert.equal(seen.length - before, 2);
  const [t1, t2] = seen.slice(before).map((c) => (c.init.headers as Record<string, string>).authorization);
  assert.notEqual(t1, t2, "the second try carries the renewed token");
  assert.equal(seen[seen.length - 1]!.init.body, '{"prefixes":["a.spindle"]}');
  // Refused for its token twice: not a third time.
  answer = () => new Response("{}", { status: 401 });
  const b2 = seen.length;
  assert.deepEqual(await client.asPersonStorage("DELETE", "object/library", { json: { prefixes: [] } }), { kind: "failed", reason: "rejected", code: 401 });
  assert.equal(seen.length - b2, 2);
  answer = () => {
    throw new TypeError("Failed to fetch");
  };
  assert.deepEqual(await client.asPersonStorage("DELETE", "object/library", { json: { prefixes: [] } }), { kind: "failed", reason: "offline" });
  ms += 1;
});

test("a signed file: fetched with no account headers, capped at 0.9×/1.1× of the most asked for, UTF-8 or malformed", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let answer: () => Response = () => new Response("{}");
  const client = authClient({
    config: { url: SERVICE, anonKey: KEY, redirectTo: "https://spindlelabs.app/" },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => (seen.push({ url: String(input), init: init ?? {} }), answer())) as typeof fetch,
    store: memoryStore(),
    now: () => 1_800_000_000_000,
    random: seededRandom(1),
  });
  const path = "/object/sign/library/a.spindle?token=t";
  answer = () => new Response("é".repeat(450)); // 900 bytes: 0.9× of 1000
  assert.deepEqual(await client.getSignedFile(path, 1000), { kind: "ok", text: "é".repeat(450) });
  assert.equal(seen[0]!.url, `${SERVICE}/storage/v1${path}`);
  assert.equal(seen[0]!.init.headers, undefined, "the link is the permission: no token, no key");
  answer = () => new Response("é".repeat(550)); // 1100 bytes: 1.1×
  assert.deepEqual(await client.getSignedFile(path, 1000), { kind: "failed", reason: "too-big" });
  answer = () => new Response("x", { headers: { "content-length": "1100" } });
  assert.deepEqual(await client.getSignedFile(path, 1000), { kind: "failed", reason: "too-big" }, "a stated size over the cap isn't read");
  answer = () => new Response(new Uint8Array([0x7b, 0xc3, 0x7d])); // 0xC3 starts a two-byte character that never ends
  assert.deepEqual(await client.getSignedFile(path, 1000), { kind: "failed", reason: "malformed" });
  answer = () => new Response("{}", { status: 400 });
  assert.deepEqual(await client.getSignedFile(path, 1000), { kind: "failed", reason: "rejected" });
  answer = () => new Response("{}", { status: 502 });
  assert.deepEqual(await client.getSignedFile(path, 1000), { kind: "failed", reason: "unavailable" });
  const n = seen.length;
  assert.deepEqual(await client.getSignedFile("https://elsewhere.example/x", 1000), { kind: "failed", reason: "malformed" });
  assert.equal(seen.length, n, "only Storage's own signed paths are fetched");
});
