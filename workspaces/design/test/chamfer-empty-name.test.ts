// A Chamfer saved with an empty name opens as "Chamfer <n>", as every other kind of item is named by its kind
// (document.ts withRuledNames `base`). App bug hunt 2026-11-18, E-4: it opened as "Item 1".
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument, readDesignDocument } from "../src/document.ts";
import { insertChamfer } from "../src/chamfer.ts";

test("an empty-named Chamfer opens as Chamfer 1", () => {
  const d0 = partDocument("box", 10, 10, 10);
  const c = insertChamfer(d0, "body:feature-1", ["design:" + encodeURIComponent("face:feature-1/top+face:feature-1/front")], { equal: 1 });
  const raw = JSON.parse(JSON.stringify(c.doc));
  raw.timeline.features.find((f: { id: string }) => f.id === c.id).provenance.self.label = "";
  const back = readDesignDocument(raw);
  // The only Chamfer of the design, so the first: "Chamfer 1".
  assert.equal(back.timeline.features.find((f) => f.id === c.id)!.provenance.self.label, "Chamfer 1");
});
