// The print log dialog (print-log.ts): the amounts in words worked out by hand, and the dialog in a real DOM
// (happy-dom): rows newest first, the three results, what went wrong only when failed, a note kept on leaving the
// box and never lost to a redraw, Delete asking first, a change that can't be kept said. The real app:
// apps/fission/e2e/print-log.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountWords, NO_PRINTS, PRINT_NOT_KEPT, printLogDialog, type PrintLogParts, type PrintLogRow } from "../src/print-log.ts";

const { Window } = await import("happy-dom");

const NOW = new Date(Date.UTC(2026, 10, 13, 12, 0, 0));
const H = 3600_000;

test("hand-worked: weight and time in words", () => {
  assert.equal(amountWords(12.3, 81), "About 12.3 g, 1 h 21 min");
  assert.equal(amountWords(12, 120), "About 12 g, 2 h", "a whole number of grams shows no .0; whole hours no minutes");
  assert.equal(amountWords(0.04, 0), "About under 0.1 g, under a minute");
  assert.equal(amountWords(null, 59), "About 59 min");
  assert.equal(amountWords(3.25, null), "About 3.3 g", "toFixed(1) of 3.25 gives 3.3 here (3.25 is exact in binary, rounds half up)");
  assert.equal(amountWords(null, null), "");
});

function page(fail = false) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  let prints: PrintLogRow[] = [
    { id: "p2", name: "Bracket", madeAt: new Date(NOW.getTime() - 2 * H), settings: "0.2 mm layers", grams: 12.3, minutes: 81, result: "waiting", problem: null, note: "", },
    { id: "p1", name: "Box", madeAt: new Date(NOW.getTime() - 30 * H), settings: "0.28 mm layers", grams: null, minutes: null, result: "well", problem: null, note: "Fine", },
  ];
  const calls: string[] = [];
  const parts: PrintLogParts = {
    list: () => prints,
    summary: () => `${prints.length} prints`,
    problems: [{ id: "warped", words: "Corners lifted or warped" }, { id: "other", words: "Something else" }],
    change(id, change) {
      calls.push(`change ${id} ${JSON.stringify(change)}`);
      if (fail) return false;
      prints = prints.map((p) => (p.id === id ? { ...p, ...change, problem: (change.result ?? p.result) === "failed" ? (change.problem !== undefined ? change.problem : p.problem) : null } : p));
      return true;
    },
    remove(id) {
      calls.push(`remove ${id}`);
      prints = prints.filter((p) => p.id !== id);
      return true;
    },
    noteMax: 500,
    now: () => NOW,
  };
  const dialog = printLogDialog(doc, parts);
  const row = (id: string) => doc.querySelector<HTMLLIElement>(`#print-log-items .print-log-item[data-id="${id}"]`)!;
  const pressed = (id: string) => [...row(id).querySelectorAll(".print-log-result")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { doc, dialog, calls, row, pressed, settle, set: (p: PrintLogRow[]) => (prints = p) };
}

test("the rows, newest first, each with its words and its result pressed", () => {
  const { dialog, doc, row, pressed } = page();
  dialog.show();
  assert.equal(dialog.open, true);
  assert.deepEqual([...doc.querySelectorAll<HTMLLIElement>(".print-log-item")].map((r) => r.dataset.id), ["p2", "p1"]);
  assert.equal(row("p2").querySelector(".print-log-when")!.textContent, "Saved 2 hours ago");
  assert.equal(row("p2").querySelector(".print-log-amount")!.textContent, "About 12.3 g, 1 h 21 min");
  assert.equal(row("p1").querySelector(".print-log-amount"), null, "no weight or time: no line");
  assert.deepEqual(pressed("p2"), ["Not said"]);
  assert.deepEqual(pressed("p1"), ["Printed well"]);
  assert.equal(row("p2").querySelector(".print-log-problem"), null, "what went wrong only once it failed");
  assert.equal(row("p1").querySelector<HTMLTextAreaElement>(".print-log-note-box")!.value, "Fine");
  assert.equal(doc.getElementById("print-log-summary")!.textContent, "2 prints");
});

