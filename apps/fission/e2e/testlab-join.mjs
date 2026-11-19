// Browser check of TestLab's Join (Ben, 2026-11-19), in a real Chromium with `?testlab`: a file with two steel-coloured
// boxes 50 × 10 × 10 end to end (Box 1 x 0..50, Box 2 moved to x 50..100; worked by hand from the file below).
// - TestLab lists Body 1 and Body 2 and picks neither without asking; Body 1 chosen, Join bodies… opens the chooser:
//   Join off with only Body 1 ticked, on once Body 2 is; Join gives "Joined for this test: Body 1 and Body 2. The design
//   isn't changed." and both rows say joined. Body 1's front (y = 0) held and Body 2's top (z = 10) pushed by taps on the
//   view; both lie level with the other body's front and top, so joined each is one face: said in words. Run shows
//   the results card naming "Body 1 and Body 2, joined".
// - Design afterwards still has Box 1 and Box 2 as two bodies: the join never reached the design.
// - Unjoin puts Body 1 back alone and takes Body 2's top off the load, said in words.
// - At 375 px with taps: the chooser's ticks and buttons 32 px tall or more, nothing wider than the page, Run's card.
// Screenshots: E2E_SHOTS=<dir> saves testlab-join-pick-{1280,375}.png and testlab-join-run-{1280,375}.png.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { openPanel } from "./start.mjs";

