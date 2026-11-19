// SL #764 item 3 (E-2, app-wide hunt 2026-11-14): after an export whose
// solid check could not run (the kernel's time limit on a slow device, a
// kernel that had to restart), the card of the export BEFORE it stayed up
// saying "Checked solid", right under the note that the check could not
// run. The file just saved is not known to be solid (actions.ts: a check
// that can't run never says solid), so no card may say so. The check is
// made to fail by failing the export's own check_solid call in the real
// kernel (T6b's fault injection); STL, 3MF and OBJ alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry } from "@fission/core";
import { insertMove, insertPreset, NO_MOVE, partDocument, registerDesignActions } from "@fission/design";
import { registerMeshActions } from "../../../workspaces/design/src/mesh-export.ts";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const saved: string[] = [];

/** The export card's words, or null when it is not shown. */
const card = (a: App) => {
  const c = a.window.document.querySelector("#solid-badge") as HTMLElement | null;
  return c && !c.hidden ? (c.textContent ?? "").replace(/\s+/g, " ").trim() : null;
};

async function exportAs(a: App, kind: "stl" | "3mf" | "obj") {
  saved.length = 0;
  if (kind === "stl") await a.command({ op: "export_stl" });
  else {
    a.$(`#export-choice-${kind}`)!.click();
    await a.settle();
  }
}

/** Box 1 (40 × 30 × 20) and Box 2 (a 10 mm cube moved 100 along x): two bodies apart, both solid. */
async function twoBoxes(): Promise<App> {
  const made = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10);
  const actions = new ActionRegistry();
  registerDesignActions(actions, (_bytes, name) => void saved.push(name), async () => {});
  registerMeshActions(actions, (_bytes, name) => void saved.push(name));
  return app(insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 100 }).doc, undefined, { actions });
}

/** Exports `kind` with the first check_solid call it makes failed; the number of that call among the export's kernel calls. */
async function exportWithCheckFailed(a: App, kind: "stl" | "3mf" | "obj"): Promise<number> {
  a.failCall(0);
  await exportAs(a, kind);
  const calls = a.calls().made;
  for (let n = 1; n <= calls; n++) {
    a.failCall(n);
    await exportAs(a, kind);
    if (a.calls().failed === "check_solid") return n;
    // Not the check: put the checked card back before the next try.
    a.failCall(0);
    await exportAs(a, "stl");
  }
  return 0;
}

for (const kind of ["stl", "3mf", "obj"] as const)
  test(`Export STL checked solid, then Export ${kind.toUpperCase()} whose check cannot run: no card says Checked solid`, async () => {
    const a = await twoBoxes();
    await exportAs(a, "stl");
    assert.equal(saved.length, 1, "the first export saved its file");
    // 24000 mm³ + 1000 mm³ = 25 cm³, both closed.
    assert.match(card(a) ?? "", /Checked solid/, "the first export is checked solid and its card says so");
    const at = await exportWithCheckFailed(a, kind);
    assert.ok(at > 0, "the export's check_solid call was found and failed");
    assert.equal(saved.length, 1, "a check that can't run never stops the export");
    const note = a.$("#action-note")!.textContent ?? "";
    assert.match(note, /could not run/, "the note says the check could not run");
    assert.equal(/Checked solid/.test(card(a) ?? ""), false, `the card still says: ${card(a)}`);
    a.failCall(0);
    // Control: the next export whose check runs shows the card again.
    await exportAs(a, kind);
    assert.match(card(a) ?? "", /Checked solid/, "a check that runs again brings the card back");
    await a.close();
  });
