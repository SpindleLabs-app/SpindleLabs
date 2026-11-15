// Friends by profile ID (account features 6): friends.ts against fake-friends.ts, which answers as
// supabase/migrations/20261113180000_friends.sql does (that SQL is checked on PostgreSQL by supabase/test/test_friends.py).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AuthClient } from "../src/auth.ts";
import { ACCEPT_ANSWERS, ASK_ANSWERS, askWords, CODE_ALPHABET, friendCodeKey, friendCodeShown, FRIENDS_LIMITS, friendsApi, myFriendsFrom, TURN_ANSWERS, turnWords } from "../src/friends.ts";
import { fakeFriends, type FakeFriends } from "./fake-friends.ts";
import { repoFile } from "./repo-file.ts";

const api = (s: FakeFriends, user: string | null) => friendsApi(s.as(user) as AuthClient);
const DAY = 86_400_000;
const sql = readFileSync(repoFile("supabase/migrations/20261113180000_friends.sql"), "utf8");

function ok<T>(r: { kind: string; value?: T }): T {
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return r.value as T;
}

function people(s: FakeFriends, ...who: [string, string][]) {
  for (const [id, name] of who) s.names.set(id, name);
}

async function codeOf(s: FakeFriends, user: string): Promise<string> {
  const got = ok(await api(s, user).read());
  assert.ok(got.code);
  return got.code;
}

test("the limits, the alphabet and every answer are the migration's", () => {
  // friends_limits() as written in the SQL.
  const lim = /jsonb_build_object\('max_friends', (\d+), 'max_waiting', (\d+), 'tries_a_day', (\d+), 'request_days', (\d+), 'code_length', (\d+)\)/.exec(sql);
  assert.ok(lim, "friends_limits() found");
  assert.deepEqual(lim.slice(1).map(Number), [FRIENDS_LIMITS.maxFriends, FRIENDS_LIMITS.maxWaiting, FRIENDS_LIMITS.triesADay, FRIENDS_LIMITS.requestDays, FRIENDS_LIMITS.codeLength]);
  assert.ok(sql.includes(`alphabet text := '${CODE_ALPHABET}'`));
  assert.equal(new Set(CODE_ALPHABET).size, 32);
  assert.equal(/[ILOU]/.test(CODE_ALPHABET), false, "no I, L, O or U");
  const answers = (fn: string) => {
    const body = sql.slice(sql.indexOf(`create function public.${fn}(`));
    return new Set([...body.slice(0, body.indexOf("end $$;")).matchAll(/return '([a-z-]+)';/g)].map((m) => m[1]));
  };
  assert.deepEqual(answers("send_friend_request"), new Set(ASK_ANSWERS));
  assert.deepEqual(answers("set_friends"), new Set(TURN_ANSWERS));
  assert.deepEqual(answers("accept_friend_request"), new Set(ACCEPT_ANSWERS));
});

test("a typed ID is read as the database reads it (hand-worked cases)", () => {
  // Spaces and dashes go, letters go up, then O -> 0 and I, L -> 1; U is not in the alphabet.
  const cases: [string, string | null][] = [
    ["7KX2M-QD9TA", "7KX2MQD9TA"],
    [" 7kx2m qd9ta ", "7KX2MQD9TA"],
    ["OIL23-45678", "0112345678"],
    ["7KX2MQD9T", null],
    ["7KX2MQD9TAB", null],
    ["7KX2MQD9TU", null],
    ["7KX2M_QD9TA", null],
    ["", null],
  ];
  for (const [typed, want] of cases) assert.equal(friendCodeKey(typed), want, typed);
  // The same cases are in supabase/test/test_friends.py, so the browser and the database read IDs alike.
  assert.equal(friendCodeShown("7KX2MQD9TA"), "7KX2M-QD9TA");
  assert.equal(friendCodeKey(friendCodeShown("7KX2MQD9TA")), "7KX2MQD9TA", "an ID as shown reads back");
});

