// A session the sign-in service ended (lost-work hunt 2026-11-12, issue #628 item 4): the real authClient and the
// app's startDesigns over the package's fake service. Cloud save stopped for good and nothing said so.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { authClient, SESSION_KEY } from "../../account/src/auth.ts";
import { LINKS_PREFIX } from "../../account/src/sync.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom, USER } from "../../account/test/fake-service.ts";

const g = globalThis as unknown as { addEventListener?: unknown };
g.addEventListener ??= () => {};
const { startDesigns, reportWords, RETRY_MAX_MS, SIGNED_OUT_WORDS } = (await import(new URL("../../../apps/fission/src/my-designs.ts", import.meta.url).href)) as typeof import("../../../apps/fission/src/my-designs.ts");
const APP = "https://spindlelabs.app/";
const settle = async (n = 200) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

test("when the service no longer accepts this browser's session, the shell is told once, and the words say so", async () => {
  const nav = globalThis.navigator as unknown as { locks?: unknown };
  Object.defineProperty(nav, "locks", { value: { request: (_n: string, fn: () => Promise<unknown>) => fn() }, configurable: true });
  let ms = 1_800_000_000_000;
  let told = 0;
  const svc = fakeService(() => ms / 1000);
  const store = memoryStore();
  const client = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: APP }, fetch: svc.fetch, store, now: () => ms, random: seededRandom(1), lock: undefined, sessionLost: () => told++ });
  // Sign in.
  const go = await client.beginSignIn();
  const back = new URL(APP);
  back.searchParams.set("code", svc.approve(new URL(go!).searchParams.get("code_challenge")!));
  assert.equal((await client.finishSignIn(back.href)).kind, "signed-in");
  store.setItem(LINKS_PREFIX + USER.id, "{}"); // first-time question answered

  const projects = new Map([["p1", { name: "Bracket", text: "v1", modified: new Date(ms) }]]);
  const designs = startDesigns(
    client,
    {
      list: async () => [...projects].map(([id, p]) => ({ id, name: p.name, modified: p.modified })),
      text: async (id) => projects.get(id)?.text ?? null,
      put: async () => "x",
      openId: () => "p1",
      open: async () => {},
      workspace: () => "design",
      picture: () => null,
    },
    store,
  );
  assert.equal(told, 0);

  // Two hours later (the access token ran out) the service has ended the session: the account's sessions were ended
  // from the service's side (its inactivity or single-session setting, a refresh token used twice, the account's
  // sign-ins revoked), which the fake models by forgetting the refresh token.
  ms += 2 * 3600_000;
  svc.liveRefresh.clear();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    projects.set("p1", { name: "Bracket", text: "v2: two more hours of work", modified: new Date(ms) });
    designs.saved(); // main.ts calls this on every "Saved"
    mock.timers.tick(5000);
    mock.timers.reset();
    await settle();
    mock.timers.enable({ apis: ["setTimeout"] });
    const before = svc.calls.length;
    // A day of further work, each save starting its timer; any retry timer would fire too.
    for (let h = 0; h < 24; h++) {
      projects.set("p1", { name: "Bracket", text: `v${3 + h}`, modified: new Date((ms += 3600_000)) });
      designs.saved();
      mock.timers.tick(RETRY_MAX_MS * 6);
    }
    mock.timers.reset();
    await settle();
    const state = client.state().kind;
    assert.equal(state, "signed-out");
    assert.equal(told, 1, "said once, by the request that found the session ended");
    assert.equal(reportWords({ kind: "signed-out" }), SIGNED_OUT_WORDS);
    assert.match(SIGNED_OUT_WORDS, /^You're signed out, so your changes are no longer kept in your account\./);
  } finally {
    mock.timers.reset();
    delete nav.locks;
  }
});