const PORT = 4639;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
const browser = await launch();
const shots = process.env.E2E_SHOTS;
const errors = [];
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}
const status = (page) => page.evaluate(() => document.querySelector(".testlab-page-status")?.textContent ?? "(no page)");
const until = (page, fn, arg, what, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out (status: "${await status(page)}")`));

const box = (n) => ({
  dependsOn: [],
  id: `feature-${n}`,
  intent: { parameters: { width: 50, depth: 10, height: 10 }, summary: "Box: 50 × 10 × 10 mm", type: "box" },
  provenance: { from: [], self: { id: `feature-${n}`, label: `Box ${n}`, workspace: "design" } },
  suppressed: false,
});
const move = {
  dependsOn: ["feature-2"],
  id: "feature-3",
  intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x: 50, y: 0, z: 0 }, summary: "Move Box 2 by (50, 0, 0) mm", type: "move" },
  provenance: { from: [{ id: "feature-2", label: "Box 2", workspace: "design" }], self: { id: "feature-3", label: "Move 1", workspace: "design" } },
  suppressed: false,
};
const project = { formatVersion: 2, links: [], materials: [], name: "Join check", units: { length: "mm" }, workspaces: { design: { nextId: 4, profiles: [], sketches: [], version: 4, timeline: { features: [box(1), box(2), move] } } } };

// The pinhole camera (testlab-page.mjs's sums): forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field.
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
async function screenOf(page, p) {
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const b = await page.locator("#viewport canvas").boundingBox();
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const nx = dot(v, right) / (dot(v, forward) * T * (b.width / b.height));
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: b.x + ((nx + 1) / 2) * b.width, y: b.y + ((1 - ny) / 2) * b.height };
}
/** Clicks or taps the world point `p` on the canvas; fails when something else is on top of it. */
async function at(page, p, tap) {
  const s = await screenOf(page, p);
  const on = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}

async function opened(width) {
  const phone = width < 640;
  const context = await browser.newContext({ viewport: { width, height: phone ? 760 : 800 }, ...(phone && { hasTouch: true, isMobile: true }) });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}?testlab&test-hooks#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "join.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 3, null, "the file open");
  await page.evaluate(() => (location.hash = "#simulate"));
  await until(page, () => document.body.dataset.activeWorkspace === "simulate", null, "TestLab shown");
  return { context, page, tap: phone };
}
const press = async (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const inBrowser = async (page, tap) => tap && openPanel(page, "browser", tap);
const inProperties = async (page, tap) => tap && openPanel(page, "properties", tap);

/** The flow at one width: choose, join, pick, run, check the design, unjoin. */
async function joinAndRun(width) {
  const { context, page, tap } = await opened(width);
  await inBrowser(page, tap);
  await until(page, () => [...document.querySelectorAll("input[name=testlab-body]")].map((r) => r.closest("li").textContent.trim()).join() === "Body 1,Body 2", null, "both bodies listed");
  assert.equal(await page.locator("input[name=testlab-body]:checked").count(), 0, "two bodies: none chosen without asking");
  await press(page, "input[name=testlab-body] >> nth=0", tap);
  await until(page, () => document.querySelector("[data-testlab=join]") !== null, null, "Join bodies… offered");
  await inBrowser(page, tap);
  await press(page, "[data-testlab=join]", tap);
  await until(page, () => document.querySelector("[data-testlab=join-ok]")?.disabled === true, null, "Join off with one body ticked");
  await press(page, "input[name=join-body] >> nth=1", tap);
  await until(page, () => document.querySelector("[data-testlab=join-ok]")?.disabled === false, null, "Join on with two ticked");
  // Every control in the chooser reachable by a finger and on the page.
  const sizes = await page.locator(".testlab-join-pick label, .testlab-join-pick button").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, right: r.right, w: innerWidth }; }));
  assert.ok(sizes.length === 5 && sizes.every((s) => s.h >= 32 && s.right <= s.w), JSON.stringify(sizes));
  if (shots) await page.screenshot({ path: `${shots}/testlab-join-pick-${width}.png` });
  await press(page, "[data-testlab=join-ok]", tap);
  await until(page, () => document.querySelector(".testlab-page-body")?.textContent === "Joined for this test: Body 1 and Body 2. The design isn't changed.", null, "the joined words");
  assert.equal(await page.locator(".testlab-page-bodies li[data-joined=true]").count(), 2);
  // Body 1's front held, Body 2's top pushed (10 N down, the starting load), steel.
  await inProperties(page, tap);
  await page.selectOption(".testlab-page select[name=material]", "steel-a36");
  await press(page, "[data-testlab=pick-held]", tap);
  if (tap) await page.waitForTimeout(300); // the sheet sliding away
  await at(page, [25, 0, 5], tap);
  await until(page, () => document.querySelector(".testlab-page-held li")?.textContent?.startsWith("Front face of Body 1"), null, "Body 1's front held");
  await inProperties(page, tap);
  await press(page, "[data-testlab=add-load]", tap);
  if (tap) await until(page, () => document.querySelector("#properties-toggle")?.getAttribute("aria-expanded") === "false", null, "the sheet put away for picking");
  if (tap) await page.waitForTimeout(300); // the sheet sliding away
  await at(page, [75, 5, 10], tap);
  await until(page, () => document.querySelector(".testlab-page-load li")?.textContent?.startsWith("Top face of Body 2"), null, "Body 2's top pushed");
  await inProperties(page, tap);
  await press(page, "[data-testlab=run]", tap);
  await until(page, () => document.querySelector(".testlab-results-card") !== null || /^Not run|^Stopped/.test(document.querySelector(".testlab-page-status")?.textContent ?? ""), null, "Run's result", 120000);
  // Body 1's front lies level with Body 2's, so joined they are one face, held whole: said, never silent.
  assert.match(await status(page), /^Held here: joining makes Front face of Body 2 one face with a face it picked, so it holds that too\. Load 1: joining makes Top face of Body 1 one face with a face it picked, so it pushes on that too\.$/);
  const setUp = await page.locator(".testlab-results-setup").evaluate((dl) => [...dl.children].map((e) => e.textContent));
  assert.deepEqual(setUp.slice(0, 2), ["Part", "Body 1 and Body 2, joined"]);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= width, `the page is ${wide} px wide`);
  if (shots) await page.screenshot({ path: `${shots}/testlab-join-run-${width}.png` });
  // The design still holds two bodies.
  await page.evaluate(() => (location.hash = "#design"));
  await until(page, () => document.body.dataset.activeWorkspace === "design", null, "Design shown");
  const rows = await page.evaluate(() => [...document.querySelectorAll(".tree-row")].map((r) => r.dataset.node ?? "").filter((n) => /^body-\d+$/.test(n)).length);
  assert.equal(rows, 2, "Design still has its two bodies");
  // Unjoin: Body 1 alone again, Body 2's top taken off its load in words.
  await page.evaluate(() => (location.hash = "#simulate"));
  await until(page, () => document.body.dataset.activeWorkspace === "simulate", null, "TestLab shown");
  await inBrowser(page, tap);
  await press(page, "[data-testlab=unjoin]", tap);
  await until(page, () => document.querySelector(".testlab-page-body")?.textContent === "Testing Body 1 from Design.", null, "Body 1 alone");
  assert.match(await status(page), /Took Top face of Body 2 off: it is on a body no longer tested\./);
  await context.close();
}

try {
  await check("1280 px: two bodies joined for the test, faces picked on both, Run names the joined part; Design unchanged; Unjoin", () => joinAndRun(1280));
  await check("375 px with taps: the same, every control reachable, nothing off the side", () => joinAndRun(375));
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) process.exit(1);
