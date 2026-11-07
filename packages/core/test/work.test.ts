// workspacesWithWork (model/work.ts, U6a): hand-worked cases, junk that must never throw, and a deliberate break.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, workspacesWithWork, type Project } from "../src/index.ts";

const withDesign = (design: unknown): Project => ({ ...emptyProject("P"), workspaces: { design } });

test("hand-worked: a new project holds no work; one sketch, or one timeline step, makes Design hold work", () => {
  assert.deepEqual(workspacesWithWork(emptyProject()), []); // no workspace part at all
  assert.deepEqual(workspacesWithWork(withDesign({ sketches: [], timeline: { features: [] } })), []); // a fresh Design document: nothing yet
  assert.deepEqual(workspacesWithWork(withDesign({ sketches: [{ id: "s1" }], timeline: { features: [] } })), ["design"]); // one sketch
  assert.deepEqual(workspacesWithWork(withDesign({ sketches: [], timeline: { features: [{ id: "f1" }] } })), ["design"]); // one step, its sketch deleted
});

test("a part that is not a document holds no work and never throws", () => {
  for (const junk of [null, undefined, 0, "x", true, [], [1], {}, { sketches: "x" }, { sketches: {}, timeline: null }, { timeline: [] }, { timeline: { features: 3 } }]) {
    assert.deepEqual(workspacesWithWork(withDesign(junk)), [], JSON.stringify(junk));
  }
  assert.deepEqual(workspacesWithWork({ workspaces: null } as unknown as Project), []);
  assert.deepEqual(workspacesWithWork({ workspaces: [] } as unknown as Project), []);
});

test("a workspace this build keeps nothing for is never claimed, however full its part looks", () => {
  const p: Project = { ...emptyProject("P"), workspaces: { image: { sketches: [1], timeline: { features: [1] } }, render: [1, 2] } };
  assert.deepEqual(workspacesWithWork(p), []);
});

test("deliberate break: reading the sketches as a plain truthy value would call an empty list work", () => {
  const broken = (d: { sketches?: unknown[] }) => Boolean(d.sketches);
  assert.equal(broken({ sketches: [] }), true); // the break gives the wrong answer here...
  assert.deepEqual(workspacesWithWork(withDesign({ sketches: [] })), []); // ...which the real rule gets right
});
