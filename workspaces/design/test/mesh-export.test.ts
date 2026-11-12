import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionRegistry, emptyProject, type AnalysisOverlay, type Selected, type WorkspaceContext } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { registerDesignActions, targetsOf } from "../src/actions.ts";
import { insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { DOWNLOAD_3MF, DOWNLOAD_OBJ, OBJ_UNITS, registerMeshActions } from "../src/mesh-export.ts";

const kernel = nodeKernel();

function setUp(doc: unknown) {
  const saved: { name: string; bytes: Uint8Array }[] = [];
  const r = new ActionRegistry();
  registerDesignActions(r, () => {});
  registerMeshActions(r, (bytes, name) => void saved.push({ name, bytes }));
  const project = emptyProject();
  project.workspaces.design = doc;
  const ctx = { project, kernel, viewport: { setOverlay: (_: AnalysisOverlay) => {}, clearOverlay: () => {} } } as unknown as WorkspaceContext;
  return { r, saved, ctx };
}

/** What Python reads in a 3MF (zip CRCs checked, every object's corners, triangles and divergence-theorem volume) or an OBJ. */
function pythonReads(bytes: Uint8Array, kind: "3mf" | "obj"): string {
  const file = join(mkdtempSync(join(tmpdir(), "mesh-export-")), `part.${kind}`);
  writeFileSync(file, bytes);
  const script = [
    "import sys, zipfile, re",
    "def vol(c, t): return sum(c[a][0]*(c[b][1]*c[d][2]-c[b][2]*c[d][1]) - c[a][1]*(c[b][0]*c[d][2]-c[b][2]*c[d][0]) + c[a][2]*(c[b][0]*c[d][1]-c[b][1]*c[d][0]) for a,b,d in t)/6",
    "out = []",
    "if sys.argv[2] == '3mf':",
    "  z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None",
    "  m = z.read('3D/3dmodel.model').decode(); assert 'unit=\"millimeter\"' in m",
    "  for o in re.findall(r'<object (.*?)</object>', m, re.S):",
    "    c = [tuple(map(float, v)) for v in re.findall(r'<vertex x=\"(.*?)\" y=\"(.*?)\" z=\"(.*?)\"/>', o)]",
    "    t = [tuple(map(int, v)) for v in re.findall(r'<triangle v1=\"(\\d+)\" v2=\"(\\d+)\" v3=\"(\\d+)\"/>', o)]",
    "    out.append(f'{re.search(r\"name=\\\"(.*?)\\\"\", o).group(1)}: {len(c)} {len(t)} {vol(c, t):.6f}')",
    "else:",
    "  c, t, name = [], [], None",
    "  def flush():",
    "    if name: out.append(f'{name}: {len(cs)} {len(ts)} {vol(c, [(a-1,b-1,d-1) for a,b,d in ts]):.6f}')",
    "  cs, ts = [], []",
    "  for line in open(sys.argv[1]):",
    "    p = line.split()",
    "    if not p or p[0] == '#': continue",
    "    if p[0] == 'o': flush(); name = p[1]; cs, ts = [], []",
    "    elif p[0] == 'v': c.append(tuple(map(float, p[1:]))); cs.append(1)",
    "    elif p[0] == 'f': ts.append(tuple(map(int, p[1:])))",
    "  flush()",
    "print('\\n'.join(out))",
  ].join("\n");
  return execFileSync("python3", ["-I", "-c", script, file, kind], { encoding: "utf8" }).trim();
}

const box = partDocument("box", 40, 30, 20);
const boxBody: Selected = { kind: "body", id: "body:feature-1" };

test("selected bodies offer Download 3MF and Download OBJ beside Download STL", () => {
  const { r } = setUp(box);
  assert.deepEqual(r.actionsFor(targetsOf([boxBody], box)).map((a) => a.label), ["Download STL", "Download 3MF", "Download OBJ"]);
  assert.deepEqual(r.actionsFor(targetsOf([{ kind: "face", id: "face:feature-1/0" }], box)), []);
});

test("a 40 × 30 × 20 mm box as 3MF: 8 corners, 12 triangles, 24,000 mm³, checked solid", async () => {
  const { r, saved, ctx } = setUp(box);
  const outcome = await r.get(DOWNLOAD_3MF)!.run([boxBody], ctx);
  assert.equal(outcome.message, "Exported spindlelabs-box.3mf. Checked solid.");
  assert.equal(outcome.bad, false);
  assert.equal(saved[0].name, "spindlelabs-box.3mf");
  // A box has 8 corners and 6 faces of 2 triangles; its volume is 40 · 30 · 20 = 24,000 mm³. The volume is the
  // divergence theorem's sum over the triangles as Python reads them, so it is positive only if every triangle faces out.
  assert.equal(pythonReads(saved[0].bytes, "3mf"), "Body 1: 8 12 24000.000000");
});

test("two bodies as OBJ are two objects, each its own corners, with the units said", async () => {
  // Box 1 is 40 × 30 × 20 (24,000 mm³); the inserted cylinder is radius 15, height 30, faceted, so its volume is a
  // little under π · 15² · 30 = 21,205.75 mm³ (a mesh's flat sides cut inside the round).
  // The cylinder moved 100 mm along x, well clear of the box, so the two are separate solids and the file checks solid.
  const doc = insertMove(insertPreset(box, "cylinder", 30, 30, 30).doc, ["body:feature-2"], { ...NO_MOVE, x: 100 }).doc;
  const { r, saved, ctx } = setUp(doc);
  const bodies: Selected[] = [boxBody, { kind: "body", id: "body:feature-2" }];
  const outcome = await r.get(DOWNLOAD_OBJ)!.run(bodies, ctx);
  assert.match(outcome.message, /^Exported spindlelabs-2-bodies\.obj\. Checked solid\. /);
  assert.ok(outcome.message.endsWith(OBJ_UNITS));
  const lines = pythonReads(saved[0].bytes, "obj").split("\n");
  assert.equal(lines[0], "Body_1: 8 12 24000.000000");
  const [, corners, triangles, volume] = lines[1].match(/^Body_2: (\d+) (\d+) ([\d.]+)$/)!;
  // A closed triangle mesh of genus 0: V − E + F = 2 with E = 3F/2, so F = 2V − 4.
  assert.equal(Number(triangles), 2 * Number(corners) - 4);
  assert.ok(Number(volume) < Math.PI * 15 * 15 * 30 && Number(volume) > 0.99 * Math.PI * 15 * 15 * 30, `cylinder volume ${volume}`);
});

test("a body not shown is refused in words, and nothing is saved", async () => {
  const { r, saved, ctx } = setUp(box);
  const outcome = await r.get(DOWNLOAD_3MF)!.run([{ kind: "body", id: "body:feature-9" }], ctx);
  assert.deepEqual(outcome, { message: "body:feature-9 is not a body shown in the design, so there is nothing to download.", bad: true });
  assert.equal(saved.length, 0);
});
