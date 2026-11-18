// Every tool on the real kernel: hand-worked answers (the working beside
// each), each refusal, and the file round trips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { commandSchema, emptyProject, projectToJson } from "@fission/core";
import { plainToPackage } from "@fission/open-format";
import { COMMAND_SPECS, MAX_PATH } from "../src/session.ts";
import { kernel, near, ok, refused, session } from "./helpers.ts";

test("hand-worked: a 20 × 10 × 5 box", async () => {
  const { s } = session();
  await ok(s, "new_project", { name: "Bracket" });
  const d = await ok(s, "set_part", { shape: "box", width: 20, depth: 10, height: 5 });
  assert.deepEqual(d.bodies, [{ name: "Body 1", id: "body:feature-1", madeBy: "Box 1", hidden: false }]);
  assert.equal(d.project, "Bracket");
  const m = await ok(s, "measure_body", { body: "body 1", density_g_per_cm3: 1.24 });
  // Volume 20·10·5 = 1000 mm³; area 2(20·10 + 20·5 + 10·5) = 700 mm²; mass 1000 mm³ = 1 cm³ × 1.24 g/cm³ = 1.24 g.
  near(m.volume_mm3, 1000);
  near(m.area_mm2, 700);
  near(m.mass_g, 1.24);
  assert.deepEqual(m.size_mm, [20, 10, 5]);
  assert.deepEqual([m.faces, m.edges, m.corners], [6, 12, 8]);
  await s.close();
});

test("hand-worked: a cylinder ⌀20 × 10 and a sketched, extruded rectangle", async () => {
  const { s } = session();
  await ok(s, "new_project");
  await ok(s, "set_part", { shape: "cylinder", width: 20, height: 10 });
  // π r² h = π · 10² · 10 = 1000π mm³.
  near((await ok(s, "measure_body", { body: "Body 1" })).volume_mm3, 1000 * Math.PI, 1e-6);
  await ok(s, "create_sketch", { on: "XY" });
  await ok(s, "draw_rectangle", { width: 30, height: 20, x: 50, y: 0 });
  const d = await ok(s, "extrude_sketch", { distance: 5 });
  assert.deepEqual(d.bodies.map((b: { name: string }) => b.name), ["Body 1", "Body 2"]);
  const m = await ok(s, "measure_body", { body: "Body 2" });
  // 30 · 20 · 5 = 3000 mm³, centred on x = 50: x from 35 to 65, y from −10 to 10, z from 0 to 5.
  near(m.volume_mm3, 3000);
  assert.deepEqual(m.bounds_mm, { low: [35, -10, 0], high: [65, 10, 5] });
  // A negative distance goes down: z from −5 to 0.
  await ok(s, "extrude_sketch", { distance: -5, sketch: "Sketch 1" });
  assert.deepEqual((await ok(s, "measure_body", { body: "Body 3" })).bounds_mm, { low: [35, -10, -5], high: [65, 10, 0] });
  const renamed = await ok(s, "rename_item", { item: "Sketch 1", name: "base" });
  assert.ok(renamed.timeline.some((t: { name: string }) => t.name === "base"));
  await s.close();
});

test("refusals change nothing", async () => {
  const { s } = session();
  assert.match(await refused(s, "describe_design"), /no project is open/);
  assert.match(await refused(s, "set_part", { shape: "box", width: 1, depth: 1, height: 1 }), /no project is open/);
  await ok(s, "new_project");
  const empty = await ok(s, "describe_design");
  assert.match(await refused(s, "extrude_sketch", { distance: 5 }), /refused/);
  assert.match(await refused(s, "draw_circle", { diameter: 5 }), /no sketch/);
  assert.match(await refused(s, "set_part", { shape: "box", width: -1, depth: 1, height: 1 }), /greater than 0/);
  assert.match(await refused(s, "set_part", { shape: "teapot", width: 1 }), /must be one of/);
  assert.match(await refused(s, "set_part", { shape: "box", width: 1, depth: 1, height: 1, colour: "red" }), /no parameter "colour"/);
  assert.match(await refused(s, "set_part", { shape: "box", width: 1 }), /needs its depth/);
  assert.match(await refused(s, "measure_body", { body: "Body 1" }), /no body "Body 1"; the bodies are none/);
  assert.deepEqual(await ok(s, "describe_design"), empty);
  await ok(s, "set_part", { shape: "box", width: 10, depth: 10, height: 10 });
  const one = await ok(s, "describe_design");
  // 2,000,000 mm is past the kernel's 1 km: the kernel refuses, and the box stays 10 mm.
  assert.match(await refused(s, "set_part", { shape: "box", width: 2e6, depth: 10, height: 10 }), /refused/);
  assert.deepEqual(await ok(s, "describe_design"), one);
  near((await ok(s, "measure_body", { body: "Body 1" })).volume_mm3, 1000);
  assert.equal(await s.call("make_teapot", {}), null);
  assert.match(await refused(s, "measure_body", { body: "Body 1", density_g_per_cm3: 0 }), /more than 0/);
  assert.match(await refused(s, "measure_body", { body: "Body 1", density_g_per_cm3: 26 }), /at most 25/);
  await s.close();
});