test("an answer with anything more than the database promises is refused, not passed on", () => {
  const good = { on: true, code: "7KX2MQD9TA", friends: [{ id: "00000000-0000-4000-8000-000000000001", name: "Bo", since: "2026-11-13T09:00:00+00:00" }], asking_me: [], i_asked: [], blocked: [], tries_left: 20 };
  assert.ok(myFriendsFrom(good));
  const broken: [string, unknown][] = [
    ["a friend's account ID slipped in", { ...good, friends: [{ ...good.friends[0], user_id: "11111111-1111-4111-8111-111111111111" }] }],
    ["on with no ID", { ...good, code: null }],
    ["off with an ID", { ...good, on: false }],
    ["an ID with a U", { ...good, code: "7KX2MQD9TU" }],
    ["more tries than a day has", { ...good, tries_left: 21 }],
    ["a bad time", { ...good, friends: [{ ...good.friends[0], since: "soon" }] }],
    ["a request showing a name to the asker", { ...good, i_asked: [{ id: good.friends[0].id, code: "7KX2MQD9TA", name: "Bo", sent_at: "2026-11-13T09:00:00Z" }] }],
    ["no list", { ...good, blocked: null }],
  ];
  for (const [why, v] of broken) assert.equal(myFriendsFrom(v), null, why);
});

test("Ada asks Bo by ID and Bo says yes: each sees only the other's display name", async () => {
  const s = fakeFriends();
  people(s, ["ada", "Ada M"], ["bo", "Bo Builds"]);
  assert.equal(ok(await api(s, "ada").turn(true)), "on");
  assert.equal(ok(await api(s, "bo").turn(true)), "on");
  const bo = await codeOf(s, "bo");
  assert.equal(ok(await api(s, "ada").ask(friendCodeShown(bo).toLowerCase())), "sent");
  const ada = ok(await api(s, "ada").read());
  assert.deepEqual(ada.iAsked.map((r) => r.code), [bo], "Ada sees the ID she typed, not Bo's name");
  const asking = ok(await api(s, "bo").read()).askingMe;
  assert.deepEqual(asking.map((r) => r.name), ["Ada M"]);
  assert.equal(ok(await api(s, "bo").accept(asking[0].id)), "friends");
  assert.deepEqual(ok(await api(s, "ada").read()).friends.map((f) => f.name), ["Bo Builds"]);
  assert.deepEqual(ok(await api(s, "bo").read()).friends.map((f) => f.name), ["Ada M"]);
  assert.equal(ok(await api(s, "ada").ask(bo)), "already");
});

test("turning on needs a display name; turning off deletes the ID, friends and requests but keeps blocks", async () => {
  const s = fakeFriends();
  assert.equal(ok(await api(s, "ada").turn(true)), "no-name");
  people(s, ["ada", "Ada M"], ["bo", "Bo Builds"], ["cy", "Cy3D"]);
  for (const p of ["ada", "bo", "cy"]) await api(s, p).turn(true);
  await api(s, "bo").ask(await codeOf(s, "ada"));
  await api(s, "cy").ask(await codeOf(s, "ada"));
  const asking = ok(await api(s, "ada").read()).askingMe;
  await api(s, "ada").accept(asking.find((r) => r.name === "Bo Builds")!.id);
  assert.equal(ok(await api(s, "ada").block(asking.find((r) => r.name === "Cy3D")!.id)), true);
  assert.equal(ok(await api(s, "ada").turn(false)), "off");
  const got = ok(await api(s, "ada").read());
  assert.deepEqual([got.on, got.code, got.friends.length, got.blocked.map((b) => b.name)], [false, null, 0, ["Cy3D"]]);
  assert.equal(ok(await api(s, "bo").read()).friends.length, 0);
});

