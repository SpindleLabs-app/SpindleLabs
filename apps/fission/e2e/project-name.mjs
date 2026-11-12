// Browser check of the project's name in the top bar (UI audit 2026-11-12, Ben's choice A): the bar's empty middle shows
// the open project's name, and a click there renames it in place. At 1280 × 800 with a mouse: the name shows "Untitled",
// near the bar's middle, the bar still one row; a click and typing "Bracket" with Enter renames it (typed letters never
// reach the workspace's shortcuts); the rename is an undo step (Undo's title names it, Undo puts "Untitled" back, Redo
// "Bracket"); Escape mid-typing puts the name back; the name is stored, so a reload opens "Bracket". Under 1200 px (too
// little room once Sign in shows, e2e/account.mjs checks nothing overlaps) and on a phone it is not shown. Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4896, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4896/#design";
const browser = await launch();
const errors = [];
let failed = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n${e.stack}`);
  }
}

async function opened(width, height, phone = false) {
  const context = await browser.newContext({ viewport: { width, height }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.locator("#start-hint").waitFor();
  return { page, context };
}

/** The top bar's height, and how many rows its shown children make (a new row where one's middle sits 20 px or more lower). */
const bar = (page) =>
  page.evaluate(() => {
    const top = document.getElementById("topbar");
    const mids = [...top.children].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).position !== "absolute").map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b);
    return { height: top.getBoundingClientRect().height, rows: mids.filter((m, k) => k === 0 || m - mids[k - 1] >= 20).length };
  });

const nameValue = (page) => page.inputValue("#project-name");

await check("1280 × 800 with a mouse: the name in the bar's middle, renamed in place, undone and redone, kept after a reload", async () => {
  const { page, context } = await opened(1280, 800);
  const box = await page.locator("#project-name").boundingBox();
  assert.ok(box && box.width > 100, `the name is shown (${JSON.stringify(box)})`);
  assert.equal(await nameValue(page), "Untitled");
  assert.equal(await page.getAttribute("#project-name", "aria-label"), "Project name");
  // Near the middle: its centre within 128 px (10% of the width) of the bar's 640 (the groups either side differ in
  // width, and more so in the wider fonts of CI's Linux), and clear of the workspace button and the save status.
  const centre = box.x + box.width / 2;
  assert.ok(Math.abs(centre - 640) <= 128, `its centre ${centre} near 640`);
  const sides = await page.evaluate(() => [document.getElementById("workspaces").getBoundingClientRect().right, (() => { let e = document.getElementById("project-name").nextElementSibling; while (e && !(e.getBoundingClientRect().width > 0) && getComputedStyle(e).display !== "contents") e = e.nextElementSibling; const first = e && getComputedStyle(e).display === "contents" ? [...e.children].find((c) => c.getBoundingClientRect().width > 0) : e; return first.getBoundingClientRect().left; })()]);
  assert.ok(box.x >= sides[0] && box.x + box.width <= sides[1] + 1, `between the workspace button and what follows (${JSON.stringify(sides)})`);
  const b = await bar(page);
  assert.equal(b.rows, 1, `the top bar is one row (${b.rows}, ${b.height} px)`);
  // Click, select all, type a name with letters that are shortcuts elsewhere (L draws a line, R a rectangle), Enter.
  await page.click("#project-name");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Bracket LR");
  await page.keyboard.press("Enter");
  assert.equal(await nameValue(page), "Bracket LR");
  assert.notEqual(await page.evaluate(() => document.getElementById("viewport").dataset.sketching), "true", "typing in the name started no tool");
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), "project-name", "Enter leaves the box");
  // The rename is an undo step.
  assert.match(await page.getAttribute("#undo", "title"), /Undo Rename project/);
  await page.click("#undo");
  await page.waitForFunction(() => document.getElementById("project-name").value === "Untitled", null, { timeout: 5000 }).catch(() => assert.fail("Undo puts the old name back"));
  await page.click("#redo");
  await page.waitForFunction(() => document.getElementById("project-name").value === "Bracket LR", null, { timeout: 5000 }).catch(() => assert.fail("Redo brings the new name back"));
  // Escape mid-typing puts the name back, renaming nothing.
  await page.click("#project-name");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Typo");
  await page.keyboard.press("Escape");
  assert.equal(await nameValue(page), "Bracket LR");
  assert.match(await page.getAttribute("#undo", "title"), /Undo Rename project/, "Escape made no step of its own");
  // An empty name keeps the old one.
  await page.click("#project-name");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  assert.equal(await nameValue(page), "Bracket LR");
  // Stored like any edit: once saved, a reload opens the project under its new name.
  await page.waitForFunction(() => document.getElementById("save-status")?.dataset.state === "saved", null, { timeout: 20000 }).catch(() => assert.fail("the rename is stored"));
  await page.reload();
  await page.locator("#project-name").waitFor();
  await page.waitForFunction(() => document.getElementById("project-name").value === "Bracket LR", null, { timeout: 10000 }).catch(async () => assert.fail(`a reload opens "Bracket LR" (shows "${await nameValue(page)}")`));
  await context.close();
});

for (const [width, height, phone] of [[1100, 700, false], [899, 700, false], [375, 667, true]]) {
  await check(`${width} px${phone ? " with taps" : ""}: no room to spare, so no name in the bar`, async () => {
    const { page, context } = await opened(width, height, phone);
    assert.equal(await page.locator("#project-name").isVisible(), false, "the name is left out");
    await context.close();
  });
}

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
if (failed) process.exit(1);
