// The security review of the bug-report function (2026-11-11, /mnt/project-files/audit/2026-11-11/bug-report-514-review.txt):
// each test failed against the first version and passes since the fix. F1 forged sender, F1b IPv6 /64, F2 a link in
// the design's name, F3 @ as an HTML entity, F4 a body with no length read whole, F5 a body past GitHub's limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFile } from "./repo-file.ts";

const { bugReport, MAX_BODY_CHARS, MAX_REQUEST_BYTES } = (await import(repoFile("supabase/functions/bug-report/index.ts").href)) as typeof import("../../../supabase/functions/bug-report/index.ts");

const APP = "https://spindlelabs.app";
function world() {
  const env = { GITHUB_BUG_TOKEN: "t", BUG_REPORT_REPO: "o/r", BUG_REPORT_SALT: "pepper", SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "s" };
  const calls: { method: string; url: string; body: string }[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input), method = init.method ?? "GET";
    calls.push({ method, url, body: String(init.body ?? "") });
    if (url.startsWith("https://db.test/")) return new Response("true");
    if (method === "PUT") return new Response(JSON.stringify({ content: { html_url: "https://github.com/o/r/blob/main/f" } }), { status: 201 });
    return new Response(JSON.stringify({ number: 1 }), { status: 201 });
  }) as typeof fetch;
  return { handle: bugReport({ env, fetch: f, now: () => 0, id: () => "k" }), calls };
}
const post = (body: unknown, xff = "203.0.113.7, 10.0.0.1") =>
  new Request("https://x/functions/v1/bug-report", { method: "POST", headers: { origin: APP, "content-type": "application/json", "x-forwarded-for": xff }, body: JSON.stringify(body) });
const senderOf = (c: { body: string }[]) => JSON.parse(c[0].body).p_sender;

test("F1: a forged first x-forwarded-for entry does not make a new sender", async () => {
  // The proxy appends the real address (203.0.113.7); the caller wrote the part before it.
  const a = world(); await a.handle(post({ title: "t", body: "b", design: null }, "1.1.1.1, 203.0.113.7"));
  const b = world(); await b.handle(post({ title: "t", body: "b", design: null }, "2.2.2.2, 203.0.113.7"));
  assert.equal(senderOf(a.calls), senderOf(b.calls), "the forged entry chose the sender, so the 5/hour limit is per forged value");
});

test("F1b: two IPv6 addresses in one /64 are one sender", async () => {
  const a = world(); await a.handle(post({ title: "t", body: "b", design: null }, "2001:db8:1:2::1"));
  const b = world(); await b.handle(post({ title: "t", body: "b", design: null }, "2001:db8:1:2::2"));
  assert.equal(senderOf(a.calls), senderOf(b.calls), "one host owns the whole /64");
});

test("F2: the design's name cannot add a link of its own to the issue", async () => {
  const { handle, calls } = world();
  const res = await handle(post({ title: "t", body: "b", design: { name: "x](http:evil.example) [a.spindle.json", text: "{}" } }));
  if (res.status === 400) return; // refusing such a name is also a fix
  const body = JSON.parse(calls.at(-1)!.body).body as string;
  assert.ok(!body.includes("](http:evil.example"), body);
});

test("F3: an @ written as an HTML entity is broken too", async () => {
  const { handle, calls } = world();
  await handle(post({ title: "t", body: "hi &#64;benpy28 and &commat;benpy28", design: null }));
  const body = JSON.parse(calls.at(-1)!.body).body as string;
  assert.ok(!/&#64;benpy28|&commat;benpy28/.test(body), body);
});

test("F4: a body with no content-length is not read past the limit", async () => {
  let pulled = 0;
  const chunk = new Uint8Array(1024 * 1024).fill(0x61);
  const stream = new ReadableStream({ pull(c) { pulled += chunk.length; if (pulled > 4 * MAX_REQUEST_BYTES) c.close(); else c.enqueue(chunk); } });
  const req = new Request("https://x/functions/v1/bug-report", { method: "POST", headers: { origin: APP }, body: stream, duplex: "half" } as RequestInit);
  const res = await world().handle(req);
  assert.equal(res.status, 413);
  assert.ok(pulled <= MAX_REQUEST_BYTES + 2 * chunk.length, `read ${pulled} bytes, limit ${MAX_REQUEST_BYTES}`);
});

test("F5: a body accepted at the limit still fits GitHub's 65,536 after @ breaking", async () => {
  const { handle, calls } = world();
  const res = await handle(post({ title: "t", body: "@a".repeat(MAX_BODY_CHARS / 2), design: { name: "a.spindle.json", text: "{}" } }));
  if (res.status === 413) { assert.equal(calls.length, 0); return; }
  const body = JSON.parse(calls.at(-1)!.body).body as string;
  assert.ok(body.length <= 65_536, `issue body ${body.length} chars: GitHub refuses it after the design was stored and the slot spent`);
});