test("a block looks exactly like a decline to the asker, and a no can't be dodged by taking it back (hunt B1, B2)", async () => {
  const s = fakeFriends();
  people(s, ["ada", "Ada M"], ["bo", "Bo Builds"], ["cy", "Cy3D"]);
  for (const p of ["ada", "bo", "cy"]) await api(s, p).turn(true);
  const ada = await codeOf(s, "ada");
  await api(s, "bo").ask(ada);
  await api(s, "cy").ask(ada);
  const asking = ok(await api(s, "ada").read()).askingMe;
  await api(s, "ada").decline(asking.find((r) => r.name === "Cy3D")!.id);
  await api(s, "ada").block(asking.find((r) => r.name === "Bo Builds")!.id);
  const bo = ok(await api(s, "bo").read()).iAsked;
  assert.equal(bo.length, ok(await api(s, "cy").read()).iAsked.length);
  assert.equal(ok(await api(s, "bo").ask(ada)), ok(await api(s, "cy").ask(ada)));
  await api(s, "ada").unblock(ok(await api(s, "ada").read()).blocked[0].id);
  assert.deepEqual(ok(await api(s, "bo").read()).iAsked, bo, "unblocking changes nothing Bo can see");
  // Cy takes the declined request back and asks again: Ada never sees it; Cy sees it waiting from now.
  s.now += 60_000;
  assert.equal(ok(await api(s, "cy").cancel(ok(await api(s, "cy").read()).iAsked[0].id)), true);
  assert.deepEqual(ok(await api(s, "cy").read()).iAsked, []);
  assert.equal(ok(await api(s, "cy").ask(ada)), "sent");
  assert.equal(ok(await api(s, "cy").read()).iAsked[0].sentAt.getTime(), s.now);
  assert.deepEqual(ok(await api(s, "ada").read()).askingMe, []);
});

test("IDs typed a day: 18 (0.9x of 20) leave two tries, 22 (1.1x) are refused, and a day later they're back", async () => {
  const s = fakeFriends();
  people(s, ["ada", "Ada M"]);
  await api(s, "ada").turn(true);
  for (let i = 0; i < 18; i++) s.tries.push({ user: "ada", at: s.now });
  assert.equal(ok(await api(s, "ada").ask("0000000000")), "not-found");
  assert.equal(ok(await api(s, "ada").ask("0000000000")), "not-found");
  assert.equal(ok(await api(s, "ada").read()).triesLeft, 0);
  assert.equal(ok(await api(s, "ada").ask("0000000000")), "too-many");
  assert.equal(ok(await api(s, "ada").ask("not an id")), "bad", "a malformed ID is said as such and costs nothing");
  for (let i = 0; i < 2; i++) s.tries.push({ user: "ada", at: s.now });
  assert.equal(ok(await api(s, "ada").ask("0000000000")), "too-many");
  s.now += DAY + 60_000;
  assert.equal(ok(await api(s, "ada").read()).triesLeft, 20);
});

test("a request goes after 30 days: at 27 (0.9x) it still waits, at 33 (1.1x) it is gone and may be sent again", async () => {
  const s = fakeFriends();
  people(s, ["ada", "Ada M"], ["bo", "Bo Builds"]);
  await api(s, "ada").turn(true);
  await api(s, "bo").turn(true);
  const bo = await codeOf(s, "bo");
  await api(s, "ada").ask(bo);
  s.now += 27 * DAY;
  assert.equal(ok(await api(s, "bo").read()).askingMe.length, 1);
  assert.equal(ok(await api(s, "ada").ask(bo)), "waiting");
  s.now += 6 * DAY;
  assert.equal(ok(await api(s, "bo").read()).askingMe.length, 0);
  assert.equal(ok(await api(s, "ada").ask(bo)), "sent");
});

test("each answer and refusal has its words, with the limits in them", () => {
  for (const a of ASK_ANSWERS) assert.ok(askWords(a).length > 10, a);
  assert.match(askWords("too-many"), /20 profile IDs a day/);
  assert.match(askWords("full"), /200 friends and 20 requests/);
  assert.match(turnWords("no-name"), /display name/);
});

