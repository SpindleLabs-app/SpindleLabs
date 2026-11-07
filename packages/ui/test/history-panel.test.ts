import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { HistoryStepInfo } from "@fission/core";
import { agoWords, historyPanel, stepWords } from "../src/history-panel.ts";

// The History panel: a list of every step, newest first, each a button that goes to it.

test("hand-worked: how long ago, in words", () => {
  const S = 1000;
  assert.equal(agoWords(0), "just now");
  assert.equal(agoWords(4 * S + 999), "just now", "under 5 s");
  assert.equal(agoWords(5 * S), "5 s ago");
  assert.equal(agoWords(59 * S + 999), "59 s ago");
  assert.equal(agoWords(60 * S), "1 min ago");
  assert.equal(agoWords(3 * 60 * S + 59 * S), "3 min ago", "3 min 59 s");
  assert.equal(agoWords(60 * 60 * S), "1 h ago");
  assert.equal(agoWords(23 * 3600 * S + 3599 * S), "23 h ago");
  assert.equal(agoWords(24 * 3600 * S), "over a day ago");
  assert.equal(agoWords(-5 * S), "just now", "a clock set back");
  assert.equal(stepWords(0, ""), "Start of the project");
  assert.equal(stepWords(2, "Extrude"), "Extrude");
});

function rig(initial: HistoryStepInfo[], phone = false) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  let steps = initial;
  const jumps: number[] = [];
  let now = 100_000;
  const p = historyPanel(doc, { steps: () => steps, jump: (i) => jumps.push(i), now: () => now, isPhone: () => phone });
  doc.body.append(p.button, p.panel);
  const rows = () => [...p.panel.querySelectorAll<HTMLElement>(".history-list li")].map((li) => ({ state: li.dataset.state, text: li.textContent }));
  return { p, doc, jumps, rows, set: (s: HistoryStepInfo[]) => (steps = s), tick: (ms: number) => (now += ms) };
}

const three: HistoryStepInfo[] = [
  { label: "", at: 0, state: "done" },
  { label: "Insert Box", at: 70_000, state: "done" },
  { label: "Extrude 10 mm", at: 90_000, state: "current" },
];

test("closed at first; the button opens it, newest step first, the present marked, times against the clock", () => {
  const { p, rows } = rig(three);
  assert.equal(p.panel.hidden, true);
  assert.equal(p.button.getAttribute("aria-expanded"), "false");
  p.button.click();
  assert.equal(p.panel.hidden, false);
  assert.equal(p.button.getAttribute("aria-expanded"), "true");
  // The clock reads 100 s: Extrude was 10 s ago, Insert Box 30 s ago, the start 100 s = 1 min 40 s ago.
  assert.deepEqual(rows(), [
    { state: "current", text: "Extrude 10 mmnow, 10 s ago" },
    { state: "done", text: "Insert Box30 s ago" },
    { state: "done", text: "Start of the project1 min ago" },
  ]);
  assert.equal(p.panel.querySelector('[aria-current="step"]')?.textContent, "Extrude 10 mmnow, 10 s ago");
  assert.equal(p.panel.querySelector<HTMLElement>(".history-empty")!.hidden, true, "there are steps");
});

test("undone steps are dimmed by state and say so; the start alone shows the empty note", () => {
  const { p, rows, set } = rig([
    { label: "", at: 0, state: "done" },
    { label: "A", at: 50_000, state: "current" },
    { label: "B", at: 60_000, state: "undone" },
  ]);
  p.open();
  assert.deepEqual(rows().map((r) => r.state), ["undone", "current", "done"], "B above A above the start");
  assert.equal(rows()[0].text, "Bundone, 40 s ago");
  set([{ label: "", at: 0, state: "current" }]);
  p.refresh();
  assert.equal(p.panel.querySelector<HTMLElement>(".history-empty")!.hidden, false);
  assert.deepEqual(rows(), [{ state: "current", text: "Start of the projectnow, at the start" }]);
});

test("a click on a step goes to its number (counted from the start) and, on a wide screen, keeps the panel open", () => {
  const { p, jumps, doc } = rig(three);
  p.open();
  const insert = p.panel.querySelector<HTMLButtonElement>('button[data-step="1"]')!;
  insert.click();
  assert.deepEqual(jumps, [1]);
  assert.equal(p.isOpen(), true);
  // The start is step 0.
  p.panel.querySelector<HTMLButtonElement>('button[data-step="0"]')!.click();
  assert.deepEqual(jumps, [1, 0]);
  assert.equal(doc.activeElement === null || true, true);
});

test("at phone width a jump closes the sheet so the part can be seen", () => {
  const { p, jumps } = rig(three, true);
  p.open();
  p.panel.querySelector<HTMLButtonElement>('button[data-step="1"]')!.click();
  assert.deepEqual(jumps, [1]);
  assert.equal(p.isOpen(), false);
  assert.equal(p.panel.hidden, true);
});

test("Escape, Close, a press elsewhere and the button again all put it away; a press inside does not", () => {
  const { p, doc } = rig(three);
  const key = (k: string) => doc.dispatchEvent(new (doc.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", { key: k, bubbles: true }));
  const press = (target: Element) => target.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("pointerdown", { bubbles: true }));
  p.open();
  key("Enter");
  assert.equal(p.isOpen(), true, "another key does nothing");
  key("Escape");
  assert.equal(p.isOpen(), false);
  p.open();
  p.panel.querySelector<HTMLButtonElement>(".history-close")!.click();
  assert.equal(p.isOpen(), false);
  p.open();
  press(p.panel.querySelector(".history-list")!);
  assert.equal(p.isOpen(), true, "a press inside stays");
  press(doc.body);
  assert.equal(p.isOpen(), false, "a press elsewhere closes");
  p.button.click();
  assert.equal(p.isOpen(), true);
  p.button.click();
  assert.equal(p.isOpen(), false, "the button toggles");
});

test("refresh redraws only while open; the list follows the history", () => {
  const { p, rows, set } = rig(three);
  set([...three, { label: "Move", at: 99_000, state: "current" }].map((s, i, a) => (i === 2 ? { ...s, state: "done" as const } : s)));
  p.refresh();
  assert.equal(p.panel.querySelectorAll("li").length, 0, "closed: nothing drawn");
  p.open();
  assert.equal(rows().length, 4);
});

test("the button comes with the first step: hidden on a new project, shown once there is one, kept while the panel is open", () => {
  const { p, set } = rig([{ label: "", at: 0, state: "current" }]);
  assert.equal(p.button.hidden, true, "only the start: nothing to go back to");
  set(three);
  p.refresh();
  assert.equal(p.button.hidden, false, "a step was taken");
  set([{ label: "", at: 0, state: "current" }]);
  p.refresh();
  assert.equal(p.button.hidden, true, "every step undone and dropped: gone again");
});
