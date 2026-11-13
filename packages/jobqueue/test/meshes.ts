// Meshes for the tests, written apart from the readers: a box's corners and triangles, and a mesh as a text STL.

/** A w × d × h box's corners and its 12 triangles wound outward, written here apart from the reader. */
export function boxMesh(w: number, d: number, h: number, at: [number, number, number] = [0, 0, 0]) {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]].map((p) => p.map((x, a) => x + at[a]!));
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { positions: v.flat(), indices: f.flat() };
}

/** The same box as a text STL. */
export function textStl(mesh: { positions: number[]; indices: number[] }, upper = false): Uint8Array {
  let s = "solid part\n";
  for (let t = 0; t < mesh.indices.length; t += 3) {
    s += "  facet normal 0 0 0\n    outer loop\n";
    for (let k = 0; k < 3; k++) s += `      vertex ${[0, 1, 2].map((a) => mesh.positions[3 * mesh.indices[t + k]! + a]).join(" ")}\n`;
    s += "    endloop\n  endfacet\n";
  }
  s += "endsolid part\n";
  return new TextEncoder().encode(upper ? s.toUpperCase() : s);
}
