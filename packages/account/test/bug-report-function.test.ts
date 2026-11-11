// The bug-report function (supabase/functions/bug-report/index.ts) against a fake
// GitHub and a fake database. The database's limits themselves are checked on a
// real PostgreSQL in supabase/test/test_bug_reports.py; here the fake answers
// bug_report_allowed with whatever the test says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFile } from "./repo-file.ts";

const { bugReport, MAX_DESIGN_BYTES, MAX_BODY_CHARS, MAX_TITLE_CHARS } = (await import(repoFile("supabase/functions/bug-report/index.ts").href)) as typeof import("../../../supabase/functions/bug-report/index.ts");

const APP = "https://spindlelabs.app";
const IP = "203.0.113.7";
// sha256("pepper|203.0.113.7"), worked out by Python's hashlib (a separate implementation of SHA-256).
const SENDER = "0605f690b573a4cfd5da5f267806df7b1b3d9440195903dfd8c8f03137774dbc";
const NOW = Date.UTC(2026, 10, 11, 3, 0, 0);

function world(o: { env?: Record<string, string | undefined>; allowed?: boolean | "down"; github?: "down" } = {}) {
  const env = { GITHUB_BUG_TOKEN: "github_pat_test", BUG_REPORT_REPO: "SpindleLabs-app/bug-reports", BUG_REPORT_SALT: "pepper", SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "service", ...o.env };
  const calls: { method: string; url: string; headers: Headers; body: string }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: new Headers(init.headers), body: String(init.body ?? "") });
    if (url.startsWith("https://db.test/")) {
      if (o.allowed === "down") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(o.allowed ?? true), { status: 200 });
    }
    if (o.github === "down") return new Response("{}", { status: 500 });
    if (method === "PUT" && url.includes("/contents/")) return new Response(JSON.stringify({ content: { html_url: "https://github.com/x/blob/main/f" } }), { status: 201 });
    if (method === "POST" && url.endsWith("/issues")) return new Response(JSON.stringify({ number: 42 }), { status: 201 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const handle = bugReport({ env, fetch: fakeFetch, now: () => NOW, id: () => "k3y" });
  return { handle, calls };
}

const post = (body: unknown, o: { origin?: string; raw?: string } = {}) =>
  new Request("https://db.test/functions/v1/bug-report", { method: "POST", headers: { origin: o.origin ?? APP, "content-type": "application/json", "x-forwarded-for": `${IP}, 10.0.0.1` }, body: o.raw ?? JSON.stringify(body) });

const report = (o: Record<string, unknown> = {}) => ({ title: "Bug: fillet vanished", body: "### What happened\n\nIt went @ben", design: null, ...o });

test("hand-worked: a report with a design stores the file, then files the issue linking it, and answers its number", async () => {
  const { handle, calls } = world();
  const res = await handle(post(report({ design: { name: "Bracket.spindle.json", text: "{}" } })));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { issue: 42 });
  assert.equal(res.headers.get("access-control-allow-origin"), APP);
  // 1. The limit, asked for the hashed sender (the first address in x-forwarded-for, with the salt).
  assert.equal(calls[0].url, "https://db.test/rest/v1/rpc/bug_report_allowed");
  assert.deepEqual(JSON.parse(calls[0].body), { p_sender: SENDER });
  // 2. The design, under reports/<date>/<id>-<name>. "{}" is bytes 7B 7D: 011110 110111 110100 (padded), so base64 "e30=".
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].url, "https://api.github.com/repos/SpindleLabs-app/bug-reports/contents/reports/2026-11-11/k3y-Bracket.spindle.json");
  assert.equal(calls[1].headers.get("authorization"), "Bearer github_pat_test");
  assert.equal(JSON.parse(calls[1].body).content, "e30=");
  // 3. The issue: the title as sent, the body with the design's link and @ broken so nobody is pinged.
  assert.equal(calls[2].url, "https://api.github.com/repos/SpindleLabs-app/bug-reports/issues");
  const issue = JSON.parse(calls[2].body);
  assert.equal(issue.title, "Bug: fillet vanished");
  assert.ok(issue.body.includes("It went @​ben"), issue.body);
  assert.ok(issue.body.includes("[Bracket.spindle.json](https://github.com/x/blob/main/f)"), issue.body);
  assert.equal(calls.length, 3);
  // The address itself goes nowhere.
  for (const c of calls) assert.ok(!c.body.includes(IP) && !c.url.includes(IP), `${c.url} carries the address`);
});