test("export_stl: a box is 12 triangles, 84 + 50 · 12 = 684 bytes, checked solid", async () => {
  const { s, files } = session();
  await ok(s, "new_project");
  await ok(s, "set_part", { shape: "box", width: 10, depth: 10, height: 10 });
  const e = await ok(s, "export_stl", { path: "/out/a.stl" });
  assert.deepEqual([e.bytes, e.triangles, e.solid], [684, 12, "solid"]);
  assert.equal(files.map.get("/out/a.stl")!.length, 684);
  assert.match(await refused(s, "export_stl", { path: "/out/a.stl" }), /already there/);
  await ok(s, "export_stl", { path: "/out/a.stl", overwrite: true });
  assert.match(await refused(s, "export_stl", { path: "out/a.stl" }), /absolute path/);
  assert.match(await refused(s, "export_stl", { path: "/out/a.obj" }), /end in \.stl/);
  assert.match(await refused(s, "export_stl", { path: "/out/b.stl", bodies: ["Body 9"] }), /no body "Body 9"/);
  assert.match(await refused(s, "export_stl", { path: "/" + "x".repeat(MAX_PATH) + ".stl" }), /path must be text/);
  files.failWrites = true;
  assert.match(await refused(s, "export_stl", { path: "/out/c.stl" }), /can't write \/out\/c\.stl: EACCES/);
  await s.close();
});

test("export_stl: two bodies in one file, a hidden one left out unless named", async () => {
  const { s, files } = session();
  const { s: maker } = session(files);
  await ok(maker, "new_project");
  await ok(maker, "set_part", { shape: "box", width: 10, depth: 10, height: 10 });
  await ok(maker, "create_sketch", { on: "XY" });
  await ok(maker, "draw_rectangle", { width: 4, height: 4, x: 30 });
  const second = (await ok(maker, "extrude_sketch", { distance: 4 })).bodies[1].id;
  await ok(maker, "save_project", { path: "/two.spindle" });
  await maker.close();
  // Hide Body 2 in the file, as its eye does.
  const json = JSON.parse(new TextDecoder().decode(files.map.get("/two.spindle")!));
  json.workspaces.design.hidden = [second];
  files.map.set("/two.spindle", new TextEncoder().encode(JSON.stringify(json)));
  const d = await ok(s, "open_project", { path: "/two.spindle" });
  assert.deepEqual(d.bodies.map((b: { name: string; hidden: boolean }) => [b.name, b.hidden]), [["Body 1", false], ["Body 2", true]]);
  // Shown only: one box, 12 triangles; both named: two boxes, 24.
  assert.equal((await ok(s, "export_stl", { path: "/a.stl" })).triangles, 12);
  const both = await ok(s, "export_stl", { path: "/b.stl", bodies: ["Body 1", second, "Body 1"] });
  assert.deepEqual([both.triangles, both.bodies], [24, ["Body 1", "Body 2"]]);
  json.workspaces.design.hidden = ["body:feature-1", second];
  files.map.set("/two.spindle", new TextEncoder().encode(JSON.stringify(json)));
  await ok(s, "open_project", { path: "/two.spindle" });
  assert.match(await refused(s, "export_stl", { path: "/c.stl" }), /every body is hidden/);
  await s.close();
});

test("save and open: the same design back, saved again byte for byte; the zip package opens too", async () => {
  const { s, files } = session();
  await ok(s, "new_project", { name: "Round trip" });
  await ok(s, "set_part", { shape: "l-bracket", width: 40, depth: 30, height: 20 });
  await ok(s, "save_project", { path: "/p.spindle" });
  const before = await ok(s, "describe_design");
  assert.match(await refused(s, "save_project", { path: "/p.spindle" }), /already there/);
  assert.match(await refused(s, "save_project", { path: "/p.json" }), /end in \.spindle/);
  const { s: other } = session(files);
  assert.deepEqual(await ok(other, "open_project", { path: "/p.spindle" }), before);
  await ok(other, "save_project", { path: "/q.spindle" });
  assert.deepEqual(files.map.get("/q.spindle"), files.map.get("/p.spindle"));
  files.map.set("/p.zip.spindle", await plainToPackage(files.map.get("/p.spindle")!));
  assert.deepEqual(await ok(other, "open_project", { path: "/p.zip.spindle" }), before);
  await s.close();
  await other.close();
});

test("open_project refuses what isn't a project, in words", async () => {
  const { s, files } = session();
  assert.match(await refused(s, "open_project", { path: "/none.spindle" }), /no file/);
  assert.match(await refused(s, "open_project", { path: "rel.spindle" }), /absolute path/);
  files.map.set("/junk.spindle", new TextEncoder().encode("{not json"));
  assert.match(await refused(s, "open_project", { path: "/junk.spindle" }), /can't open/);
  const newer = { ...emptyProject(), formatVersion: 99 };
  files.map.set("/newer.spindle", new TextEncoder().encode(JSON.stringify(newer)));
  assert.match(await refused(s, "open_project", { path: "/newer.spindle" }), /newer SpindleLabs/);
  files.map.set("/bad-design.spindle", new TextEncoder().encode(projectToJson({ ...emptyProject(), workspaces: { design: { version: 17 } } })));
  assert.match(await refused(s, "open_project", { path: "/bad-design.spindle" }), /design workspace's data/);
  // A file over 64 MiB is refused by its size, before it is read.
  files.map.set("/big.spindle", new Uint8Array(64 * 1024 * 1024 + 1));
  assert.match(await refused(s, "open_project", { path: "/big.spindle" }), /at most 67108864/);
  // An empty project opens with no design: an empty one.
  files.map.set("/empty.spindle", new TextEncoder().encode(projectToJson(emptyProject("E"))));
  assert.deepEqual((await ok(s, "open_project", { path: "/empty.spindle" })).bodies, []);
  await s.close();
});

test("a real saved file (Ben's Combine regression) opens with the app's bodies", async () => {
  const { s, files } = session();
  files.map.set("/c.spindle", new Uint8Array(readFileSync(new URL("../../../workspaces/design/test/regressions/combined-part.spindle", import.meta.url))));
  const d = await ok(s, "open_project", { path: "/c.spindle" });
  assert.ok(d.bodies.length > 0);
  assert.ok(d.timeline.some((t: { kind: string }) => t.kind === "combine"));
  for (const b of d.bodies) assert.ok((await ok(s, "measure_body", { body: b.name })).volume_mm3 > 0);
  const e = await ok(s, "export_stl", { path: "/c.stl" });
  assert.equal(e.solid, "solid");
  await s.close();
});

test("the kernel holds no body after close", async () => {
  const start = await kernel.call("body_count");
  const { s } = session();
  await ok(s, "new_project");
  await ok(s, "set_part", { shape: "box", width: 10, depth: 10, height: 10 });
  await ok(s, "set_part", { shape: "box", width: 12, depth: 10, height: 10 });
  await refused(s, "set_part", { shape: "box", width: 2e6, depth: 10, height: 10 });
  await ok(s, "new_project");
  await ok(s, "set_part", { shape: "sphere", width: 10 });
  await s.close();
  assert.equal(await kernel.call("body_count"), start);
});

test("the command tools are Design's own commands, schemas generated from them", () => {
  const { s } = session();
  const tools = s.tools();
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const spec of COMMAND_SPECS) {
    const tool = tools.find((t) => t.name === spec.op)!;
    const { properties } = commandSchema(spec) as { properties: Record<string, unknown> };
    const { op: _, ...props } = properties;
    assert.deepEqual((tool.inputSchema as { properties: unknown }).properties, props);
    assert.ok(!(tool.inputSchema as { required: string[] }).required.includes("op"));
  }
  assert.ok(!tools.some((t) => t.name === "combine"), "Combine stays out until it is public");
  for (const t of tools) assert.match(t.description, /^Beta: /);
});
