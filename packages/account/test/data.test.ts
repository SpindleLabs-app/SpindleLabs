import { test } from "node:test";
import assert from "node:assert/strict";
import { authClient } from "../src/auth.ts";
import { accountData, PENDING_EMAIL_KEY, SEEN_EMAIL_KEY } from "../src/data.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom, USER } from "./fake-service.ts";

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
  return { clock, svc, store, client, data: accountData(client, store) };
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
  for (const bad of [null, "text", 5, [1], { status: "wait" }, { status: "wait", retry_at: "soon" }, { status: "wait", retry_at: "2026-11-13T10:00:00Z", data: 1 }, { status: "wait", retry_at: 1_800_000_000_000 }]) {
    svc.nextData = bad;
    assert.deepEqual(await data.myData(), { kind: "failed", reason: "malformed" }, JSON.stringify(bad));
  }
});

test("Download my data asked again too soon says when it may be asked again (security hunt 2026-11-13 A1)", async () => {
  const { svc, data } = await signedIn();
  svc.dataWait = "2026-11-13T10:01:00+00:00";
  assert.deepEqual(await data.myData(), { kind: "wait", retryAt: new Date(Date.UTC(2026, 10, 13, 10, 1)) });
  assert.equal((await data.myData()).kind, "ok", "once the time has come");
  assert.deepEqual(svc.calls.slice(-1).map((c) => c.url), [`${SERVICE}/rest/v1/rpc/download_my_data`], "only the limited way when the service has it");
});

test("a service from before the limit is asked the old way", async () => {
  const { svc, data } = await signedIn();
  svc.oldData = true;
  const r = await data.myData();
  assert.equal(r.kind === "ok" && JSON.parse(r.value).account.email, "maker@example.com");
  assert.deepEqual(svc.calls.slice(-2).map((c) => c.url), [`${SERVICE}/rest/v1/rpc/download_my_data`, `${SERVICE}/rest/v1/rpc/my_data`]);
});

test("only a refusal of download_my_data is asked the old way: a service that is down is not asked again (issue #330)", async () => {
  // r.kind === "failed" && r.reason === "rejected" turned || would ask my_data after any failure, which here answers.
  let down = true;
  const svc = fakeService(() => 1_800_000_000);
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    if (down && String(input).endsWith("/rpc/download_my_data")) return new Response("{}", { status: 503 });
    return svc.fetch(input, init);
  }) as typeof globalThis.fetch;
  const client = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch, store: memoryStore(), now: () => 1_800_000_000_000, random: seededRandom(11) });
  const go = new URL((await client.beginSignIn())!);
  assert.equal((await client.finishSignIn(`${APP}?code=${svc.approve(go.searchParams.get("code_challenge")!)}`)).kind, "signed-in");
  const data = accountData(client, memoryStore());
  assert.deepEqual(await data.myData(), { kind: "failed", reason: "unavailable" });
  assert.equal(urls.filter((u) => u.endsWith("/rpc/my_data")).length, 0);
  down = false;
  assert.equal((await data.myData()).kind, "ok");
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
  // The profile is still there, as it was before either try: nothing was deleted or changed.
  assert.deepEqual(svc.profile, { email_opt_in: false });
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

test("the last email choice seen is kept under its own stored name, apart from the one waiting for sign-in", async () => {
  // The two names must differ: the pending choice is removed once sign-in reads it, and must not take the seen one with it.
  assert.equal(SEEN_EMAIL_KEY, "spindle.account.email-seen");
  assert.notEqual(SEEN_EMAIL_KEY, PENDING_EMAIL_KEY);
  const { store, data } = await signedIn();
  await data.setEmailChoice(true);
  assert.equal(store.getItem("spindle.account.email-seen"), `${USER.id}:yes`);
});

test("a no saved here shows as no next time, not as the yes before it", async () => {
  const { store, data } = await signedIn();
  assert.deepEqual(await data.setEmailChoice(true), { kind: "ok", value: true });
  assert.equal(data.lastEmailChoice(), true);
  assert.deepEqual(await data.setEmailChoice(false), { kind: "ok", value: false });
  assert.equal(data.lastEmailChoice(), false);
  assert.equal(store.getItem(SEEN_EMAIL_KEY), `${USER.id}:no`);
});

test("the last email choice seen shows at once, and the service's answer puts it right", async () => {
  const { svc, store, client, data } = await signedIn();
  assert.equal(data.lastEmailChoice(), null); // nothing seen yet: the dialog waits for the service
  assert.deepEqual(await data.setEmailChoice(true), { kind: "ok", value: true });
  assert.equal(data.lastEmailChoice(), true); // what was saved shows next time, with no request
  const before = svc.calls.length;
  assert.equal(data.lastEmailChoice(), true);
  assert.equal(svc.calls.length, before, "reading the last choice asks nothing of the service");
  // Changed to no on another device: the service's answer wins and becomes the last choice seen.
  svc.profile = { email_opt_in: false };
  assert.deepEqual(await data.emailChoice(), { kind: "ok", value: false });
  assert.equal(data.lastEmailChoice(), false);
  // A save that fails leaves the last choice as it was.
  svc.mode = "down";
  assert.deepEqual(await data.setEmailChoice(true), { kind: "failed", reason: "offline" });
  assert.equal(data.lastEmailChoice(), false);
  svc.mode = "up";
  // Another person's choice, or a damaged value, is never shown.
  store.setItem(SEEN_EMAIL_KEY, "someone-else:yes");
  assert.equal(data.lastEmailChoice(), null);
  store.setItem(SEEN_EMAIL_KEY, `${USER.id}:maybe`);
  assert.equal(data.lastEmailChoice(), null);
  // Signing out forgets it, and signed out nothing is shown.
  await data.setEmailChoice(true);
  data.forgetEmailChoice();
  assert.equal(store.getItem(SEEN_EMAIL_KEY), null);
  await data.setEmailChoice(true);
  await client.signOut();
  assert.equal(data.lastEmailChoice(), null);
});

test("deleting the account forgets the last email choice seen", async () => {
  const { store, data } = await signedIn();
  await data.setEmailChoice(true);
  // Kept as "<user id>:yes" (data.ts), so the removal below is seen to take away a real entry.
  assert.equal(store.getItem(SEEN_EMAIL_KEY), `${USER.id}:yes`);
  assert.deepEqual(await data.deleteAccount(), { kind: "ok", value: true });
  assert.equal(store.getItem(SEEN_EMAIL_KEY), null);
});

test("with storage blocked, the last email choice is simply not known", async () => {
  const { client } = await signedIn();
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  const data = accountData(client, blocked);
  assert.deepEqual(await data.setEmailChoice(true), { kind: "ok", value: true });
  assert.equal(data.lastEmailChoice(), null);
  data.forgetEmailChoice();
});
