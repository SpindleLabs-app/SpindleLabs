// Seeded random tool calls, good and bad mixed, on the real kernel: every
// call answers (works or refuses in words), never throws, and after each
// one every body the design lists still measures. FISSION_SEED replays one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kernel, session } from "./helpers.ts";

const SEEDS = Number(process.env.MCP_RANDOM_SEEDS ?? "6");
const CALLS = 60;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALUES: unknown[] = [0, -1, 1, 5, 20, 1e-4, 1e7, 3.5, "", "x", "Body 1", "Body 2", "Sketch 1", "XY", "XZ", "box", "cylinder", "sphere", "star", true, false, null, [], ["Body 1"], {}, { a: 1 }, "/a.stl", "/a.spindle", "rel.stl", "/p.spindle"];
const KEYS = ["path", "name", "body", "bodies", "overwrite", "density_g_per_cm3", "shape", "width", "depth", "height", "on", "diameter", "x", "y", "x1", "y1", "x2", "y2", "distance", "sketch", "item", "colour"];

/** Across all seeds: calls that worked and bodies seen, so a run that only ever refuses can't pass unnoticed. */
const seen = { worked: 0, refused: 0, bodies: 0 };

const GOOD: Record<string, readonly unknown[]> = {
  shape: ["box", "cylinder", "sphere", "l-bracket", "plate", "slot", "star"],
  width: [5, 10, 20], depth: [5, 10, 20], height: [5, 10, 20], diameter: [4, 8], distance: [5, -5, 12],
  x: [0, 10, -10, 30], y: [0, 10, -10], x1: [0, 10], y1: [0, 10], x2: [0, 20], y2: [0, 20],
  on: ["XY", "XZ", "YZ"], body: ["Body 1", "Body 2", "Body 3"], bodies: [["Body 1"], ["Body 1", "Body 2"]],
  path: ["/a.stl", "/b.stl", "/a.spindle", "/p.spindle"], overwrite: [true, false], density_g_per_cm3: [1.24, 7.8],
  name: ["Part", "Sketch 9"], item: ["Sketch 1", "Box 1"], sketch: ["Sketch 1", "Sketch 2"],
};

const seeds = process.env.FISSION_SEED ? [Number(process.env.FISSION_SEED)] : Array.from({ length: SEEDS }, (_, i) => 9100 + i);
for (const seed of seeds) {
  test(`random calls, seed ${seed}`, async () => {
    const rnd = mulberry32(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const start = await kernel.call("body_count");
    const { s, files } = session();
    const names = [...s.tools().map((t) => t.name), "nope"];
    files.map.set("/p.spindle", new TextEncoder().encode('{"formatVersion":2,"name":"P","units":{"length":"mm"},"materials":[],"links":[],"workspaces":{}}'));
    try {
      for (let i = 0; i < CALLS; i++) {
        const name = rnd() < 0.08 ? "new_project" : pick(names);
        const args: Record<string, unknown> = {};
        // Mostly the tool's own keys with sensible values (now and then any value), else anything anywhere.
        const own = Object.keys((s.tools().find((t) => t.name === name)?.inputSchema as { properties?: object } | undefined)?.properties ?? {});
        if (rnd() < 0.7) {
          for (const k of own) if (rnd() < 0.85) args[k] = rnd() < 0.1 ? pick(VALUES) : pick(GOOD[k] ?? VALUES);
        } else for (let k = Math.floor(rnd() * 4); k > 0; k--) args[pick(KEYS)] = pick(VALUES);
        const where = `seed ${seed}, call ${i}: ${name} ${JSON.stringify(args)}`;
        const got = await s.call(name, args).catch((e) => assert.fail(`${where} threw ${e}`));
        if (name === "nope") assert.equal(got, null, where);
        else assert.ok(got !== null && (got.ok || (typeof got.error === "string" && got.error.length > 0)), where);
        if (got?.ok) seen.worked++;
        else if (got) seen.refused++;
        const d = await s.call("describe_design", {});
        if (d?.ok) for (const b of (d.data as { bodies: { name: string }[] }).bodies) {
          seen.bodies++;
          const m = await s.call("measure_body", { body: b.name });
          assert.ok(m?.ok && (m.data as { volume_mm3: number }).volume_mm3 > 0, `${where}: ${b.name} doesn't measure`);
        }
      }
    } finally {
      await s.close();
    }
    assert.equal(await kernel.call("body_count"), start, `seed ${seed}: bodies left in the kernel`);
  });
}

test("the random calls both built bodies and were refused", () => {
  assert.ok(seen.worked > 0 && seen.refused > 0 && seen.bodies > 0, JSON.stringify(seen));
});