test("a service that is down, has no Friends yet, or a person signed out: said, never a crash", async () => {
  const s = fakeFriends();
  s.mode = "down";
  assert.deepEqual(await api(s, "ada").read(), { kind: "failed", reason: "offline" });
  s.mode = "missing";
  assert.deepEqual(await api(s, "ada").ask("7KX2MQD9TA"), { kind: "failed", reason: "rejected" });
  s.mode = "up";
  assert.deepEqual(await api(s, null).read(), { kind: "signed-out" });
  // A reply of the wrong shape is "malformed".
  const odd = friendsApi({ asPerson: async () => ({ kind: "ok", body: "maybe" }) } as unknown as AuthClient);
  assert.deepEqual(await odd.ask("7KX2MQD9TA"), { kind: "failed", reason: "malformed" });
  assert.deepEqual(await odd.decline("00000000-0000-4000-8000-000000000001"), { kind: "failed", reason: "malformed" });
});

// Seeded sessions: four people pressing at random through the API, every view checked after each step against a
// plain model of sets (who is on, friends, requests as open, declined or taken back after a no, blocks).
test("60 seeded sessions of four people agree with a set model", async () => {
  const names: Record<string, string> = { ada: "Ada M", bo: "Bo Builds", cy: "Cy3D", di: "Di Prints" };
  const all = Object.keys(names);
  for (let seed = 1; seed <= 60; seed++) {
    const s = fakeFriends(seed);
    for (const p of all) s.names.set(p, names[p]);
    let r = seed;
    const pick = <T>(list: readonly T[]): T => {
      r = (Math.imul(r, 48271) + 1) % 2147483647;
      return list[Math.abs(r) % list.length];
    };
    const on = new Set<string>();
    const friends = new Set<string>();
    // "from>to" -> open; declined (said no to, or blocked: kept, hidden from them); back (taken back after a no, or the
    // asker turned Friends off: hidden from the asker too, until asked again)
    const reqs = new Map<string, "open" | "declined" | "back">();
    const blocks = new Set<string>(); // "blocker>blocked"
    const key = (x: string, y: string) => [x, y].sort().join("+");
    const join = (x: string, y: string) => {
      reqs.delete(`${x}>${y}`);
      reqs.delete(`${y}>${x}`);
      friends.add(key(x, y));
    };
    for (let step = 0; step < 40; step++) {
      const me = pick(all);
      const them = pick(all.filter((p) => p !== me));
      const kind = pick(["on", "on", "off", "ask", "ask", "ask", "accept", "decline", "remove", "block", "unblock", "cancel"] as const);
      const where = `seed ${seed} step ${step}: ${kind} ${me} -> ${them}`;
      const view = ok(await api(s, me).read());
      const nameOf = (n: string | null) => all.find((p) => names[p] === n)!;
      if (kind === "on") {
        assert.equal(ok(await api(s, me).turn(true)), "on", where);
        on.add(me);
      } else if (kind === "off") {
        await api(s, me).turn(false);
        on.delete(me);
        for (const f of [...friends]) if (f.split("+").includes(me)) friends.delete(f);
        for (const [q, state] of [...reqs]) {
          const [from, to] = q.split(">");
          if (to === me || (from === me && state === "open")) reqs.delete(q);
          else if (from === me) reqs.set(q, "back");
        }
      } else if (kind === "ask") {
        const code = on.has(them) ? await codeOf(s, them) : "0000000000";
        let want: string;
        if (!on.has(me)) want = "off";
        else if (!on.has(them)) want = "not-found";
        else if (blocks.has(`${me}>${them}`)) want = "blocked";
        else if (friends.has(key(me, them))) want = "already";
        else if (reqs.has(`${me}>${them}`) && reqs.get(`${me}>${them}`) !== "back") want = "waiting";
        else if (reqs.has(`${them}>${me}`) && reqs.get(`${them}>${me}`) !== "back" && !blocks.has(`${them}>${me}`)) {
          want = "friends";
          join(me, them);
        } else {
          want = "sent";
          reqs.set(`${me}>${them}`, reqs.get(`${me}>${them}`) === "back" ? "declined" : "open");
        }
        assert.equal(ok(await api(s, me).ask(code)), want, where);
      } else if ((kind === "accept" || kind === "decline" || kind === "block") && view.askingMe.length) {
        const row = pick(view.askingMe);
        const asker = nameOf(row.name);
        if (kind === "accept") {
          assert.equal(ok(await api(s, me).accept(row.id)), "friends", where);
          join(me, asker);
        } else if (kind === "decline") {
          assert.equal(ok(await api(s, me).decline(row.id)), true, where);
          reqs.set(`${asker}>${me}`, "declined");
        } else {
          assert.equal(ok(await api(s, me).block(row.id)), true, where);
          blocks.add(`${me}>${asker}`);
          friends.delete(key(me, asker));
          reqs.delete(`${me}>${asker}`);
          reqs.set(`${asker}>${me}`, "declined");
        }
      } else if ((kind === "remove" || kind === "block") && view.friends.length) {
        const row = pick(view.friends);
        const other = nameOf(row.name);
        assert.equal(ok(await (kind === "remove" ? api(s, me).remove(row.id) : api(s, me).block(row.id))), true, where);
        friends.delete(key(me, other));
        if (kind === "block") {
          blocks.add(`${me}>${other}`);
          reqs.delete(`${me}>${other}`);
          if (reqs.get(`${other}>${me}`) === "open") reqs.set(`${other}>${me}`, "declined");
        }
      } else if (kind === "unblock" && view.blocked.length) {
        const row = pick(view.blocked);
        const other = nameOf(row.name);
        assert.equal(ok(await api(s, me).unblock(row.id)), true, where);
        blocks.delete(`${me}>${other}`);
        if (reqs.get(`${other}>${me}`) === "open") reqs.set(`${other}>${me}`, "declined");
      } else if (kind === "cancel" && view.iAsked.length) {
        const row = pick(view.iAsked);
        const to = s.requests.find((q) => q.id === row.id)!.to; // the model has no IDs: whom it went to, from the fake
        assert.equal(ok(await api(s, me).cancel(row.id)), true, where);
        if (reqs.get(`${me}>${to}`) === "declined") reqs.set(`${me}>${to}`, "back");
        else reqs.delete(`${me}>${to}`);
      }
      for (const p of all) {
        const v = ok(await api(s, p).read());
        assert.equal(v.on, on.has(p), `${where}: ${p} on`);
        const fr = [...friends].filter((f) => f.split("+").includes(p)).map((f) => names[f.split("+").find((x) => x !== p)!]).sort();
        assert.deepEqual(v.friends.map((f) => f.name).sort(), fr, `${where}: ${p}'s friends`);
        const asking = on.has(p) ? [...reqs].filter(([q, state]) => q.endsWith(`>${p}`) && state === "open" && !blocks.has(`${p}>${q.split(">")[0]}`)).map(([q]) => names[q.split(">")[0]]).sort() : [];
        assert.deepEqual(v.askingMe.map((x) => x.name).sort(), asking, `${where}: asking ${p}`);
        assert.equal(v.iAsked.length, [...reqs].filter(([q, state]) => q.startsWith(`${p}>`) && state !== "back").length, `${where}: ${p} asked`);
        assert.deepEqual(v.blocked.map((x) => x.name).sort(), [...blocks].filter((k) => k.startsWith(`${p}>`)).map((k) => names[k.split(">")[1]]).sort(), `${where}: ${p} blocked`);
      }
    }
  }
});
