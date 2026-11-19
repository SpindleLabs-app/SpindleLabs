// Browser check of the TestLab page (Simulate workspace step T1, behind ?testlab), in a real Chromium.
// - Without ?testlab, #simulate is still the Simulate placeholder: no page.
// - With ?testlab, the 40 × 30 × 20 box (x 0..40, y 0..30, z 0..20) from Design is tested without being asked: its front
//   face (y = 0) tapped to hold, a load added and the top (z = 20) tapped, typed 5 kg: "5 kg hanging (49.0 N) down on
//   1 face" (5 × 9.80665), made of PLA with its numbers (T2). Run (T5b) works it out on the kernel: the result section
//   with its safety factor in the safe band (by hand: the 40 × 20 section 15 mm from the hold, M = 49 · 15 = 735 N·mm,
//   I = 40 · 20³ / 12 = 26,667 mm⁴, σ = 735 · 10 / 26,667 = 0.28 MPa against PLA's 35, a factor near 100), the part
//   drawn in the colour map, its bend and stress in mm and MPa, and Colour by Bend.
// - The box typed 35 high in Design: back in TestLab the study is out of date with the change note naming the edit, and
//   the top is found again by name at z = 35 (its paint read off the canvas there); the result says it is out of date and
//   the view shows the part as it is now, not the colour map. The box made a sphere: both faces
//   lost, said in words; Undo brings them back.
// - At 375 px with taps: picking puts the Properties sheet away so the body can be tapped; Run shows the result; nothing
//   runs off the side. The picking hint over the view (T5c5) shows inside the window, uncovered, at both widths.
// - The results card (Ben, 19 Nov): the verdict, Body 1, PLA, the 5 kg on the top and the front held, and where it would
//   start to break; 1,000 kg says Would break with no stress or bend on the card, at 1280 and 375 px.
// - Each face the card names is a button: pressed, the view glides square onto that face (the top from above, the front
//   from the front, against the box worked by hand), framed round it and lit for a moment; a press on the view stops a
//   glide; at 375 px a tap puts the sheet away first.
// Screenshots: E2E_SHOTS=<dir> saves testlab-1280.png, testlab-taller-1280.png, testlab-lost-1280.png, testlab-375.png, the picking hint over the view as testlab-hint-1280.png and testlab-hint-375.png, and the cards as testlab-card-holds-1280.png and testlab-card-breaks-{1280,375}.png (with testlab-page-breaks-*.png), and a face shown from the card as testlab-face-top-1280.png and testlab-face-front-{1280,375}.png.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { openPanel, chooseShape, startWithBox } from "./start.mjs";
import { pinProperties } from "./properties.mjs";

const PORT = 4637;
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
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out (status: "${await status(page)}")`));
const status = (page) => page.evaluate(() => document.querySelector(".testlab-page-status")?.textContent ?? "(no page)");
const saying = (page, re, what) => until(page, (s) => new RegExp(s).test(document.querySelector(".testlab-page-status")?.textContent ?? ""), re.source, what);

// The pinhole camera (navigation.mjs's sums): forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field.
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
async function screenOf(page, p) {
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const box = await page.locator("#viewport canvas").boundingBox();
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const nx = dot(v, right) / (dot(v, forward) * T * (box.width / box.height));
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
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

async function newPage(query, width = 1280) {
  const phone = width < 640;
  const context = await browser.newContext({ viewport: { width, height: phone ? 760 : 800 }, ...(phone && { hasTouch: true, isMobile: true }) });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}${query}#design`);
  return { context, page, tap: phone };
}
const toTestLab = async (page) => {
  await page.evaluate(() => (location.hash = "#simulate"));
  await until(page, () => document.body.dataset.activeWorkspace === "simulate", null, "TestLab shown");
};
const toDesign = async (page) => {
  await page.evaluate(() => (location.hash = "#design"));
  await until(page, () => document.body.dataset.activeWorkspace === "design", null, "Design shown");
};
const press = async (page, sel, tap) => {
  await openPanel(page, "properties", tap);
  if (tap) await page.tap(sel);
  else await page.click(sel);
};

