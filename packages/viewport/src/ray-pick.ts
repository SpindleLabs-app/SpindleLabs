// The first face a ray meets on the body (big designs speed pass): the same
// answer as three.js's `raycaster.intersectObject(mesh, false)[0]`, found
// through a box tree over the triangles instead of testing every triangle.
//
// Why it gives the same answer: a hover looks up the first face under the
// pointer (and, for an edge, whether a face hides it) several times a move,
// and three.js tests every triangle of the body each time, which on a
// hundred curved bodies is tens of milliseconds a move. The tree only says
// which triangles cannot be nearer than the best hit so far; every triangle
// it keeps is tested by exactly three.js's steps (the same bounding sphere
// and box checks first, the ray taken into the mesh's space the same way,
// the same triangle test for the material's side, the same distance in the
// world and the same near/far cut), and among equal distances the lowest
// triangle number wins, as three.js's stable sort of hits in triangle order
// gives. A box is skipped only when the ray enters it clearly beyond the
// best hit (BOX_SLACK), and every box is padded, so rounding in the box test
// can never drop a triangle that three.js would hit first.

import * as THREE from "three";

/** The first hit: its distance from the ray's origin (world) and its triangle number (indexed buffer semantics). */
export interface RayHit {
  distance: number;
  faceIndex: number;
}

/** Triangles a leaf of the tree holds at most. */
const LEAF = 8;
/**
 * How much nearer than its entry point a box's triangles may still be,
 * relative to the distances involved: a box is skipped only when the ray
 * enters it more than this beyond the best hit. Rounding in the slab test and
 * the gap between a distance along the ray and three.js's world distance are
 * near 1e-15 relative; 1e-9 leaves a wide margin and costs nothing.
 */
const BOX_SLACK = 1e-9;

/** A bounding-box tree over a mesh's triangles: per node its box (padded), then either two children or a run of triangles. */
export class TriangleTree {
  /** Per node: min x y z, max x y z. */
  readonly boxes: Float64Array;
  /** Per node: the first child (the second follows it at `right`), or −1 for a leaf. */
  readonly left: Int32Array;
  readonly right: Int32Array;
  /** Per leaf node: where its triangles start in `order`, and how many. */
  readonly start: Int32Array;
  readonly count: Int32Array;
  /** Triangle numbers, grouped by leaf. */
  readonly order: Int32Array;
  readonly nodes: number;

