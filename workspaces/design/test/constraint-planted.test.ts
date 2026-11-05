// Bugs planted in the sketch constraints (constraints.ts, 47d2) and point
// dragging (point-drag.ts, 47d3), one at a time, each of which the seeded
// constraint sessions (constraint-session.ts) must catch, by the check
// recorded for it. Each plant is a text edit of the real source, loaded
// from copies of both files in a temporary folder (point-drag.ts's copy
// imports the copy of constraints.ts; every other import points back at
// src/), so src/ is never touched. (Plants the sessions can't see, like the
// arc turn-over check, which the kernel's own side-keeping makes a second
// line of defence, are caught by point-drag.test.ts's own cases.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { runConstraintSession, type SessionMods } from "./constraint-session.ts";

const kernel = nodeKernel();
const FILES = ["constraints.ts", "point-drag.ts"] as const;

interface Plant {
  name: string;
  file: (typeof FILES)[number];
  find: string;
  replace: string;
  /** The check that catches it, as the session's failure names it after the step. */
  caught: string;
}

const PLANTS: Plant[] = [
  { name: "drag-holds-nothing", file: "point-drag.ts", find: "const request = solverRequest(moved, [pointId]);", replace: "const request = solverRequest(moved, []);", caught: "pointer" },
  { name: "last-step-short-of-the-pointer", file: "point-drag.ts", find: "  steps.push([to[0], to[1]]);", replace: "  steps.push([to[0] + 1e-9, to[1]]);", caught: "pointer" },
  { name: "drag-keeps-unsolved-points", file: "point-drag.ts", find: "    const [x, y] = solved.get(p.id)!;\n    return x === p.x && y === p.y ? p : { ...p, x, y };\n  });\n  return { doc:", replace: "    const [x, y] = p.id === pointId ? solved.get(p.id)! : [p.x, p.y];\n    return x === p.x && y === p.y ? p : { ...p, x, y };\n  });\n  return { doc:", caught: "circle" },
  { name: "drag-lets-a-line-shrink", file: "point-drag.ts", find: "  if (tiny !== null) return", replace: "  if (false) return", caught: "size" },
  { name: "fixes-not-told-to-the-solver", file: "constraints.ts", find: "    constraints.push(c.kind === \"fix\" ? [\"fix\", n(c.point)] : [c.kind, n(c.a), n(c.b)]);", replace: "    if (c.kind !== \"fix\") constraints.push([c.kind, n(c.a), n(c.b)]);", caught: "fixed" },
  { name: "constraint-added-unsolved", file: "constraints.ts", find: "  const points = trial.points.map((p) => {\n    const [x, y] = solved.get(p.id)!;", replace: "  const points = trial.points.map((p) => {\n    const [x, y] = [p.x, p.y];", caught: "holds" },
  { name: "vertical-told-as-horizontal", file: "constraints.ts", find: "    constraints.push(c.kind === \"fix\" ? [\"fix\", n(c.point)] : [c.kind, n(c.a), n(c.b)]);", replace: "    constraints.push(c.kind === \"fix\" ? [\"fix\", n(c.point)] : [c.kind === \"vertical\" ? \"horizontal\" : c.kind, n(c.a), n(c.b)]);", caught: "holds" },
];

/** Both modules with `plant` made (or none), from copies in `dir`. */
async function planted(plant: Plant | null, dir: string): Promise<SessionMods> {
  const tag = plant?.name ?? "none";
  const target = (f: string) => join(dir, `${tag}-${f}`);
  for (const f of FILES) {
    const source = new URL(`../src/${f}`, import.meta.url);
    let text = readFileSync(source, "utf8");
    if (plant?.file === f) {
      const at = text.indexOf(plant.find);
      assert.ok(at >= 0 && text.indexOf(plant.find, at + 1) < 0, `${plant.name}: the text to replace must be in ${f} exactly once: ${plant.find}`);
      text = text.slice(0, at) + plant.replace + text.slice(at + plant.find.length);
    }
    text = text.replace(/from "\.\/([^"]+)"/g, (_, g: string) => `from "${(FILES as readonly string[]).includes(g) ? pathToFileURL(target(g)).href : new URL(g, source).href}"`);
    writeFileSync(target(f), text);
  }
  const constraints = await import(pathToFileURL(target("constraints.ts")).href);
  const drag = await import(pathToFileURL(target("point-drag.ts")).href);
  return { addConstraint: constraints.addConstraint, dragTo: drag.dragTo, grabProblem: drag.grabProblem };
}

test("each bug planted in the constraints and the drag is caught by the seeded sessions, by the check recorded for it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "constraint-planted-"));
  const SEEDS = 4;
  const STEPS = 600;
  try {
    // The copies unplanted must pass, so a catch below is the plant's and not the copying's.
    const clean = await planted(null, dir);
    for (let seed = 1n; seed <= SEEDS; seed++) assert.equal(await runConstraintSession(kernel, clean, seed, STEPS), null, `the unplanted copy fails seed ${seed}`);
    const report: string[] = [];
    for (const plant of PLANTS) {
      const mods = await planted(plant, dir);
      let caught: string | null = null;
      for (let seed = 1n; seed <= SEEDS && caught === null; seed++) caught = await runConstraintSession(kernel, mods, seed, STEPS);
      report.push(`${plant.name}: ${caught?.slice(0, 160) ?? "NOT CAUGHT"}`);
      assert.ok(caught !== null, `${plant.name} was not caught by ${SEEDS} seeds × ${STEPS} steps`);
      assert.match(caught, new RegExp(`^seed \\d+ step \\d+ \\(\\w+\\)(, part way)?: ${plant.caught}:`), `${plant.name} was caught by another check than "${plant.caught}": ${caught}`);
    }
    if (process.env.FISSION_PLANTED_REPORT) console.log(report.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
