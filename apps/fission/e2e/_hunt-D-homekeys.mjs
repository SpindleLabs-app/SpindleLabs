// Hunter D: (1) keys pressed while the home screen is up over a kept project must not change it (Delete, Ctrl+Z,
// Ctrl+Shift+Z, Backspace, letters, Enter, Space). (2) a first visit, New project: how many tabs, and after a reload.
// usage: node e2e/_hunt-D-homekeys.mjs <w> <h>
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { insertPreset, closePanels } from "./start.mjs";
const W = Number(process.argv[2] ?? 1280), H = Number(process.argv[3] ?? 800);
const tap = W < 700;
const server = await preview({ preview: { port: 5354, strictPort: true }, logLevel: "error" });
const browser = await launch();
const errors = [];
const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: tap, isMobile: tap, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console " + m.text()));
const until = (fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => { throw new Error(`${what}: timed out`); });
const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
const state = () => page.evaluate(async () => ({ items: [...document.querySelectorAll("#timeline li[data-item]")].map((l) => l.textContent.trim().slice(0, 40)), bodies: await window.fissionTest.bodyCount(), undo: document.getElementById("undo")?.title, tool: [...document.querySelectorAll("[id$=-panel]")].filter((p) => !p.hidden && p.checkVisibility()).map((p) => p.id), name: document.title, tabs: [...document.querySelectorAll(".design-tab, [data-tab-id], #design-tabs [role=tab]")].map((t) => t.textContent.trim().slice(0, 30)), count: document.querySelector("#design-tabs-switch")?.textContent?.trim() }));
try {
  await page.addInitScript(() => { if (!sessionStorage.getItem("d-seen")) { sessionStorage.setItem("d-seen", "1"); indexedDB.deleteDatabase("fission"); } });
  await page.goto("http://localhost:5354/?all&test-hooks#design");
  await until(() => document.getElementById("home") && !document.getElementById("home").hidden, null, "home");
  console.log("first visit, home up:", JSON.stringify(await state()));
  await press("#home-new");
  await until(() => document.getElementById("home").hidden, null, "home gone");
  await page.waitForTimeout(800);
  console.log("after New project:", JSON.stringify(await state()));
  await insertPreset(page, "box", tap);
  await until(() => document.querySelector("#save-status")?.dataset.state === "saved", null, "saved");
  await page.waitForTimeout(500);
  const before = await state();
  console.log("with a box:", JSON.stringify(before));
  await page.reload();
  await until(() => document.getElementById("home") && !document.getElementById("home").hidden, null, "home after reload");
  await page.waitForTimeout(2500);
  console.log("after reload, home up:", JSON.stringify(await state()));
  if (!tap) {
    // keys a person might press while looking at the home screen
    const how = process.env.CLICK ?? "picture";
    if (how === "picture") await page.mouse.click(W / 2, H - 100); // a click on the picture (not a button)
    if (how === "search") await page.click("#home-search");
    if (how === "tab") await page.keyboard.press("Tab");
    console.log("focus:", how, await page.evaluate(() => { const a = document.activeElement; return `${a?.tagName}#${a?.id}.${a?.className} in home: ${!!a?.closest("#home")}`; }), "what is under the click:", await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return `${e?.tagName}#${e?.id}.${e?.className}`; }, [W / 2, H - 100]));
    for (const k of (process.env.KEYS ?? "Delete,Backspace,ControlOrMeta+z,ControlOrMeta+Shift+z,ControlOrMeta+y,e,b,Enter,Space,ControlOrMeta+a,Delete,ControlOrMeta+d").split(",")) { await page.keyboard.press(k); await page.waitForTimeout(300); console.log("  after", k, JSON.stringify(await state())); }
    await page.waitForTimeout(1500);
    console.log("home still up?", await page.evaluate(() => !document.getElementById("home").hidden), "folded?", await page.evaluate(() => document.getElementById("home").classList.contains("home-folded")));
  }
  if (await page.evaluate(() => !document.getElementById("home").hidden)) await press("#home-close");
  await until(() => document.getElementById("home").hidden, null, "home gone");
  await page.waitForTimeout(1500);
  const after = await state();
  console.log("after keys + Back to my project:", JSON.stringify(after));
  console.log(JSON.stringify(before.items) === JSON.stringify(after.items) && before.bodies === after.bodies ? "UNCHANGED (good)" : "CHANGED (bad)");
  console.log("undo title", await page.getAttribute("#undo", "title"));
  await page.screenshot({ path: `/mnt/project-files/bug-hunts/app-2026-11-18/D/homekeys-${W}-${process.env.CLICK ?? "picture"}.png` });
  if (process.env.RELOAD2) {
    await page.waitForTimeout(1500);
    await page.reload();
    await until(() => document.getElementById("home") && !document.getElementById("home").hidden, null, "home after 2nd reload");
    await press("#home-close");
    await page.waitForTimeout(2500);
    console.log("after a second reload:", JSON.stringify(await state()));
  }
} catch (e) { console.log("FAILED", e.message); }
console.log("errors", errors);
await browser.close(); await server.close();