test("a report without a design files only the issue", async () => {
  const { handle, calls } = world();
  const res = await handle(post(report()));
  assert.deepEqual(await res.json(), { issue: 42 });
  assert.deepEqual(calls.map((c) => c.method), ["POST", "POST"]);
});

test("over the limit answers 429 and files nothing; a database or GitHub failure answers 502", async () => {
  let w = world({ allowed: false });
  assert.equal((await w.handle(post(report()))).status, 429);
  assert.equal(w.calls.length, 1);
  w = world({ allowed: "down" });
  assert.equal((await w.handle(post(report()))).status, 502);
  assert.equal(w.calls.length, 1, "nothing filed when the limit can't be checked");
  w = world({ github: "down" });
  assert.equal((await w.handle(post(report({ design: { name: "a.spindle.json", text: "{}" } })))).status, 502);
});

test("not set up until every secret is there", async () => {
  for (const missing of ["GITHUB_BUG_TOKEN", "BUG_REPORT_REPO", "BUG_REPORT_SALT", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const { handle, calls } = world({ env: { [missing]: undefined } });
    const res = await handle(post(report()));
    assert.equal(res.status, 503, missing);
    assert.deepEqual(await res.json(), { error: "not-set-up" });
    assert.equal(calls.length, 0);
  }
});

test("only the app's own pages may send; preflight answers them alone", async () => {
  const { handle, calls } = world();
  assert.equal((await handle(post(report(), { origin: "https://elsewhere.example" }))).status, 403);
  assert.equal(calls.length, 0);
  const pre = (origin: string) => handle(new Request("https://db.test/functions/v1/bug-report", { method: "OPTIONS", headers: { origin } }));
  assert.equal((await pre(APP)).headers.get("access-control-allow-origin"), APP);
  assert.equal((await pre("https://elsewhere.example")).headers.get("access-control-allow-origin"), null);
  assert.equal((await handle(new Request("https://db.test/functions/v1/bug-report", { method: "GET", headers: { origin: APP } }))).status, 405);
});

test("broken reports are refused with 400 before anything is asked", async () => {
  const bad = [
    { raw: "not json" },
    { body: report({ title: "" }) },
    { body: report({ title: 7 }) },
    { body: report({ body: null }) },
    { body: report({ design: { name: "../evil.spindle.json", text: "{}" } }) },
    { body: report({ design: { name: "a.exe", text: "{}" } }) },
    { body: report({ design: { name: "a.spindle.json", text: 5 } }) },
  ];
  for (const b of bad) {
    const { handle, calls } = world();
    const res = await handle(post(b.body, { raw: b.raw }));
    assert.equal(res.status, 400, JSON.stringify(b).slice(0, 80));
    assert.equal(calls.length, 0);
  }
});

test("the design at 0.9× of its limit is filed; at 1.1× refused with 413", async () => {
  const sized = (bytes: number) => report({ design: { name: "a.spindle.json", text: "a".repeat(Math.round(bytes)) } });
  let w = world();
  assert.equal((await w.handle(post(sized(0.9 * MAX_DESIGN_BYTES)))).status, 200);
  w = world();
  assert.equal((await w.handle(post(sized(1.1 * MAX_DESIGN_BYTES)))).status, 413);
  assert.equal(w.calls.length, 0);
});

test("the body and title at 0.9× of their limits are filed; at 1.1× refused with 413", async () => {
  for (const [key, max] of [["body", MAX_BODY_CHARS], ["title", MAX_TITLE_CHARS]] as const) {
    let w = world();
    assert.equal((await w.handle(post(report({ [key]: "a".repeat(Math.floor(0.9 * max)) })))).status, 200, `${key} 0.9×`);
    w = world();
    assert.equal((await w.handle(post(report({ [key]: "a".repeat(Math.ceil(1.1 * max)) })))).status, 413, `${key} 1.1×`);
  }
});
