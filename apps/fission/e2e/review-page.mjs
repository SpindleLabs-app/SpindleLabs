// Browser check of the moderators' review page (supabase/review/, community C5b), with the moderation function
// faked, and of its one hard rule: it is never part of the public app build. Shows that:
//   * the built app (dist/) holds nothing of the review page or the moderation function;
//   * the page lists the reports, opens a link, and sends a take-down with the moderator's note;
//   * text from a report (a reason that is HTML with a script) is shown as text, and never runs;
//   * a decision without a note is refused on the page before anything is sent;
//   * an account the function says is not a moderator sees only that, and no list.
// The page runs under its real content security policy here. Run with `npm run e2e`, after `npm run build`;
// E2E_SHOTS=<dir> saves screenshots.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { launch } from "./browser.mjs";
import { handler, pageConfig } from "../../../supabase/review/serve.mjs";

// 1. Not in the public build: no file of dist/ names the moderation function or the review page's script.
const dist = new URL("../dist/", import.meta.url);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const u = new URL(name, dir);
    if (statSync(u).isDirectory()) walk(new URL(`${name}/`, dir));
    else files.push(u);
  }
};
walk(dist);
assert.ok(files.length > 5, "the app is built (npm run build) before this check");
for (const f of files) {
  const text = readFileSync(f, "latin1");
  for (const marker of ["functions/v1/moderation", "review.token", "SpindleLabs review", "not-a-moderator"]) {
    assert.ok(!text.includes(marker), `${f.pathname} holds "${marker}": the review page must never be in the public build`);
  }
}

const server = createServer(handler);
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
const { functionUrl } = pageConfig();
const LINK = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";
const OWNER = "0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const EVIL = '<img src=x onerror="window.__ran=1"><script>window.__ran=1</script>';

const shots = process.env.E2E_SHOTS;
const browser = await launch();
try {
  for (const moderator of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: false });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => sessionStorage.setItem("review.token", "test-token"));
    const asked = [];
    await page.route(functionUrl, async (route) => {
      const ask = JSON.parse(route.request().postData() ?? "{}");
      asked.push({ ask, auth: route.request().headers().authorization });
      if (!moderator) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "not-a-moderator" }) });
      const answers = {
        me: { moderator: "Ben" },
        queue: { queue: [{ share_id: LINK, name: "Bracket", owner: OWNER, open_reports: 3, kinds: ["copyright", "rude"], first_report: "2026-11-11T02:00:00Z", removed_at: null, off_at: null }] },
        link: {
          link: { id: LINK, name: "Bracket", user_id: OWNER, created_at: "2026-11-10T02:00:00Z", off_at: null, removed_at: null, bytes: 1234, picture: null },
          reports: [{ id: 1, kind: "rude", reason: EVIL, reporter: null, created_at: "2026-11-11T02:00:00Z", reviewed_at: null }],
          claims: [],
          record: [],
        },
        decide: { done: true },
      };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answers[ask.do] ?? {}) });
    });
    await page.goto(`${base}/`);
    if (!moderator) {
      await page.waitForSelector("#status.error");
      assert.equal(await page.textContent("#status"), "This account is not on the moderators' list.");
      assert.equal(await page.isVisible("#tabs"), false, "no tabs for an account that isn't a moderator");
      assert.equal(await page.locator("table").count(), 0, "no list shown");
      console.log("PASS an account that isn't a moderator sees only that");
      await context.close();
      continue;
    }
    await page.waitForSelector("tr.pick");
    assert.equal(await page.textContent("#who"), "Signed in as Ben");
    assert.equal(asked[0].auth, "Bearer test-token", "the sign-in goes with every request");
    if (shots) await page.screenshot({ path: `${shots}/review-queue-1280.png` });
    await page.click("tr.pick");
    await page.waitForSelector("text=Reports (1)");
    // The reason is on the page as the characters typed, and nothing in it ran.
    assert.equal(await page.locator("td.reason").first().textContent(), EVIL);
    assert.equal(await page.evaluate(() => window.__ran), undefined, "a report's text never runs");
    assert.equal(await page.locator("main img").count(), 0, "no element came from a report");
    // A decision with no note is refused before anything is sent.
    const before = asked.length;
    await page.click("text=Take down");
    await page.waitForSelector("#status.error");
    assert.match(await page.textContent("#status"), /Write why first/);
    assert.equal(asked.length, before, "nothing sent without a note");
    await page.fill("textarea", "Rude words in the name");
    await page.click("text=Take down");
    await page.locator("#status", { hasText: "Take down: done." }).waitFor();
    const decide = asked.find((a) => a.ask.do === "decide");
    // Only what the moderator chose: the moderator's name is never sent (the function takes it from its list).
    assert.deepEqual(decide.ask, { do: "decide", share: LINK, decision: "take-down", note: "Rude words in the name" });
    if (shots) await page.screenshot({ path: `${shots}/review-link-1280.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS the review page lists, opens and takes down, shows report text as text, and needs a note");
    await context.close();
  }
  // The page's headers: only its own script may run, and it talks only to the account service.
  const res = await fetch(`${base}/`);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self';/);
  assert.ok(!csp.includes("unsafe-inline"), "no inline script allowed");
  assert.match(csp, /connect-src 'self' https:\/\/[^ ;]+;/);
  const config = await (await fetch(`${base}/config.json`)).json();
  assert.deepEqual(Object.keys(config).sort(), ["anonKey", "functionUrl", "url"], "the page is given public values only");
  assert.ok(!/service|secret/i.test(JSON.stringify(config)));
  console.log("PASS the review page runs only its own script and is given public values only");
} finally {
  await browser.close();
  server.close();
}
