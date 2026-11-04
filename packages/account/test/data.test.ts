import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient } from "../src/auth.ts";
import { accountData, PENDING_EMAIL_KEY } from "../src/data.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom } from "./fake-service.ts";

const APP = "https://spindlelabs.app/";

async function signedIn() {
  let ms = 1_800_000_000_000;
  const clock = { now: () => ms, advance: (d: number) => void (ms += d) };
  const svc = fakeService(() => ms / 1000);
  const store = memoryStore();
  const client = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store, now: clock.now, random: seededRandom(11) });
  const go = new URL((await client.beginSignIn())!);
  const r = await client.finishSignIn(`${APP}?code=${svc.approve(go.searchParams.get("code_challenge")!)}`);
  assert.equal(r.kind, "signed-in");
  return { clock, svc, store, client, data: accountData(client) };
}

test("the email choice starts as no, and a yes is recorded for this person only", async () => {
  const { svc, data } = await signedIn();
  assert.deepEqual(await data.emailChoice(), { kind: "ok", value: false }); // unticked by default
  assert.deepEqual(await data.setEmailChoice(true), { kind: "ok", value: true });
  assert.deepEqual(svc.profile, { email_opt_in: true });
  assert.deepEqual(await data.emailChoice(), { kind: "ok", value: true });
  assert.deepEqual(await data.setEmailChoice(false), { kind: "ok", value: false });
  assert.deepEqual(svc.profile, { email_opt_in: false });
  const patch = svc.calls.find((c) => c.init.method === "PATCH")!;
  assert.equal(patch.url, `${SERVICE}/rest/v1/profiles?id=eq.7f3c2a10-0000-4000-8000-000000000001`);
  assert.match((patch.init.headers as Record<string, string>).authorization, /^Bearer access-/);
});

test("an answer that is not exactly one row with a yes or no is refused", async () => {
  const { svc, data } = await signedIn();
  for (const bad of [[], [{ email_opt_in: true }, { email_opt_in: false }], [{ email_opt_in: "yes" }], [null], {}, "x"]) {
    svc.nextData = bad;
    assert.deepEqual(await data.emailChoice(), { kind: "failed", reason: "malformed" }, JSON.stringify(bad));
  }
});

test("a token about to run out is refreshed before a data request", async () => {
  const { clock, svc, data } = await signedIn();
  clock.advance(3590 * 1000); // 10 s left, inside the 60 s margin
  assert.deepEqual(await data.emailChoice(), { kind: "ok", value: false });
  const urls = svc.calls.slice(-2).map((c) => c.url);
  assert.deepEqual(urls, [`${SERVICE}/auth/v1/token?grant_type=refresh_token`, `${SERVICE}/rest/v1/profiles?select=email_opt_in`]);
});

test("my data comes back as readable JSON with the person's email", async () => {
  const { svc, data } = await signedIn();
  const r = await data.myData();
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.equal(JSON.parse(r.value).account.email, "maker@example.com");
  for (const bad of [null, "text", 5]) {
    svc.nextData = bad;
    assert.deepEqual(await data.myData(), { kind: "failed", reason: "malformed" }, String(bad));
  }
});

test("deleting the account removes it at the service and signs this device out", async () => {
  const { svc, client, data } = await signedIn();
  assert.deepEqual(await data.deleteAccount(), { kind: "ok", value: true });
  assert.equal(svc.profile, undefined);
  assert.deepEqual(client.state(), { kind: "signed-out" });
  assert.deepEqual(await data.emailChoice(), { kind: "signed-out" });
});

test("a failed delete keeps the person signed in, so they can try again", async () => {
  const { svc, client, data } = await signedIn();
  svc.mode = "down";
  assert.deepEqual(await data.deleteAccount(), { kind: "failed", reason: "offline" });
  assert.equal(client.state().kind, "signed-in");
  svc.mode = 503;
  assert.deepEqual(await data.deleteAccount(), { kind: "failed", reason: "unavailable" });
  assert.notEqual(svc.profile, undefined);
});

test("signed out, nothing is asked of the service", async () => {
  const { svc, client, data } = await signedIn();
  await client.signOut();
  const before = svc.calls.length;
  assert.deepEqual(await data.emailChoice(), { kind: "signed-out" });
  assert.deepEqual(await data.setEmailChoice(true), { kind: "signed-out" });
  assert.deepEqual(await data.myData(), { kind: "signed-out" });
  assert.deepEqual(await data.deleteAccount(), { kind: "signed-out" });
  assert.equal(svc.calls.length, before);
});

test("a request the service refuses is reported as refused", async () => {
  const { svc, data } = await signedIn();
  svc.mode = 403;
  assert.deepEqual(await data.setEmailChoice(true), { kind: "failed", reason: "rejected" });
});

test("a yes ticked before sign-in waits under its own stored name", () => {
  assert.equal(PENDING_EMAIL_KEY, "spindle.account.email-choice");
});