/**
 * T5c5: the picking hint over the view says `words`, wholly inside the window and on top at its middle (on a phone the
 * Properties sheet is put away while picking, so this is the only place the words can be seen).
 */
async function hintShows(page, words, shot) {
  await until(page, (w) => { const h = document.querySelector("#testlab-view-hint"); return h !== null && !h.hidden && h.textContent === w; }, words, `the hint "${words}" over the view`);
  const box = await page.evaluate(() => {
    const h = document.querySelector("#testlab-view-hint");
    const r = h.getBoundingClientRect();
    // The hint takes no presses (pointer-events: none), so elementFromPoint skips it: let it take them while asked.
    h.style.pointerEvents = "auto";
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    h.style.pointerEvents = "";
    // The overlays' legend ("Held here") is never under it.
    const legend = document.querySelector(".overlay-legend:not([hidden])")?.getBoundingClientRect();
    const overLegend = legend !== undefined && legend.height > 0 && r.left < legend.right && legend.left < r.right && r.top < legend.bottom && legend.top < r.bottom;
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, onTop: top === h || h.contains(top), overLegend };
  });
  assert.ok(!box.overLegend, `the hint lies over the overlays' legend: ${JSON.stringify(box)}`);
  assert.ok(box.left >= 0 && box.right <= box.width && box.top >= 0 && box.bottom <= box.height, `the hint is inside the window: ${JSON.stringify(box)}`);
  assert.ok(box.onTop, "nothing covers the hint");
  if (shots && shot) await page.screenshot({ path: `${shots}/${shot}-${box.width}.png` });
}

/** Holds the front face, adds a 5 kg load on the top, all by clicks or taps on the body. */
async function setUpStudy(page, tap) {
  await until(page, () => document.querySelector("section[aria-label='TestLab study'] h2")?.textContent === "Study 1: static stress", null, "Study 1 set up");
  await press(page, "[data-testlab=pick-held]", tap);
  await hintShows(page, "Tap the faces to hold. Tap a held face to let it go.", "testlab-hint");
  await at(page, [20, 0, 10], tap); // the front face's middle
  await until(page, () => document.querySelector(".testlab-page-held li")?.textContent?.startsWith("Front face"), null, "the front held");
  await press(page, "[data-testlab=add-load]", tap);
  if (tap) await page.waitForTimeout(300); // the sheet sliding away
  await hintShows(page, "Tap the faces Load 1 pushes. Tap a pushed face to let it go.");
  await at(page, [20, 15, 20], tap); // the top's middle
  await until(page, () => document.querySelector(".testlab-page-load li")?.textContent?.startsWith("Top face"), null, "the top pushed");
  await openPanel(page, "properties", tap);
  await page.fill(".testlab-page input[name=amount]", "5");
  await page.press(".testlab-page input[name=amount]", "Enter");
  await page.selectOption(".testlab-page select[name=unit]", "kg");
  // 5 kg × 9.80665 m/s² = 49.03 N.
  await until(page, () => document.querySelector(".testlab-page-load .testlab-page-words")?.textContent === "5 kg hanging (49.0 N) down on 1 face", null, "the load in words");
  // T2: what it is made of, asked once; PLA across its layers: the lower of 2160 and 2370 MPa, and 35 MPa (the maker's sheet).
  assert.match(await status(page), /Choose what the part is made of\./);
  await page.selectOption(".testlab-page select[name=material]", "pla");
  await until(page, () => /Stiffness 2,160 MPa, breaking strength 35 MPa, 1\.24 g\/cm³\./.test(document.querySelector(".testlab-page-material")?.textContent ?? ""), null, "PLA's numbers");
  assert.doesNotMatch(await status(page), /Choose what the part is made of/);
}

