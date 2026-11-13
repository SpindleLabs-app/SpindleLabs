// A print job's STL file read as a mesh (step Q2, docs/progress/queue.md): binary or text STL, as a student's CAD
// program saves it. Shared corners merged (so the print check's ray tests and the open-edge count see one solid), the
// file's own numbers kept exactly (a binary file's corners are single-precision and stay so). Never throws: a file it
// cannot read gives the reason in words.
//
// STL has no units. A school's CAD programs save millimetres; the check says so where the size suggests otherwise.

/** The mesh as the print check and build area read it: flat xyz corners (mm) and three corner indices a triangle. */
export interface StlMesh {
  positions: number[];
  indices: number[];
  /** Triangles in the file, including any with no area (left out of `indices`). */
  fileTriangles: number;
  /** Edges used by one triangle only, or by more than two: a mesh that is not one closed skin. */
  openEdges: number;
  /** The file was a text STL. */
  text: boolean;
}

export type StlRead = { ok: true; mesh: StlMesh } | { ok: false; reason: string };

const HEADER = 80;
const TRIANGLE = 50;
/** Most triangles a job's file may hold: 2 million (a binary STL of 100 MB; the queue's file limit is half that). */
export const MAX_STL_TRIANGLES = 2_000_000;

/** Whether `bytes` read as a binary STL: its length is exactly what its triangle count says. */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER + 4) return false;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(HEADER, true);
  return bytes.length === HEADER + 4 + count * TRIANGLE;
}

class Welder {
  positions: number[] = [];
  indices: number[] = [];
  private index = new Map<string, number>();
  triangles = 0;
  corner(x: number, y: number, z: number): number {
    // -0 and 0 are the same place.
    const key = `${x + 0},${y + 0},${z + 0}`;
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.positions.length / 3;
      this.index.set(key, i);
      this.positions.push(x + 0, y + 0, z + 0);
    }
    return i;
  }
  triangle(a: number, b: number, c: number): void {
    this.triangles += 1;
    if (a !== b && b !== c && a !== c) this.indices.push(a, b, c);
  }
}

/** Edges used by exactly one triangle or by more than two (a closed skin uses each edge twice). */
export function openEdgeCount(indices: readonly number[]): number {
  const uses = new Map<string, number>();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k] as number;
      const b = indices[t + ((k + 1) % 3)] as number;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of uses.values()) if (n !== 2) open += 1;
  return open;
}

function finish(w: Welder, text: boolean): StlRead {
  if (w.indices.length === 0) return { ok: false, reason: "The STL file has no triangles with any area, so there is nothing to print." };
  return { ok: true, mesh: { positions: w.positions, indices: w.indices, fileTriangles: w.triangles, openEdges: openEdgeCount(w.indices), text } };
}

function readBinary(bytes: Uint8Array): StlRead {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(HEADER, true);
  if (count > MAX_STL_TRIANGLES) return { ok: false, reason: `The STL file has ${count} triangles; the check takes at most ${MAX_STL_TRIANGLES}. Save it with fewer (a coarser export).` };
  const w = new Welder();
  for (let t = 0; t < count; t++) {
    // 12 bytes of normal first: the corners' order says which way the triangle faces, so the normal is not needed.
    const base = HEADER + 4 + t * TRIANGLE + 12;
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      const o = base + 12 * k;
      const x = view.getFloat32(o, true);
      const y = view.getFloat32(o + 4, true);
      const z = view.getFloat32(o + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return { ok: false, reason: "The STL file has a corner that is not a number, so it is damaged. Save it again from the CAD program." };
      ids.push(w.corner(x, y, z));
    }
    w.triangle(ids[0] as number, ids[1] as number, ids[2] as number);
  }
  return finish(w, false);
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function readText(bytes: Uint8Array): StlRead {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "The STL file is neither a binary STL (its length doesn't match its triangle count) nor readable text, so it is damaged. Save it again." };
  }
  const words = text.split(/\s+/).filter((s) => s !== "");
  if ((words[0] ?? "").toLowerCase() !== "solid") return { ok: false, reason: "The file is not an STL: it doesn't start the way a text STL does, and its length doesn't match a binary STL." };
  const w = new Welder();
  let corners: number[] = [];
  let inLoop = false;
  for (let i = 1; i < words.length; i++) {
    const word = (words[i] as string).toLowerCase();
    if (word === "outer" && (words[i + 1] ?? "").toLowerCase() === "loop") {
      if (inLoop) return { ok: false, reason: "The text STL has a triangle inside a triangle, so it is damaged." };
      inLoop = true;
      corners = [];
      i += 1;
    } else if (word === "vertex") {
      if (!inLoop) return { ok: false, reason: "The text STL has a corner outside any triangle, so it is damaged." };
      const xyz = [words[i + 1], words[i + 2], words[i + 3]];
      if (!xyz.every((s) => s !== undefined && NUMBER.test(s))) return { ok: false, reason: "The text STL has a corner that is not three numbers, so it is damaged." };
      const [x, y, z] = xyz.map(Number) as [number, number, number];
      if (![x, y, z].every(Number.isFinite)) return { ok: false, reason: "The text STL has a corner that is not a number, so it is damaged." };
      corners.push(w.corner(x, y, z));
      i += 3;
    } else if (word === "endloop") {
      if (!inLoop || corners.length !== 3) return { ok: false, reason: "The text STL has a triangle without exactly three corners, so it is damaged." };
      if (w.triangles >= MAX_STL_TRIANGLES) return { ok: false, reason: `The STL file has more than ${MAX_STL_TRIANGLES} triangles; save it with fewer (a coarser export).` };
      w.triangle(corners[0] as number, corners[1] as number, corners[2] as number);
      inLoop = false;
    }
  }
  if (inLoop) return { ok: false, reason: "The text STL ends in the middle of a triangle, so it was cut short. Save it again." };
  return finish(w, true);
}

/** The STL file `bytes` as a mesh, or why it can't be read. Binary when its length matches its count, else text. */
export function readStl(bytes: Uint8Array): StlRead {
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  return isBinaryStl(bytes) ? readBinary(bytes) : readText(bytes);
}

/** The mesh as a binary STL (single precision; a binary file sent is passed on as it came, so this is only for text ones). */
export function binaryStlOf(mesh: Pick<StlMesh, "positions" | "indices">): Uint8Array<ArrayBuffer> {
  const count = mesh.indices.length / 3;
  const out = new Uint8Array(HEADER + 4 + count * TRIANGLE);
  const view = new DataView(out.buffer);
  view.setUint32(HEADER, count, true);
  for (let t = 0; t < count; t++) {
    const base = HEADER + 4 + t * TRIANGLE + 12;
    for (let k = 0; k < 3; k++) {
      const c = mesh.indices[3 * t + k] as number;
      for (let a = 0; a < 3; a++) view.setFloat32(base + 12 * k + 4 * a, mesh.positions[3 * c + a] as number, true);
    }
  }
  return out;
}
