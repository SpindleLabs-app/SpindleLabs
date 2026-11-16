// The home screen background's motion choice (Ben, 2026-11-16: full motion even on a computer set to show less motion, as
// an option; then "make pause/play just a arrow/pause symbol so its smaller, move the guide to a little book next to it and
// maybe gentler motion only pop up as a suggestion if its laggy or a settings option"): the guide's book and Pause or Play
// under the list, the gentle motion suggestion only where drawing has been too slow, and Settings > General's row, in a
// real DOM (happy-dom) with a stand-in drawing context. The real app in Chromium: apps/fission/e2e/home-backdrop.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { homeScreen, type HomeParts } from "../src/home-screen.ts";
import { fillSettings, MOTION_ROWS } from "../src/settings.ts";
import { SLOW_MS, SLOW_WINDOW, WARM_FRAMES, type MotionChoice } from "../src/home-backdrop.ts";

const { Window } = await import("happy-dom");
const settle = () => new Promise((r) => setTimeout(r, 20));
/** Every screen made, hidden at the end even when a check fails (an open screen's picture keeps a timer going). */
const opened: { hide(): void }[] = [];
after(() => opened.forEach((h) => h.hide()));

/**
 * The screen over one kept project, on a computer that asks for less motion when `reduce`; `stored` is the kept choice.
 * Frames come only when `frames(n)` runs them, each 60 ms apart on a clock of its own, every drawing taking `cost` ms.
 */
