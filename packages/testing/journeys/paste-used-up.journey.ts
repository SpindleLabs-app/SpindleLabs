// App bug hunt 11-18 B-4 (SL #820): Box 2 copied (Ctrl+C), then a Combine cuts Box 2 from Box 1 and uses it up, then
// Ctrl+V added "Copy 1", red from the start ("can't copy Box 2: an earlier Combine used it up"), as an undo step that only
// adds a broken item. A used-up body pastes nothing, as a deleted one does (undo-stale.journey.ts), pressed fast or slowly
// after the Combine's OK; a body still built pastes as before. On the real kernel, in the app around Design.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

setCombineShown(true);
const body = (id: string) => ({ kind: "body" as const, id }) as never;

/**
 * Box 1 a 10 × 4 × 2 bar (x 0..10, y 0..4, z 0..2); Box 2 a 2 × 6 × 4 slot moved to x 4..6, y −1..5, z −1..3, right
 * through the bar's middle; Box 3 a 2 mm cube at y 10..12, clear of both.
 */
function start(): DesignDocument {
  let doc = partDocument("box", 10, 4, 2);
  const b = insertPreset(doc, "box", 2, 6, 4);
  doc = insertMove(b.doc, [`body:${b.id}`], { ...NO_MOVE, x: 4, y: -1, z: -1 }).doc;
  const c = insertPreset(doc, "box", 2, 2, 2);
  return insertMove(c.doc, [`body:${c.id}`], { ...NO_MOVE, y: 10 }).doc;
}

function clipboard() {
  const held = { text: "" };
  return { setData: (_: string, t: string) => void (held.text = t), getData: () => held.text, files: [] };
}

/** `copied` copied, Combine: Cut Box 2 from Box 1, OK, then Ctrl+V at once (fast) or once the OK is through (slow). */
async function pasteAfterCut(copied: string, slow: boolean) {
  const a = await app(start(), designWorkspace);
  a.selection.set([body(copied)]);
  await a.settle();
  const e = { clipboardData: clipboard() } as unknown as Event;
  assert.equal(await a.key("copy-svg", e), true, "Ctrl+C copies the picked body");
  a.selection.clear();
  await a.settle();
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
  a.selection.set([body("body:feature-1"), body("body:feature-2")]);
  await a.settle();
  const op = a.$("#combine-operation") as HTMLSelectElement;
  op.value = "cut";
  op.dispatchEvent(new a.window.Event("change") as never);
  (a.$("#combine-ok") as HTMLButtonElement).click();
  if (slow) for (let i = 0; i < 5; i++) await a.settle();
  await a.key("paste-bodies", e);
  for (let i = 0; i < 5; i++) await a.settle();
  const labels = a.doc().timeline.features.map((f) => f.provenance.self.label);
  const red = [...a.window.document.querySelectorAll<HTMLElement>(".timeline-bar-item[data-failed]")].map((l) => l.dataset.item);
  await a.close();
  return { labels, red };
}

// Box 1, Box 2, its Move, Box 3, its Move and Combine 1: six items; a paste adds a seventh.
const AFTER_CUT = 6;

for (const slow of [false, true]) {
  test(`a body a Combine used up since it was copied pastes nothing, pressed ${slow ? "slowly" : "at once"} after the OK (SL #820 B-4)`, async () => {
    const used = await pasteAfterCut("body:feature-2", slow);
    assert.equal(used.labels.length, AFTER_CUT, `nothing added: ${used.labels.join(", ")}`);
    assert.deepEqual(used.red, [], "nothing red");
    // Control: Box 3, untouched by the Combine, still pastes as one more item, built.
    const kept = await pasteAfterCut("body:feature-4", slow);
    assert.equal(kept.labels.length, AFTER_CUT + 1, `the copy added: ${kept.labels.join(", ")}`);
    assert.deepEqual(kept.red, [], "the copy builds");
  });
}