  constructor(positions: ArrayLike<number>, index: ArrayLike<number>, triangles: number) {
    const centre = new Float64Array(3 * triangles);
    const lo = new Float64Array(3 * triangles);
    const hi = new Float64Array(3 * triangles);
    for (let t = 0; t < triangles; t++)
      for (let k = 0; k < 3; k++) {
        let mn = Infinity;
        let mx = -Infinity;
        for (let v = 0; v < 3; v++) {
          const x = positions[3 * index[3 * t + v] + k];
          if (x < mn) mn = x;
          if (x > mx) mx = x;
        }
        lo[3 * t + k] = mn;
        hi[3 * t + k] = mx;
        centre[3 * t + k] = (mn + mx) / 2;
      }
    const order = new Int32Array(triangles);
    for (let t = 0; t < triangles; t++) order[t] = t;
    const most = Math.max(1, 2 * triangles);
    const boxes = new Float64Array(6 * most);
    const left = new Int32Array(most).fill(-1);
    const right = new Int32Array(most).fill(-1);
    const start = new Int32Array(most);
    const count = new Int32Array(most);
    let nodes = 0;
    // The whole mesh's size, for padding each box against rounding (a triangle lying exactly on a box face).
    let extent = 0;
    for (let i = 0; i < positions.length; i++) extent = Math.max(extent, Math.abs(positions[i]));
    const pad = 1e-7 * (extent + 1);
    const stack: [number, number, number][] = [];
    const make = (from: number, to: number): number => {
      const node = nodes++;
      const b = 6 * node;
      boxes.fill(Infinity, b, b + 3);
      boxes.fill(-Infinity, b + 3, b + 6);
      for (let i = from; i < to; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) {
          if (lo[3 * t + k] < boxes[b + k]) boxes[b + k] = lo[3 * t + k];
          if (hi[3 * t + k] > boxes[b + 3 + k]) boxes[b + 3 + k] = hi[3 * t + k];
        }
      }
      for (let k = 0; k < 3; k++) {
        boxes[b + k] -= pad;
        boxes[b + 3 + k] += pad;
      }
      start[node] = from;
      count[node] = to - from;
      if (to - from > LEAF) stack.push([node, from, to]);
      return node;
    };
    make(0, triangles);
    while (stack.length > 0) {
      const [node, from, to] = stack.pop()!;
      // Split at the middle of the centres along the box's longest side (the median when that leaves one side empty).
      const b = 6 * node;
      let axis = 0;
      for (let k = 1; k < 3; k++) if (boxes[b + 3 + k] - boxes[b + k] > boxes[b + 3 + axis] - boxes[b + axis]) axis = k;
      let cmin = Infinity;
      let cmax = -Infinity;
      for (let i = from; i < to; i++) {
        const c = centre[3 * order[i] + axis];
        if (c < cmin) cmin = c;
        if (c > cmax) cmax = c;
      }
      const mid = (cmin + cmax) / 2;
      let i = from;
      let j = to - 1;
      while (i <= j) {
        if (centre[3 * order[i] + axis] < mid) i++;
        else {
          const swap = order[i];
          order[i] = order[j];
          order[j] = swap;
          j--;
        }
      }
      let split = i;
      if (split === from || split === to) {
        // Every centre on one side (all equal along the axis): halve the run by sorting it.
        const run = Array.from(order.subarray(from, to)).sort((p, q) => centre[3 * p + axis] - centre[3 * q + axis] || p - q);
        order.set(run, from);
        split = (from + to) >> 1;
      }
      left[node] = make(from, split);
      right[node] = make(split, to);
    }
    this.boxes = boxes;
    this.left = left;
    this.right = right;
    this.start = start;
    this.count = count;
    this.order = order;
    this.nodes = nodes;
  }

  /**
   * Where the ray (origin o, direction d) enters this node's box, as a
   * parameter along d (0 when it starts inside), or Infinity when it misses.
   */
  entry(node: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const b = 6 * node;
    let near = 0;
    let far = Infinity;
    const slab = (o: number, d: number, mn: number, mx: number): boolean => {
      if (d === 0) return o >= mn && o <= mx;
      let t0 = (mn - o) / d;
      let t1 = (mx - o) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      if (t0 > near) near = t0;
      if (t1 < far) far = t1;
      return near <= far;
    };
    if (!slab(ox, dx, this.boxes[b], this.boxes[b + 3])) return Infinity;
    if (!slab(oy, dy, this.boxes[b + 1], this.boxes[b + 4])) return Infinity;
    if (!slab(oz, dz, this.boxes[b + 2], this.boxes[b + 5])) return Infinity;
    return near;
  }
}

const trees = new WeakMap<THREE.BufferGeometry, { tree: TriangleTree; position: THREE.BufferAttribute; positionVersion: number; index: THREE.BufferAttribute; indexVersion: number }>();

