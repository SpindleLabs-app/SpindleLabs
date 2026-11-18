// App bug hunt 2026-11-18, C-1: the Slice page lists the plate only after the registry has brought Design's list up to
// date (`settled`), so a reload, an Open or an Undo on this page shows the bodies Design would show, not a guess from
// the data alone. A stand-in Design: its list says "Body 1" until settled, then "Body 1" and "Body 2".
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { RepresentationRegistry, type WorkspaceContext } from "@fission/core";
import { mountSlicePage } from "../src/index.ts";

test("the plate is read after Design's list is settled, never from the guess before", async () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = () => doc.body.appendChild(doc.createElement("div"));
  const registry = new RepresentationRegistry();
  let settled = false;
  let asked = 0;
  registry.registerSettler("design", async () => {
    asked++;
    await new Promise((r) => setTimeout(r, 5)); // a rebuild takes a while
    settled = true;
  });
  const body = (n: number) => ({ type: "fake.body", id: `b${n}`, label: `Body ${n}` });
  registry.registerLister("design", () => (settled ? [body(1), body(2)] : [body(1)]));
  registry.registerProducer("fake.body", "mesh", () => ({ kind: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }));
  const ctx = {
    project: {},
    toolbar: slot(),
    browser: slot(),
    properties: slot(),
    representations: registry,
    kernel: { call: async () => ({}) },
    viewport: { showBody: () => undefined, fit: () => null },
  } as unknown as WorkspaceContext;
  const mounted = mountSlicePage(ctx);
  await mounted.ready;
  assert.equal(asked, 1);
  assert.deepEqual([...ctx.browser.querySelectorAll("li")].map((l) => l.textContent), ["Body 1", "Body 2"]);
  assert.equal(ctx.browser.querySelector(".slice-page-words")!.textContent, "2 bodies on the plate.");
  mounted.unmount();
});
