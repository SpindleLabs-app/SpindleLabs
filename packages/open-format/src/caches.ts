// Structure checks of the two optional caches, brep.json and mesh.json +
// mesh.bin, and the stale check. A cache is never trusted for geometry: these
// checks only make sure a reader can walk it without going out of range. A
// failure is a reason to drop the cache (a warning), never to refuse the file.

/** 1 km in mm: every coordinate and size in a cache stays within it. */
export const MAX_COORDINATE = 1_000_000;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIndex = (v: unknown, length: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < length;

/** Every number anywhere inside is within ±1 km (JSON numbers are always finite). */
function numbersInRange(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE;
  if (Array.isArray(v)) return v.every(numbersInRange);
  if (isObject(v)) return Object.values(v).every(numbersInRange);
  return true;
}

const isVector = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
const isRadius = (v: unknown): boolean => typeof v === 'number' && v > 0;

/** The fields each curve and surface type needs (spec section 12). */
const CURVE_FIELDS: Readonly<Record<string, Readonly<Record<string, (v: unknown) => boolean>>>> = {
  line: {},
  circle: { centre: isVector, normal: isVector, radius: isRadius },
  ellipse: { centre: isVector, normal: isVector, majorAxis: isVector, minorRadius: isRadius },
};
const SURFACE_FIELDS: Readonly<Record<string, Readonly<Record<string, (v: unknown) => boolean>>>> = {
  plane: { origin: isVector, xAxis: isVector, normal: isVector },
  cylinder: { origin: isVector, axis: isVector, radius: isRadius },
  sphere: { centre: isVector, radius: isRadius },
};

function shapeProblem(v: unknown, kinds: typeof CURVE_FIELDS, where: string): string | null {
  if (!isObject(v) || typeof v.type !== 'string' || !Object.hasOwn(kinds, v.type)) {
    return `${where}.type is not one of ${Object.keys(kinds).join(', ')}`;
  }
  for (const [field, ok] of Object.entries(kinds[v.type]!)) {
    if (!ok(v[field])) return `${where}.${field} is missing or not the right kind of value`;
  }
  if (!numbersInRange(v)) return `${where} has a number beyond 1 km`;
  return null;
}

export interface SourceProblem { code: 'stale-cache' | 'bad-cache'; message: string }

/** The cache's own "source" must be the same object as its manifest entry's (spec section 12). */
export function sourceProblem(json: unknown, manifestSource: { historySha256: string; kernel: string }): SourceProblem | null {
  if (!isObject(json) || !isObject(json.source)) return { code: 'bad-cache', message: 'it has no "source"' };
  const s = json.source;
  if (s.historySha256 !== manifestSource.historySha256) {
    return { code: 'stale-cache', message: 'its own "source" names another history (stale)' };
  }
  if (s.kernel !== manifestSource.kernel) return { code: 'bad-cache', message: 'its own "source" names another kernel than the manifest' };
  return null;
}

/** null when brep.json is structurally sound, else what is wrong. */
export function brepProblem(json: unknown): string | null {
  if (!isObject(json)) return 'not a JSON object';
  if (json.version !== 1) return '"version" is not 1';
  if (!Array.isArray(json.bodies)) return '"bodies" is not a list';
  for (const [b, body] of json.bodies.entries()) {
    const at = `bodies[${b}]`;
    if (!isObject(body)) return `${at} is not an object`;
    if (typeof body.id !== 'string' || !body.id.startsWith('body:')) return `${at}.id does not start "body:"`;
    if (typeof body.number !== 'number' || !Number.isInteger(body.number) || body.number < 1) return `${at}.number is not a counting number`;
    const { faces, edges, vertices } = body;
    if (!Array.isArray(faces) || !Array.isArray(edges) || !Array.isArray(vertices)) return `${at} needs faces, edges and vertices lists`;
    for (const [v, vertex] of vertices.entries()) {
      if (!isVector(vertex) || !numbersInRange(vertex)) return `${at}.vertices[${v}] is not [x, y, z] within 1 km`;
    }
    for (const [e, edge] of edges.entries()) {
      const where = `${at}.edges[${e}]`;
      if (!isObject(edge)) return `${where} is not an object`;
      if (typeof edge.name !== 'string' || !edge.name.startsWith('edge:')) return `${where}.name does not start "edge:"`;
      const curve = shapeProblem(edge.curve, CURVE_FIELDS, `${where}.curve`);
      if (curve !== null) return curve;
      if (!isIndex(edge.start, vertices.length) || !isIndex(edge.end, vertices.length)) return `${where} start/end is not a vertex index`;
    }
    for (const [f, face] of faces.entries()) {
      const where = `${at}.faces[${f}]`;
      if (!isObject(face)) return `${where} is not an object`;
      if (typeof face.name !== 'string' || !face.name.startsWith('face:')) return `${where}.name does not start "face:"`;
      const surface = shapeProblem(face.surface, SURFACE_FIELDS, `${where}.surface`);
      if (surface !== null) return surface;
      if (!Array.isArray(face.loops)) return `${where}.loops is not a list`;
      // edge i forwards is i, backwards is -(i + 1): so -edges.length to edges.length - 1
      const edgeUse = (i: unknown): boolean => typeof i === 'number' && Number.isInteger(i) && i >= -edges.length && i < edges.length;
      for (const [l, loop] of face.loops.entries()) {
        if (!Array.isArray(loop) || !loop.every(edgeUse)) return `${where}.loops[${l}] is not a list of edge indices`;
      }
    }
  }
  return null;
}

interface Span { offset: number; count: number }

function span(v: unknown): Span | null {
  if (!isObject(v)) return null;
  const { offset, count } = v;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset % 4 !== 0) return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
  return { offset, count };
}

