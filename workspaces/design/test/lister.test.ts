// What Design offers other workspaces to list (registerLister, for the Slice page): every body shown, by its browser name,
// read from the project's data alone. Hand-worked: a design with one box has one body, "Body 1"; hiding it leaves none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, RepresentationRegistry, type KernelCalls } from "@fission/core";
import { partDocument } from "../src/document.ts";
import { registerDesign } from "../src/representations.ts";
import { hideBody } from "../src/timeline-edits.ts";
import { bodyIdOf } from "../src/document.ts";
import { lastFeature } from "../src/document.ts";

const kernel = { call: async () => ({}) } as unknown as KernelCalls;
const registry = () => {
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  return r;
};
const projectWith = (data: unknown) => ({ ...emptyProject(), workspaces: { design: data } });

test("a design with one box lists one body, Body 1, as a design feature", () => {
  const doc = partDocument("box", 40, 30, 20);
  const listed = registry().objectsOf("design", projectWith(doc));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].type, "design.feature");
  assert.equal(listed[0].label, "Body 1");
  assert.equal(listed[0].id, lastFeature(doc).id);
});

test("a body hidden by its eye is not listed; showing it lists it again", () => {
  const doc = partDocument("box", 40, 30, 20);
  const body = bodyIdOf(lastFeature(doc).id);
  assert.deepEqual(registry().objectsOf("design", projectWith(hideBody(doc, body, true))), []);
  assert.equal(registry().objectsOf("design", projectWith(hideBody(hideBody(doc, body, true), body, false))).length, 1);
});

test("no Design data, or data that does not read, lists nothing and never throws (a test that can fail: the listing is not just always empty)", () => {
  for (const data of [undefined, null, 7, "x", {}, { version: 99 }]) assert.deepEqual(registry().objectsOf("design", projectWith(data)), [], JSON.stringify(data));
  assert.equal(registry().objectsOf("nothing", projectWith(partDocument("box", 1, 1, 1))).length, 0); // a workspace with no lister offers none
});

test("a lister can be registered once per workspace", () => {
  const r = registry();
  assert.throws(() => r.registerLister("design", () => []), /already has a lister/);
});
