// A browser with no 3D drawing (bug hunt 2026-11-18 D-11): Chromium started with WebGL turned off, as a school's or
// company's policy does. The app used to shimmer its loading shapes for good over an uncaught "Error creating WebGL
// context"; now the words of src/no-3d.ts are where the shapes were, at once and with no page error, at 1280 px and at
// 375 px with taps, with and without ?all (the home screen). Control: the normal browser starts the app as ever.
// Chromium only (the switch is Chromium's). `E2E_DIST` names another build.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { browserName, launch } from "./browser.mjs";

if (browserName !== "chromium") {
  console.log("ok - skipped: the switch turning WebGL off is Chromium's");
  process.exit(0);
}
const DIST = process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = 4971;
const server = await preview({ build: { outDir: DIST }, preview: { port: PORT, strictPort: true }, logLevel: "error" });
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${String(e.stack ?? e).split("\n").slice(0, 4).join("\n  ")}`);
  }
}

const off = await launch(["--disable-3d-apis", "--disable-webgl", "--disable-webgl2"]);
for (const [W, H, touch] of [[1280, 800, false], [375, 667, true]]) {
  for (const query of ["", "?all"]) {
    await check(`no WebGL at ${W} px${touch ? " with taps" : ""}${query ? ` (${query})` : ""}: the words where the loading shapes were, no page error`, async () => {
      const context = await off.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://localhost:${PORT}/${query}#design`);
      assert.equal(await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2")), false, "WebGL is off (the case being checked)");
      const words = page.locator("#app-skeleton.no-3d[role=alert]");
      await words.waitFor({ timeout: 10000 });
      assert.match(await words.innerText(), /could not start 3D drawing \(WebGL\)/);
      assert.match(await words.innerText(), /Projects kept in this browser are still here/);
      // Readable: on screen, not faded (the skeleton's own rule is opacity 0 for 200 ms), and nothing runs off the side.
      const box = await words.evaluate((e) => {
        const r = e.querySelector("p").getBoundingClientRect();
        return { opacity: getComputedStyle(e).opacity, left: r.left, right: r.right, top: r.top, bottom: r.bottom, wide: document.scrollingElement.scrollWidth };
      });
      assert.equal(box.opacity, "1");
      assert.ok(box.left >= 0 && box.right <= W && box.top >= 0 && box.bottom <= H, `the words on screen: ${JSON.stringify(box)}`);
      assert.ok(box.wide <= W, `nothing wider than the page (${box.wide})`);
      await page.waitForTimeout(1000);
      assert.deepEqual(errors, [], "no page error");
      await context.close();
    });
  }
}
await off.close();

await check("control: with WebGL the app starts as ever and shows no such words", async () => {
  const on = await launch();
  const page = await (await on.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(`http://localhost:${PORT}/#design`);
  await page.locator("#start-hint").waitFor({ timeout: 20000 });
  assert.equal(await page.locator(".no-3d").count(), 0);
  await on.close();
});

await server.close();
process.exit(failed ? 1 : 0);
