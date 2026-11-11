// A seeded, deterministic huge project for the load/save speed and memory checks (big-saveload.mjs): `items` timeline
// items, half sketches and half extrudes of them, each sketch a closed polygon of `sides` lines (a big sketch), laid out on a grid so no two bodies touch. Same seed and arguments, same file text. Built with Design's own
// editing functions, so it is a file the app itself could have saved. Run with `node --experimental-strip-types`.
import { emptyProject, projectToJson } from "@fission/core";
import { addSketch, drawLine } from "../../../workspaces/design/src/sketch.ts";
import { extrudeSketch } from "../../../workspaces/design/src/extrude.ts";
import { freshDesign } from "../../../workspaces/design/src/start-fresh.ts";

/** A small seeded generator (mulberry32): the same seed gives the same numbers on every machine. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The project's text (projectToJson), `items` timeline items (even), each sketch a closed polygon of `sides` lines. */
export function bigProject({ seed = 1, items = 200, sides = 32, name = "Big project" } = {}) {
  const r = random(seed);
  let doc = freshDesign();
  const per = Math.ceil(Math.sqrt(items / 2));
  for (let k = 0; k < items / 2; k++) {
    const cx = (k % per) * 60;
    const cy = Math.floor(k / per) * 60;
    const made = addSketch(doc, "XY");
    doc = made.doc;
    const sketch = made.id;
    // A star-ish polygon: radius 15..20 mm at each corner, so it never crosses itself.
    const corners = [];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides;
      const rad = 15 + 5 * r();
      corners.push([Math.round((cx + rad * Math.cos(a)) * 1000) / 1000, Math.round((cy + rad * Math.sin(a)) * 1000) / 1000]);
    }
    const first = drawLine(doc, sketch, corners[0], corners[1]);
    doc = first.doc;
    let s = doc.sketches.find((x) => x.id === sketch);
    const start = s.points[0].id;
    let prev = s.points[1].id;
    for (let i = 2; i < sides; i++) {
      doc = drawLine(doc, sketch, prev, corners[i]).doc;
      s = doc.sketches.find((x) => x.id === sketch);
      prev = s.points[s.points.length - 1].id;
    }
    doc = drawLine(doc, sketch, prev, start).doc;
    doc = extrudeSketch(doc, sketch, Math.round((5 + 20 * r()) * 100) / 100).doc;
  }
  const project = emptyProject(name);
  project.workspaces.design = doc;
  return projectToJson(project);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(bigProject({ seed: Number(process.argv[2] ?? 1), items: Number(process.argv[3] ?? 200) }));