test("Failed shows what went wrong; a pick and a note are kept when left", () => {
  const { dialog, row, pressed, calls } = page();
  dialog.show();
  row("p2").querySelector<HTMLButtonElement>(".print-log-failed")!.click();
  assert.deepEqual(pressed("p2"), ["Failed"]);
  assert.equal(row("p2").dataset.result, "failed");
  const problem = row("p2").querySelector<HTMLSelectElement>(".print-log-problem")!;
  assert.deepEqual([...problem.options].map((o) => o.textContent), ["What went wrong?", "Corners lifted or warped", "Something else"]);
  problem.value = "warped";
  problem.dispatchEvent(new (problem.ownerDocument.defaultView as unknown as typeof globalThis).Event("change"));
  const note = row("p2").querySelector<HTMLTextAreaElement>(".print-log-note-box")!;
  assert.equal(note.maxLength, 500);
  note.value = "Lifted at the corner";
  note.dispatchEvent(new (note.ownerDocument.defaultView as unknown as typeof globalThis).Event("change"));
  assert.deepEqual(calls, ['change p2 {"result":"failed"}', 'change p2 {"problem":"warped"}', 'change p2 {"note":"Lifted at the corner"}']);
  // Pressing the result already pressed asks nothing.
  row("p2").querySelector<HTMLButtonElement>(".print-log-failed")!.click();
  assert.equal(calls.length, 3);
  row("p2").querySelector<HTMLButtonElement>(".print-log-well")!.click();
  assert.equal(row("p2").querySelector(".print-log-problem"), null, "printed well: the list goes");
});

test("a redraw while a note is typed waits until the box is left, so nothing typed is lost", async () => {
  const { dialog, row, doc, set, settle } = page();
  dialog.show();
  const note = row("p1").querySelector<HTMLTextAreaElement>(".print-log-note-box")!;
  note.focus();
  note.value = "Fine, but stringy";
  set([{ id: "p3", name: "New one", madeAt: NOW, settings: "", grams: null, minutes: null, result: "waiting", problem: null, note: "" }]);
  dialog.refresh();
  assert.equal(row("p1").querySelector<HTMLTextAreaElement>(".print-log-note-box")!.value, "Fine, but stringy", "still the box being typed in");
  (doc.getElementById("print-log-close") as HTMLButtonElement).focus();
  await settle();
  assert.ok(row("p3"), "drawn again once left");
});

test("Delete asks in the row; Keep it keeps it", () => {
  const { dialog, row, calls, doc } = page();
  dialog.show();
  row("p1").querySelector<HTMLButtonElement>(".print-log-delete")!.click();
  assert.match(row("p1").querySelector(".print-log-question")!.textContent!, /Delete this print of “Box”/);
  assert.equal(doc.activeElement?.textContent, "Keep it", "the safe choice has the focus");
  row("p1").querySelector<HTMLButtonElement>(".print-log-keep")!.click();
  assert.deepEqual(calls, []);
  row("p1").querySelector<HTMLButtonElement>(".print-log-delete")!.click();
  row("p1").querySelector<HTMLButtonElement>(".print-log-delete-sure")!.click();
  assert.deepEqual(calls, ["remove p1"]);
  assert.equal(doc.querySelector('.print-log-item[data-id="p1"]'), null);
});

test("a change that can't be kept is said; an empty log says how prints get there", () => {
  const { dialog, row, doc, set } = page(true);
  dialog.show();
  row("p2").querySelector<HTMLButtonElement>(".print-log-well")!.click();
  assert.equal(doc.getElementById("print-log-status")!.textContent, PRINT_NOT_KEPT);
  assert.ok(doc.getElementById("print-log-status")!.classList.contains("bad"));
  set([]);
  dialog.show();
  assert.equal(doc.getElementById("print-log-summary")!.textContent, NO_PRINTS);
  assert.equal(doc.getElementById("print-log-status")!.textContent, "", "opening again clears the old words");
});