/** The colour of the canvas pixel at world point `p` (premultiplied RGBA). */
async function pixel(page, p) {
  const s = await screenOf(page, p);
  const shot = await page.screenshot({ clip: { x: Math.round(s.x), y: Math.round(s.y), width: 1, height: 1 } });
  const { decodePng } = await import("./png.mjs");
  const img = decodePng(shot);
  return [...img.data.slice(0, 3)];
}

/** Waits for Run's result: shown, safe, its numbers in mm and MPa, the part in the colour map. */
async function shownResult(page) {
  await until(page, () => document.querySelector(".testlab-results") !== null || /^Not run|^Stopped/.test(document.querySelector(".testlab-page-status")?.textContent ?? ""), null, "Run's result", 120000);
  assert.equal(await status(page), "");
  assert.equal(await page.getAttribute(".testlab-results-factor", "data-band"), "safe");
  const factor = Number((await page.locator(".testlab-results-factor-value").textContent()).replace(/,/g, ""));
  assert.ok(factor > 20 && factor < 1000, `safety factor ${factor} (about 100 by hand)`);
  const facts = await page.locator(".testlab-results-facts dd").allTextContents();
  assert.match(facts[0], /^\d[\d.,]* mm$/);
  assert.match(facts[1], /^\d[\d.,]* MPa, the highest found anywhere in the part \(PLA/);
  await until(page, () => Number(document.querySelector("[data-colour-map]")?.getAttribute("data-colour-map") ?? 0) > 0, null, "the colour map drawn");
  assert.equal(await page.locator("[data-testlab=cancel]").count(), 0);
  // The results card: the verdict and the set-up as it was run, at a glance.
  assert.equal(await page.locator(".testlab-results-verdict").textContent(), "Holds");
  const setUp = await page.locator(".testlab-results-setup").evaluate((dl) => [...dl.children].map((e) => e.textContent));
  assert.deepEqual(setUp, ["Part", "Body 1", "Made of", "PLA, printed", "Pushed", "5 kg hanging (49.0 N) down on Top face", "Held", "Front face"]);
  assert.match(await page.locator(".testlab-results-limit").textContent(), /^It could take about [\d,]+ kg before it starts to break\.$/);
  await cardInSight(page);
  await dotsExplained(page);
}

/**
 * Ben (19 Nov): each dot over the result has its own legend line, in the dot's own colour and naming it (the one red
 * "Biggest stress and bend" left the violet dot unexplained); the lines wholly on screen.
 */
async function dotsExplained(page) {
  const lines = await page.locator("#viewport .overlay-legend li").evaluateAll((lis) => lis.map((li) => {
    const r = li.getBoundingClientRect();
    return { words: li.textContent, severity: li.dataset.severity, colour: getComputedStyle(li).color, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
  }));
  assert.deepEqual(lines.map((l) => [l.words, l.severity]), [["● Red dot: biggest stress", "error"], ["● Violet dot: biggest bend", "info"]]);
  assert.notEqual(lines[0].colour, lines[1].colour, "each line in its own dot's colour");
  assert.ok(lines.every((l) => l.inside), JSON.stringify(lines));
}

/**
 * A face named on the card is a button (Ben, 19 Nov): pressed, the view glides square onto that face from outside, framed
 * round it, and lights it (the view's data-highlight) for a moment. Checked against the box worked by hand: `centre` the
 * face's middle, `toward` its outward side; the bent drawing moves the face a few mm, the camera's target must be within
 * 4 mm of the middle and its direction within 10° of square on. The camera may still be gliding for about half a second.
 */
async function showsFace(page, tap, name, centre, toward, shot) {
  const button = page.locator(".testlab-results-card button[data-testlab-face]", { hasText: name }).first();
  assert.equal(await button.getAttribute("aria-label"), `Show ${name} in the view`);
  const sized = await button.boundingBox();
  assert.ok(sized.height >= 28, `the ${name} button is ${sized.height} px tall`);
  if (tap) await button.tap();
  else await button.click();
  await until(page, () => /faces \d/.test(document.querySelector("[data-highlight]")?.dataset.highlight ?? ""), null, `${name} lit`);
  if (tap) await until(page, () => document.querySelector("#properties-toggle")?.getAttribute("aria-expanded") === "false", null, "the Properties sheet put away so the face can be seen");
  await page.waitForTimeout(700); // the glide is about half a second
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const off = Math.hypot(...sub(cam.target, centre));
  assert.ok(off < 4, `the view looks at ${cam.target.map((x) => x.toFixed(1))}, ${off.toFixed(1)} mm from ${name}'s middle ${centre}`);
  const back = unit(sub(cam.position, cam.target));
  const angle = (Math.acos(Math.min(1, dot(back, toward))) * 180) / Math.PI;
  assert.ok(angle < 10, `the view looks ${angle.toFixed(1)}° off square onto ${name}`);
  // Framed round the face: the face's middle lands in the middle of the view.
  const s = await screenOf(page, centre);
  const box = await page.locator("#viewport canvas").boundingBox();
  assert.ok(Math.abs(s.x - (box.x + box.width / 2)) < box.width * 0.1 && Math.abs(s.y - (box.y + box.height / 2)) < box.height * 0.1, `${name}'s middle at ${s.x.toFixed(0)},${s.y.toFixed(0)} on screen`);
  // Lit, the face is a pale patch over the stress colours (a blue tint would vanish on the scale's blue end).
  const lit = await pixel(page, centre);
  assert.match(await page.getAttribute("[data-highlight]", "data-highlight"), /faces \d/, "still lit when its pixel was read");
  if (shots && shot) await page.screenshot({ path: `${shots}/${shot}` });
  // The light goes out after a moment and the camera stays.
  await until(page, () => /faces  ?edges/.test(document.querySelector("[data-highlight]")?.dataset.highlight ?? ""), null, `${name} no longer lit`, 4000);
  const still = await page.evaluate(() => window.fissionTest.camera());
  assert.deepEqual(still.target, cam.target);
  const after = await pixel(page, centre);
  const sum = (c) => c[0] + c[1] + c[2];
  assert.ok(Math.min(...lit.slice(0, 3)) > Math.min(...after.slice(0, 3)) + 40 && sum(lit) > sum(after) + 60, `${name} lit (${lit}) is not paler than after (${after})`);
  return cam;
}

/** The card is wholly on screen in the panel once scrolled to, and nothing in it runs off its side. */
async function cardInSight(page) {
  await page.locator(".testlab-results-card").scrollIntoViewIfNeeded();
  const box = await page.locator(".testlab-results-card").evaluate((c) => {
    const r = c.getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth, spill: c.scrollWidth - c.clientWidth };
  });
  assert.ok(box.left >= 0 && box.right <= box.width && box.spill <= 0, `the card on screen: ${JSON.stringify(box)}`);
}

/**
 * Ben's case (19 Nov): far past breaking. 1,000 kg on the box's top: about 200 times the 5 kg that gave a factor near
 * 100, so a factor near 0.5 or under: "Would break", where it would start to break in kg, and never the linear stress
 * or bend on the card (not real once broken); the details say so first.
 */
async function breaks(page, tap, shot) {
  await openPanel(page, "properties", tap);
  await page.fill(".testlab-page input[name=amount]", "1000");
  await page.press(".testlab-page input[name=amount]", "Enter");
  await until(page, () => document.querySelector(".testlab-page-load .testlab-page-words")?.textContent === "1,000 kg hanging (9,807 N) down on 1 face", null, "1,000 kg in words");
  if (tap) await page.tap("[data-testlab=run]");
  else await page.click("[data-testlab=run]");
  await until(page, () => document.querySelector(".testlab-results-verdict") !== null || /^Not run|^Stopped/.test(document.querySelector(".testlab-page-status")?.textContent ?? ""), null, "Run's result", 120000);
  assert.equal(await page.locator(".testlab-results-verdict").textContent(), "Would break");
  assert.equal(await page.getAttribute(".testlab-results-card", "data-band"), "fails");
  assert.match(await page.locator(".testlab-results-limit").textContent(), /^It would start to break at about [\d,.]+ kg\.$/);
  const card = await page.locator(".testlab-results-card").textContent();
  assert.doesNotMatch(card, /MPa|Bends at most/, card);
  assert.match(await page.locator(".testlab-results-broken").textContent(), /^Worked out as if the part stayed in one piece/);
  assert.equal(await page.locator(".testlab-results-broken").isVisible(), false, "behind How it was worked out");
  await cardInSight(page);
  await dotsExplained(page);
  if (shots) await page.locator(".testlab-results-card").screenshot({ path: `${shots}/${shot}` });
  if (shots) await page.screenshot({ path: `${shots}/${shot.replace("card", "page")}` });
}

try {
  await check("without ?testlab, Simulate is still the placeholder", async () => {
    const { context, page } = await newPage("?all-workspaces");
    await startWithBox(page);
    await toTestLab(page);
    assert.equal(await page.locator(".testlab-page").count(), 0);
    await context.close();
  });

  await check("1280 px: the box's front held and top pushed by 5 kg, Run shows the result; the box made taller keeps both and marks it out of date; a sphere loses both; Undo", async () => {
    const { context, page } = await newPage("?testlab&test-hooks");
    await startWithBox(page);
    await toTestLab(page);
    await setUpStudy(page, false);
    await page.click("[data-testlab=run]");
    await shownResult(page);
    assert.equal(await page.getAttribute(".testlab-page-state", "data-stale"), "false");
    if (shots) await page.screenshot({ path: `${shots}/testlab-1280.png` });
    if (shots) await page.locator(".testlab-results-card").screenshot({ path: `${shots}/testlab-card-holds-1280.png` });
    // The card's face names are buttons that show the face: the top from above, then the front from the front.
    const topCam = await showsFace(page, false, "Top face", [20, 15, 20], [0, 0, 1], "testlab-face-top-1280.png");
    const before = await showsFace(page, false, "Front face", [20, 0, 10], [0, -1, 0], "testlab-face-front-1280.png");
    // A press on the view while it glides stops it where it is (the person has taken the camera): Top face again, and a
    // press on the bare view (left of the card, checked to be the canvas) part way: it ends neither at the front nor the top.
    const canvas = await page.locator("#viewport canvas").boundingBox();
    const spot = { x: canvas.x + 300, y: canvas.y + canvas.height - 150 };
    assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [spot.x, spot.y]), "CANVAS");
    await page.locator(".testlab-results-card button[data-testlab-face]", { hasText: "Top face" }).first().click();
    await page.waitForTimeout(150);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(700);
    const stopped = await page.evaluate(() => window.fissionTest.camera());
    const backOf = (c) => unit(sub(c.position, c.target));
    const degrees = (a, b) => (Math.acos(Math.min(1, dot(backOf(a), backOf(b)))) * 180) / Math.PI;
    assert.ok(degrees(stopped, topCam) > 5, `a press stopped the glide: it went on to the top view (${degrees(stopped, topCam).toFixed(1)}° from it)`);
    assert.ok(degrees(stopped, before) > 5, `the glide had started (${degrees(stopped, before).toFixed(1)}° from the front view)`);
    // Under reduced motion there is no glide: the camera is square onto the face at once.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".testlab-results-card button[data-testlab-face]", { hasText: "Front face" }).first().click();
    const jumped = await page.evaluate(() => window.fissionTest.camera());
    assert.ok(degrees(jumped, before) < 0.5, `under reduced motion the view is at the front at once (${degrees(jumped, before).toFixed(1)}° off)`);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // Colour by Bend: the legend runs 0 mm to the biggest bend.
    await page.click("[data-testlab-by=bend]");
    await until(page, () => /^0 mm.* mm$/.test(document.querySelector(".testlab-results-legend")?.textContent ?? ""), null, "the bend's legend");
    assert.equal(await page.getAttribute("[data-testlab-by=bend]", "aria-pressed"), "true");
    assert.ok((await page.getAttribute("[data-colour-map]", "data-colour-map")) !== null);

    // Made 35 high in Design.
    await toDesign(page);
    await pinProperties(page);
    await page.fill("#height", "35");
    await page.press("#height", "Enter");
    await until(page, () => document.querySelector("#volume")?.textContent === "42,000 mm³", null, "the box 35 high"); // 40 × 30 × 35
    await toTestLab(page);
    await until(page, () => document.querySelector(".testlab-page-state")?.dataset.stale === "true", null, "out of date");
    const notes = await page.locator(".change-note .note-text").allTextContents();
    assert.ok(notes.some((n) => n === "Study 1 out of date: you changed the box in DesignLab. Rerun it in TestLab."), notes.join(" | "));
    await until(page, () => (document.querySelector(".testlab-page-status")?.textContent ?? "x") === "", null, "both faces found again");
    // The result kept, marked out of date, and the view the part as it is now.
    await until(page, () => document.querySelector(".testlab-results")?.dataset.stale === "true", null, "the result out of date");
    assert.equal(await page.locator(".testlab-results h3").textContent(), "Result (out of date)");
    assert.equal(await page.locator("[data-colour-map]").count(), 0, "no colour map on a changed part");
    // The top's paint at z = 35 (where it is now), and the plain body colour at z = 20 on the front, held, so painted too.
    const atTop = await pixel(page, [20, 15, 35]);
    const plainSide = await pixel(page, [40, 15, 17]); // the right side, neither held nor pushed
    assert.notDeepEqual(atTop, plainSide, `the top (${atTop}) is painted, unlike the right side (${plainSide})`);
    if (shots) await page.screenshot({ path: `${shots}/testlab-taller-1280.png` });

    // A sphere: both faces lost, said; Undo: found again.
    await toDesign(page);
    await chooseShape(page, "sphere");
    await until(page, () => !["", "—", "42,000 mm³"].includes(document.querySelector("#volume")?.textContent ?? ""), null, "the sphere built");
    await toTestLab(page);
    await saying(page, /Held here lost its face Front face: the last edit took it off the body\./, "the hold's face lost");
    assert.match(await status(page), /Load 1 lost its face Top face: the last edit took it off the body\./);
    if (shots) await page.screenshot({ path: `${shots}/testlab-lost-1280.png` });
    await page.click("#undo");
    await until(page, () => (document.querySelector(".testlab-page-status")?.textContent ?? "x") === "", null, "found again after Undo");
    await context.close();
  });

  await check("375 px with taps: picking puts the sheet away, the faces are tapped, nothing runs off the side", async () => {
    const { context, page, tap } = await newPage("?testlab&test-hooks", 375);
    await startWithBox(page, true);
    await toTestLab(page);
    await setUpStudy(page, tap);
    await page.tap("[data-testlab=run]");
    await shownResult(page);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 375, `the page is ${wide} px wide`);
    if (shots) await page.screenshot({ path: `${shots}/testlab-375.png` });
    // With a finger: the card's Front face button puts the sheet away and turns the view to the front.
    await openPanel(page, "properties", tap);
    await page.locator(".testlab-results-card").scrollIntoViewIfNeeded();
    await showsFace(page, tap, "Front face", [20, 0, 10], [0, -1, 0], "testlab-face-front-375.png");
    await breaks(page, tap, "testlab-card-breaks-375.png");
    await context.close();
  });

  await check("1280 px: 1,000 kg on the box says Would break, with no stress or bend past breaking on the card", async () => {
    const { context, page, tap } = await newPage("?testlab&test-hooks");
    await startWithBox(page);
    await toTestLab(page);
    await setUpStudy(page, tap);
    await breaks(page, tap, "testlab-card-breaks-1280.png");
  });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) process.exit(1);
