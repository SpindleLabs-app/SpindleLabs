// The home screen background's motion choice (Ben, 2026-11-16: full motion even on a computer set to show less motion, as
// an option): the screen's Pause, Play, Full motion and Gentle motion beside the picture, and Settings > General's row,
// in a real DOM (happy-dom) with a stand-in drawing context. The real app in Chromium: apps/fission/e2e/home-backdrop.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { homeScreen, type HomeParts } from "../src/home-screen.ts";
import { fillSettings, MOTION_ROWS } from "../src/settings.ts";
import type { MotionChoice } from "../src/home-backdrop.ts";

const { Window } = await import("happy-dom");
const settle = () => new Promise((r) => setTimeout(r, 20));
/** Every screen made, hidden at the end even when a check fails (an open screen's picture keeps a timer going). */
const opened: { hide(): void }[] = [];
after(() => opened.forEach((h) => h.hide()));

/** The screen over one kept project, on a computer that asks for less motion when `reduce`; `stored` is the kept choice. */
async function screen(opts: { reduce?: boolean; stored?: unknown; canvas?: boolean; keepThrows?: boolean } = {}) {
  const window = new Window();
  const win = window as unknown as Window & typeof globalThis;
  // A drawing context that draws nothing (happy-dom has none), and no real frames: the picture is up, its loop stands still.
  const ctx = new Proxy({}, { get: (_t, k) => (String(k).startsWith("create") ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  // (happy-dom shares the canvas class between windows, so it is set every time.)
  (window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => (opts.canvas === false ? null : ctx);
  Object.assign(win, {
    matchMedia: (q: string) => ({ matches: q.includes("reduced-motion") && (opts.reduce ?? false), addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
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
  const full = q<HTMLButtonElement>("#home-full-motion");
  const words = (b: HTMLElement) => b.textContent?.trim();
  return { home, canvas, pause, full, kept, words, doc };
}

test("a computer that asks for nothing: Pause the background beside the guide; Pause keeps one still picture, Play moves it fully again", async () => {
  const s = await screen();
  assert.equal(s.canvas.dataset.backdrop, "live");
  assert.equal(s.canvas.dataset.motion, "full");
  assert.equal(s.pause.hidden, false);
  assert.equal(s.words(s.pause), "Pause the background");
  assert.equal(s.pause.querySelector("svg")?.dataset.icon, "pause");
  assert.equal(s.full.hidden, true); // full motion, and the computer asks for nothing else: no second link
  s.pause.click();
  assert.equal(s.canvas.dataset.backdrop, "still");
  assert.equal(s.canvas.dataset.still, "paused");
  assert.equal(s.words(s.pause), "Play the background");
  assert.equal(s.pause.querySelector("svg")?.dataset.icon, "play");
  s.pause.click();
  assert.equal(s.canvas.dataset.backdrop, "live");
  assert.equal(s.canvas.dataset.motion, "full");
  assert.deepEqual(s.kept, ["still", "full"]); // each press kept
  s.home.hide();
  assert.equal(s.pause.hidden, true); // closed: the picture is off, so are its controls
});

test("a computer set to show less motion: it moves gently, and Full motion gives the full picture until Gentle motion (Ben, 2026-11-16)", async () => {
  const s = await screen({ reduce: true });
  assert.equal(s.canvas.dataset.backdrop, "live");
  assert.equal(s.canvas.dataset.motion, "gentle");
  assert.equal(s.words(s.pause), "Pause the background");
  assert.equal(s.full.hidden, false);
  assert.equal(s.words(s.full), "Full motion");
  s.full.click();
  assert.equal(s.canvas.dataset.motion, "full");
  assert.equal(s.words(s.full), "Gentle motion");
  s.full.click();
  assert.equal(s.canvas.dataset.motion, "gentle");
  // Paused, then played: gently again (as the computer asks), never the full picture unasked.
  s.pause.click();
  assert.equal(s.canvas.dataset.backdrop, "still");
  assert.equal(s.full.hidden, true); // still: nothing to make full or gentle
  s.pause.click();
  assert.equal(s.canvas.dataset.motion, "gentle");
  assert.deepEqual(s.kept, ["full", "system", "still", "gentle"]);
  // Full, paused, played: full again.
  s.full.click();
  s.pause.click();
  s.pause.click();
  assert.equal(s.canvas.dataset.motion, "full");
  assert.deepEqual(s.kept.slice(4), ["full", "still", "full"]);
  s.home.hide();
});

test("the kept choice is read each time the screen shows; a damaged one follows the computer; a refused keep still holds", async () => {
  const still = await screen({ stored: "still" });
  assert.equal(still.canvas.dataset.backdrop, "still");
  assert.equal(still.words(still.pause), "Play the background");
  still.home.hide();
  const full = await screen({ reduce: true, stored: "full" });
  assert.equal(full.canvas.dataset.motion, "full");
  assert.equal(full.words(full.full), "Gentle motion");
  full.home.hide();
  const damaged = await screen({ reduce: true, stored: "sideways" });
  assert.equal(damaged.canvas.dataset.motion, "gentle");
  damaged.home.hide();
  const refused = await screen({ keepThrows: true });
  assert.doesNotThrow(() => refused.pause.click());
  assert.equal(refused.canvas.dataset.backdrop, "still");
  refused.home.hide();
});

test("where the picture can't be drawn (no 2D canvas) there is nothing to pause, so no controls", async () => {
  const s = await screen({ canvas: false });
  assert.equal(s.canvas.dataset.backdrop, "off");
  assert.equal(s.pause.hidden, true);
  assert.equal(s.full.hidden, true);
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