async function screen(opts: { reduce?: boolean; stored?: unknown; canvas?: boolean; keepThrows?: boolean; cost?: number } = {}) {
  const window = new Window();
  const win = window as unknown as Window & typeof globalThis;
  let clock = 0;
  let frame: ((t: number) => void) | null = null;
  // A drawing context that draws nothing (happy-dom has none) but takes `cost` ms on the clock to clear.
  const ctx = new Proxy({}, { get: (_t, k) => (k === "clearRect" ? () => void (clock += opts.cost ?? 2) : String(k).startsWith("create") ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  // (happy-dom shares the canvas class between windows, so it is set every time.)
  (window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => (opts.canvas === false ? null : ctx);
  Object.assign(win, {
    matchMedia: (q: string) => ({ matches: q.includes("reduced-motion") && (opts.reduce ?? false), addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (f: (t: number) => void) => ((frame = f), 1),
    cancelAnimationFrame: () => void (frame = null),
  });
  Object.defineProperty(win, "performance", { configurable: true, value: { now: () => clock } });
  const doc = window.document as unknown as Document;
  const kept: MotionChoice[] = [];
  const parts: HomeParts = {
    list: async () => [{ id: "g", name: "Gear Box", modified: new Date(0) }],
    openId: () => "g",
    open: async () => {},
    remove: async () => {},
    rename: async () => {},
    newProject: () => {},
    chooseFile: () => {},
    showGuide: () => {},
    workspaceTitle: (id) => id,
    motion: {
      read: () => opts.stored ?? null,
      keep: (c) => {
        kept.push(c);
        if (opts.keepThrows) throw new Error("storage is full");
      },
    },
  };
  const home = homeScreen(doc, parts);
  opened.push(home);
  await home.show();
  await settle();
  const q = <T extends HTMLElement>(s: string) => doc.querySelector(s) as unknown as T;
  const canvas = q<HTMLCanvasElement>(".home-backdrop");
  const pause = q<HTMLButtonElement>("#home-motion");
  const guide = q<HTMLButtonElement>("#home-guide");
  const tip = q<HTMLElement>("#home-motion-tip");
  /** What a button is called (its accessible name: icons only on the screen). */
  const name = (b: HTMLElement) => b.getAttribute("aria-label");
  const frames = (n: number) => {
    for (let k = 0; k < n && frame; k++) {
      clock += 60;
      frame(clock);
    }
  };
  return { home, canvas, pause, guide, tip, kept, name, doc, frames, q };
}

test("small icons under the list: the guide as a book and Pause the background beside it, each named for screen readers and the tooltip", async () => {
  const s = await screen();
  assert.equal(s.canvas.dataset.backdrop, "live");
  assert.equal(s.canvas.dataset.motion, "full");
  for (const [b, icon, name] of [[s.guide, "guide", "How SpindleLabs works (the guide)"], [s.pause, "pause", "Pause the background"]] as const) {
    assert.equal(b.hidden, false);
    assert.equal(b.textContent, ""); // no words on the screen: the icon only
    assert.equal(b.querySelector("svg")?.dataset.icon, icon);
    assert.equal(s.name(b), name);
    assert.equal(b.title, name);
  }
  assert.deepEqual([...s.q(".home-links").children].map((c) => c.id), ["home-guide", "home-motion", "home-motion-tip"]);
  assert.equal(s.doc.querySelector("#home-full-motion"), null); // full and gentle motion are Settings' choices
  assert.equal(s.tip.hidden, true); // nothing slow: no suggestion
  s.home.hide();
});

test("Pause keeps one still picture and Play moves it again as before, each kept; under reduced motion it moves gently and Play brings that back", async () => {
  const s = await screen();
  s.pause.click();
  assert.equal(s.canvas.dataset.backdrop, "still");
  assert.equal(s.canvas.dataset.still, "paused");
  assert.equal(s.name(s.pause), "Play the background");
  assert.equal(s.pause.querySelector("svg")?.dataset.icon, "play");
  s.pause.click();
  assert.equal(s.canvas.dataset.backdrop, "live");
  assert.equal(s.canvas.dataset.motion, "full");
  assert.equal(s.name(s.pause), "Pause the background");
  assert.deepEqual(s.kept, ["still", "full"]);
  s.home.hide();
  const calm = await screen({ reduce: true });
  assert.equal(calm.canvas.dataset.motion, "gentle");
  calm.pause.click();
  calm.pause.click();
  assert.equal(calm.canvas.dataset.motion, "gentle"); // never the full picture unasked
  assert.deepEqual(calm.kept, ["still", "gentle"]);
  calm.home.hide();
  // Full chosen in Settings, under reduced motion: the full picture, and Play after Pause brings it back.
  const full = await screen({ reduce: true, stored: "full" });
  assert.equal(full.canvas.dataset.motion, "full");
  full.pause.click();
  full.pause.click();
  assert.equal(full.canvas.dataset.motion, "full");
  full.home.hide();
});

test("gentle motion is suggested only once drawing the picture has been too slow here; taking it moves gently and keeps it, Not now hides it", async () => {
  // Frames costing 2 ms (under SLOW_MS) for a warm-up and two timed windows: no suggestion.
  const quick = await screen({ cost: 2 });
  quick.frames(WARM_FRAMES + 2 * SLOW_WINDOW);
  assert.equal(quick.tip.hidden, true);
  quick.home.hide();
  // Frames costing 20 ms, over SLOW_MS (14): after the warm-up and one timed window it steps down, and suggests.
  assert.ok(20 > SLOW_MS);
  const slow = await screen({ cost: 20 });
  slow.frames(WARM_FRAMES + SLOW_WINDOW - 1);
  assert.equal(slow.tip.hidden, true); // one frame short of a whole window: not yet
  slow.frames(1);
  assert.equal(slow.canvas.dataset.quality, "1");
  assert.equal(slow.tip.hidden, false);
  assert.match(slow.tip.textContent!, /slowing this computer down/);
  slow.q<HTMLButtonElement>("#home-gentle").click();
  assert.equal(slow.canvas.dataset.motion, "gentle");
  assert.equal(slow.tip.hidden, true);
  assert.deepEqual(slow.kept, ["gentle"]);
  slow.home.hide();
  // Not now: hidden, and not shown again while the page is open.
  const no = await screen({ cost: 20 });
  no.frames(WARM_FRAMES + SLOW_WINDOW);
  assert.equal(no.tip.hidden, false);
  no.q<HTMLButtonElement>("#home-gentle-no").click();
  assert.equal(no.tip.hidden, true);
  no.frames(WARM_FRAMES + SLOW_WINDOW);
  assert.equal(no.tip.hidden, true);
  assert.deepEqual(no.kept, []);
  no.home.hide();
  // Already gentle (the computer asks for less motion) or paused: nothing to suggest, however slow.
  const calm = await screen({ cost: 20, reduce: true });
  calm.frames(WARM_FRAMES + SLOW_WINDOW);
  assert.equal(calm.tip.hidden, true);
  calm.home.hide();
});

test("the kept choice is read each time the screen shows; a damaged one follows the computer; a refused keep still holds", async () => {
  const still = await screen({ stored: "still" });
  assert.equal(still.canvas.dataset.backdrop, "still");
  assert.equal(still.name(still.pause), "Play the background");
  still.home.hide();
  const damaged = await screen({ reduce: true, stored: "sideways" });
  assert.equal(damaged.canvas.dataset.motion, "gentle");
  damaged.home.hide();
  const refused = await screen({ keepThrows: true });
  assert.doesNotThrow(() => refused.pause.click());
  assert.equal(refused.canvas.dataset.backdrop, "still");
  refused.home.hide();
});

test("where the picture can't be drawn (no 2D canvas) there is nothing to pause: no Pause, no suggestion; the guide stays", async () => {
  const s = await screen({ canvas: false });
  assert.equal(s.canvas.dataset.backdrop, "off");
  assert.equal(s.pause.hidden, true);
  assert.equal(s.tip.hidden, true);
  assert.equal(s.guide.hidden, false);
  s.home.hide();
});

test("Settings > General: Home screen background, Auto, Full, Gentle or Still, the chosen one's sentence under it", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const dialog = doc.createElement("dialog") as HTMLDialogElement;
  doc.body.append(dialog);
  const picked: MotionChoice[] = [];
  fillSettings(dialog, { version: "", onShortcuts: () => {}, motion: "system", onMotion: (c) => picked.push(c) });
  const radio = (id: string) => dialog.querySelector<HTMLElement>(`[data-section=general] [data-motion=${id}]`)!;
  assert.deepEqual([...dialog.querySelectorAll("[data-motion]")].map((b) => b.textContent), ["Auto", "Full", "Gentle", "Still"]);
  assert.equal(radio("system").getAttribute("aria-checked"), "true");
  assert.equal(radio("full").getAttribute("aria-checked"), "false");
  const summary = () => dialog.querySelector(".settings-motion-summary")!.textContent;
  assert.equal(summary(), MOTION_ROWS[0].summary);
  assert.match(summary()!, /gentle motion when it is set to show less motion/);
  radio("full").click();
  assert.deepEqual(picked, ["full"]);
  assert.equal(radio("full").getAttribute("aria-checked"), "true");
  assert.equal(radio("system").getAttribute("aria-checked"), "false");
  assert.match(summary()!, /even when this computer is set to show less motion/);
  // Without the parts (the home screen not built), no row is drawn: nothing pretends.
  fillSettings(dialog, { version: "", onShortcuts: () => {} });
  assert.equal(dialog.querySelector("[data-motion]"), null);
});
