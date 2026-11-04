import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME_MAX, sessionFromReply, sessionFromText, sessionToText } from "../src/session.ts";

const reply = { access_token: "a1", refresh_token: "r1", expires_at: 2000, user: { id: "7f3c2a10-0000-4000-8000-000000000001", email: "m@example.com", user_metadata: { full_name: "Ada Maker", avatar_url: "https://x/p.png" } } };

test("a token reply becomes a session keeping only id, email and name", () => {
  const s = sessionFromReply(reply, 0);
  assert.deepEqual(s, { accessToken: "a1", refreshToken: "r1", expiresAt: 2000, user: { id: reply.user.id, email: "m@example.com", name: "Ada Maker" } });
  assert.equal(JSON.stringify(s).includes("p.png"), false); // the picture address is not kept
});

test("expires_in counts from now when expires_at is missing", () => {
  // now 1000 s + 3600 s = 4600 s
  const { expires_at: _, ...r } = reply;
  assert.equal(sessionFromReply({ ...r, expires_in: 3600 }, 1000)?.expiresAt, 4600);
});

test("a reply missing anything needed, or of the wrong type, gives no session", () => {
  for (const bad of [
    null, "x", [], {},
    { ...reply, access_token: "" },
    { ...reply, access_token: "a b" },
    { ...reply, refresh_token: undefined },
    { ...reply, expires_at: Infinity },
    { ...reply, expires_at: "2000" },
    { ...reply, user: undefined },
    { ...reply, user: { ...reply.user, id: "../../etc" } },
    { ...reply, user: { ...reply.user, id: 7 } },
  ]) assert.equal(sessionFromReply(bad, 0), undefined, JSON.stringify(bad));
});

test("a name loses control and direction-changing characters and is cut to NAME_MAX characters", () => {
  const named = (full_name: unknown) => sessionFromReply({ ...reply, user: { ...reply.user, user_metadata: { full_name } } }, 0)?.user.name;
  assert.equal(named("Ada‮niam\u0007 "), "Adaniam");
  assert.equal(named("é".repeat(NAME_MAX)), "é".repeat(NAME_MAX));
  assert.equal(named("é".repeat(NAME_MAX + 1)), "é".repeat(NAME_MAX));
  assert.equal([...(named("🙂".repeat(NAME_MAX + 5)) ?? "")].length, NAME_MAX); // counted in characters, never splitting one
  assert.equal(named(42), "");
});

test("a stored session reads back the same, and a damaged one is refused", () => {
  const s = sessionFromReply(reply, 0)!;
  assert.deepEqual(sessionFromText(sessionToText(s)), s);
  const text = sessionToText(s);
  for (const bad of [null, undefined, "", "{", "null", "[]", text.replace('"v":1', '"v":2'), text.replace("Ada Maker", "Ada‮Maker"), text.replace('"a1"', '""')]) {
    assert.equal(sessionFromText(bad), undefined, String(bad));
  }
});