/** The geometry's tree, built on first use and again whenever its positions or index change. */
export function treeOf(geometry: THREE.BufferGeometry): TriangleTree | null {
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const index = geometry.index;
  if (!position || !index || position.itemSize !== 3 || (position as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return null;
  const was = trees.get(geometry);
  if (was && was.position === position && was.positionVersion === position.version && was.index === index && was.indexVersion === index.version) return was.tree;
  const tree = new TriangleTree(position.array, index.array, Math.floor(index.count / 3));
  trees.set(geometry, { tree, position, positionVersion: position.version, index, indexVersion: index.version });
  return tree;
}

const sphere = new THREE.Sphere();
const local = new THREE.Ray();
const inverse = new THREE.Matrix4();
const sphereHit = new THREE.Vector3();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const point = new THREE.Vector3();
const world = new THREE.Vector3();

/**
 * The first face `raycaster` meets on `mesh`: the distance and triangle of
 * `raycaster.intersectObject(mesh, false)[0]`, or null where that is
 * undefined. Meshes the tree does not cover (no index, groups or several
 * materials, a draw range, morphs, a transform) go to three.js itself.
 */
export function firstHit(mesh: THREE.Mesh, raycaster: THREE.Raycaster): RayHit | null {
  const geometry = mesh.geometry;
  const material = mesh.material;
  const plain =
    !Array.isArray(material) &&
    material !== undefined &&
    geometry.index !== null &&
    geometry.drawRange.start === 0 &&
    geometry.drawRange.count === Infinity &&
    Object.keys(geometry.morphAttributes).length === 0 &&
    mesh.layers.test(raycaster.layers) &&
    mesh.matrixWorld.equals(IDENTITY) &&
    (mesh as THREE.Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh !== true &&
    mesh.raycast === THREE.Mesh.prototype.raycast;
  const tree = plain ? treeOf(geometry) : null;
  if (!tree) {
    const [hit] = raycaster.intersectObject(mesh, false);
    return hit && hit.faceIndex != null ? { distance: hit.distance, faceIndex: hit.faceIndex } : hit ? { distance: hit.distance, faceIndex: NaN } : null;
  }
  // Mesh.raycast's checks, step for step: the bounding sphere in the world, then the bounding box in the mesh's space.
  const matrixWorld = mesh.matrixWorld;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  sphere.copy(geometry.boundingSphere!);
  sphere.applyMatrix4(matrixWorld);
  local.copy(raycaster.ray).recast(raycaster.near);
  if (sphere.containsPoint(local.origin) === false) {
    if (local.intersectSphere(sphere, sphereHit) === null) return null;
    if (local.origin.distanceToSquared(sphereHit) > (raycaster.far - raycaster.near) ** 2) return null;
  }
  inverse.copy(matrixWorld).invert();
  local.copy(raycaster.ray).applyMatrix4(inverse);
  if (geometry.boundingBox !== null && local.intersectsBox(geometry.boundingBox) === false) return null;

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const index = geometry.index!;
  const side = (material as THREE.Material).side;
  const { x: ox, y: oy, z: oz } = local.origin;
  const { x: dx, y: dy, z: dz } = local.direction;
  let best: RayHit | null = null;
  const stack = [0];
  const entries = [tree.entry(0, ox, oy, oz, dx, dy, dz)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const enter = entries.pop()!;
    if (enter === Infinity) continue;
    if (best && enter > best.distance + BOX_SLACK * (1 + best.distance)) continue;
    const l = tree.left[node];
    if (l >= 0) {
      const r = tree.right[node];
      const el = tree.entry(l, ox, oy, oz, dx, dy, dz);
      const er = tree.entry(r, ox, oy, oz, dx, dy, dz);
      // The nearer child is visited first (pushed last).
      if (el <= er) {
        stack.push(r, l);
        entries.push(er, el);
      } else {
        stack.push(l, r);
        entries.push(el, er);
      }
      continue;
    }
    for (let i = tree.start[node], end = i + tree.count[node]; i < end; i++) {
      const t = tree.order[i];
      vA.fromBufferAttribute(position, index.getX(3 * t));
      vB.fromBufferAttribute(position, index.getX(3 * t + 1));
      vC.fromBufferAttribute(position, index.getX(3 * t + 2));
      const hit = side === THREE.BackSide ? local.intersectTriangle(vC, vB, vA, true, point) : local.intersectTriangle(vA, vB, vC, side === THREE.FrontSide, point);
      if (hit === null) continue;
      world.copy(point).applyMatrix4(matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(world);
      if (distance < raycaster.near || distance > raycaster.far) continue;
      if (!best || distance < best.distance || (distance === best.distance && t < best.faceIndex)) best = { distance, faceIndex: t };
    }
  }
  return best;
}

const IDENTITY = new THREE.Matrix4();