/**
 * null when mesh.json and its data part are structurally sound, else what is
 * wrong (spec section 13). "data" names the mesh-data part; each body has
 * "id", "number", "faces" (face names), "positions" {offset (bytes), count
 * (vertices, 3 little-endian float32 each, mm)}, "indices" {offset, count
 * (uint32, a multiple of 3)}, "triangleFaces" {offset, count (one uint32 per
 * triangle: an index into faces)} and "min"/"max" (its bounding box).
 */
export function meshProblem(json: unknown, bin: Uint8Array, dataPath: string): string | null {
  if (!isObject(json)) return 'not a JSON object';
  if (json.version !== 1) return '"version" is not 1';
  if (json.data !== dataPath) return `"data" does not name the mesh-data part ${dataPath}`;
  if (!Array.isArray(json.bodies)) return '"bodies" is not a list';
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const fits = (s: Span, width: number): boolean => s.offset + s.count * width <= bin.length;
  for (const [b, body] of json.bodies.entries()) {
    const at = `bodies[${b}]`;
    if (!isObject(body)) return `${at} is not an object`;
    if (typeof body.id !== 'string' || !body.id.startsWith('body:')) return `${at}.id does not start "body:"`;
    if (typeof body.number !== 'number' || !Number.isInteger(body.number) || body.number < 1) return `${at}.number is not a counting number`;
    const faces = body.faces;
    if (!Array.isArray(faces) || !faces.every((n) => typeof n === 'string' && n.startsWith('face:'))) {
      return `${at}.faces is not a list of face names`;
    }
    const { min, max } = body;
    if (!isVector(min) || !isVector(max) || !numbersInRange([min, max]) ||
      !(min as number[]).every((x, k) => x <= (max as number[])[k]!)) {
      return `${at}.min/max is not a bounding box within 1 km`;
    }
    const positions = span(body.positions);
    const indices = span(body.indices);
    const triangleFaces = span(body.triangleFaces);
    if (!positions || !indices || !triangleFaces) return `${at} needs positions, indices and triangleFaces as {offset, count}`;
    if (!fits(positions, 12)) return `${at}.positions runs past the data part`;
    if (!fits(indices, 4)) return `${at}.indices runs past the data part`;
    if (!fits(triangleFaces, 4)) return `${at}.triangleFaces runs past the data part`;
    if (indices.count % 3 !== 0) return `${at}.indices count is not a multiple of 3`;
    if (triangleFaces.count !== indices.count / 3) return `${at}.triangleFaces count is not one per triangle`;
    for (let k = 0; k < positions.count * 3; k++) {
      const x = view.getFloat32(positions.offset + 4 * k, true);
      if (!Number.isFinite(x) || Math.abs(x) > MAX_COORDINATE) return `${at} has a position not finite or beyond 1 km`;
    }
    for (let k = 0; k < indices.count; k++) {
      if (view.getUint32(indices.offset + 4 * k, true) >= positions.count) return `${at}.indices[${k}] is not a vertex index`;
    }
    for (let k = 0; k < triangleFaces.count; k++) {
      if (view.getUint32(triangleFaces.offset + 4 * k, true) >= faces.length) return `${at}.triangleFaces[${k}] is not a face index`;
    }
  }
  return null;
}

/** null when the bytes start like the image the media type names. */
export function thumbnailProblem(mediaType: string, bytes: Uint8Array): string | null {
  const starts = (sig: number[], at = 0): boolean => sig.every((b, i) => bytes[at + i] === b);
  if (mediaType === 'image/png') {
    return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : 'not a PNG file';
  }
  // RIFF....WEBP
  return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8) ? null : 'not a WebP file';
}
