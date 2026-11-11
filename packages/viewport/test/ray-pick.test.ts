import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { firstHit, TriangleTree } from "../src/ray-pick.ts";

/** A seeded generator (same seed, same rays), uniform in [0, 1). */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Many closed cylinders on a grid, each side and cap its own vertices (as the kernel's display mesh gives per face), and a few loose triangles. */
function bodies(rnd: () => number, count: number, segments: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, y: number, z: number) => (positions.push(x, y, z), positions.length / 3 - 1);
  for (let b = 0; b < count; b++) {
    const cx = (b % 5) * 30;
    const cy = Math.floor(b / 5) * 30;
    const r = 4 + rnd() * 9;
    const h = 5 + rnd() * 30;
    const ring = (z: number) => Array.from({ length: segments }, (_, i) => vertex(cx + r * Math.cos((2 * Math.PI * i) / segments), cy + r * Math.sin((2 * Math.PI * i) / segments), z));
    const lo = ring(0);
    const hi = ring(h);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      indices.push(lo[i], lo[j], hi[j], lo[i], hi[j], hi[i]); // the side, facing out
    }
    for (const [z, up] of [[0, false], [h, true]] as const) {
      const centre = vertex(cx, cy, z);
      const rim = ring(z);
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments;
        indices.push(...(up ? [centre, rim[i], rim[j]] : [centre, rim[j], rim[i]]));
      }
    }
  }
  for (let k = 0; k < 40; k++) {
    const p = () => [rnd() * 150 - 10, rnd() * 150 - 10, rnd() * 40 - 5] as const;
    indices.push(vertex(...p()), vertex(...p()), vertex(...p()));
  }
  return { positions, indices };
}

function meshOf(positions: number[], indices: number[], side: THREE.Side) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side }));
  mesh.updateMatrixWorld();
  return mesh;
}

/** What three.js itself says: the first of its sorted hits. */
function threeHit(mesh: THREE.Mesh, raycaster: THREE.Raycaster) {
  const [hit] = raycaster.intersectObject(mesh, false);
  return hit ? { distance: hit.distance, faceIndex: hit.faceIndex } : null;
}

test("a ray straight down onto a square finds the first face, worked by hand", () => {
  // Two triangles making the unit square at z = 0 (facing +z), and a second square at z = −2 under it.
  // A ray from (0.25, 0.75, 5) straight down meets z = 0 after 5 mm, in triangle 1 ((0,0) (1,1) (0,1): y > x there).
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, -2, 1, 0, -2, 1, 1, -2, 0, 1, -2];
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const mesh = meshOf(positions, indices, THREE.FrontSide);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0.25, 0.75, 5), new THREE.Vector3(0, 0, -1));
  assert.deepEqual(firstHit(mesh, raycaster), { distance: 5, faceIndex: 1 });
  // From underneath, the front-side squares face away: nothing is hit (three.js culls back faces of a front-side material).
  raycaster.set(new THREE.Vector3(0.25, 0.75, -5), new THREE.Vector3(0, 0, 1));
  assert.equal(firstHit(mesh, raycaster), null);
  // Double-sided, the lower square is first from below: 5 − 2 = 3 mm, triangle 3.
  (mesh.material as THREE.Material).side = THREE.DoubleSide;
  assert.deepEqual(firstHit(mesh, raycaster), { distance: 3, faceIndex: 3 });
  // Far set short of it: no hit; a ray beside the squares: none either.
  raycaster.far = 2.9;
  assert.equal(firstHit(mesh, raycaster), null);
  raycaster.far = Infinity;
  raycaster.set(new THREE.Vector3(3, 3, 5), new THREE.Vector3(0, 0, -1));
  assert.equal(firstHit(mesh, raycaster), null);
});

test("a ray through the shared corner of two triangles picks the lower-numbered one, as three.js's stable sort does", () => {
  // The square's diagonal from (0,0) to (1,1) is shared by triangles 0 and 1; a ray down through (0.5, 0.5)
  // meets both at exactly 5 mm, and three.js lists hits in triangle order before a stable sort: triangle 0.
  const mesh = meshOf([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3], THREE.FrontSide);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0.5, 0.5, 5), new THREE.Vector3(0, 0, -1));
  assert.deepEqual(threeHit(mesh, raycaster), { distance: 5, faceIndex: 0 });
  assert.deepEqual(firstHit(mesh, raycaster), { distance: 5, faceIndex: 0 });
});

test("the same face and distance as three.js on seeded rays over many bodies (pointer rays, rays to vertices, edge points and from inside)", () => {
  for (const side of [THREE.FrontSide, THREE.DoubleSide, THREE.BackSide]) {
    for (const seed of [1, 2, 3]) {
      const rnd = seeded(seed * 7 + side);
      const { positions, indices } = bodies(rnd, 25, 24 + seed * 8);
      const mesh = meshOf(positions, indices, side);
      const raycaster = new THREE.Raycaster();
      const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 100000);
      let compared = 0;
      let hits = 0;
      for (let n = 0; n < 600; n++) {
        const kind = n % 4;
        camera.position.set(rnd() * 400 - 130, rnd() * 400 - 130, rnd() * 300 - 50);
        camera.lookAt(60 + rnd() * 20, 60 + rnd() * 20, 10);
        camera.updateMatrixWorld();
        if (kind === 0) raycaster.setFromCamera(new THREE.Vector2(rnd() * 2 - 1, rnd() * 2 - 1), camera);
        else {
          // Towards a vertex, a point along a triangle's side (as edgeAt and cornerAt aim), or from inside the bounds.
          const t = Math.floor(rnd() * (indices.length / 3));
          const a = new THREE.Vector3().fromArray(positions, 3 * indices[3 * t]);
          const b = new THREE.Vector3().fromArray(positions, 3 * indices[3 * t + 1]);
          const target = kind === 1 ? a : a.clone().lerp(b, rnd());
          const from = kind === 3 ? new THREE.Vector3(rnd() * 130, rnd() * 130, rnd() * 30) : camera.position;
          raycaster.set(from, target.clone().sub(from).normalize());
        }
        raycaster.near = n % 9 === 0 ? 5 : 0;
        raycaster.far = n % 11 === 0 ? 50 : Infinity;
        const want = threeHit(mesh, raycaster);
        assert.deepEqual(firstHit(mesh, raycaster), want, `side ${side} seed ${seed} ray ${n}`);
        compared++;
        if (want) hits++;
      }
      assert.equal(compared, 600);
      assert.ok(hits > 150, `enough rays hit something to count (${hits})`);
    }
  }
});

test("a mesh the tree does not cover (moved by its transform) still gives three.js's answer", () => {
  const rnd = seeded(5);
  const { positions, indices } = bodies(rnd, 4, 16);
  const mesh = meshOf(positions, indices, THREE.FrontSide);
  mesh.position.set(10, -5, 3);
  mesh.scale.set(2, 2, 2);
  mesh.updateMatrixWorld();
  const raycaster = new THREE.Raycaster();
  for (let n = 0; n < 100; n++) {
    raycaster.set(new THREE.Vector3(rnd() * 100, rnd() * 100, 120), new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, -1).normalize());
    assert.deepEqual(firstHit(mesh, raycaster), threeHit(mesh, raycaster));
  }
});

test("the tree holds every triangle once, each inside its leaf's box", () => {
  const rnd = seeded(9);
  const { positions, indices } = bodies(rnd, 10, 20);
  const triangles = indices.length / 3;
  const tree = new TriangleTree(new Float32Array(positions), indices, triangles);
  assert.deepEqual([...tree.order].sort((a, b) => a - b), Array.from({ length: triangles }, (_, i) => i));
  for (let node = 0; node < tree.nodes; node++) {
    if (tree.left[node] >= 0) continue;
    for (let i = tree.start[node]; i < tree.start[node] + tree.count[node]; i++)
      for (let v = 0; v < 3; v++)
        for (let k = 0; k < 3; k++) {
          const x = Math.fround(positions[3 * indices[3 * tree.order[i] + v] + k]);
          assert.ok(x >= tree.boxes[6 * node + k] && x <= tree.boxes[6 * node + 3 + k]);
        }
  }
  // A changed position array is a new tree: the same geometry with moved points gives three.js's new answer.
  const mesh = meshOf(positions, indices, THREE.FrontSide);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, -1));
  assert.deepEqual(firstHit(mesh, raycaster), threeHit(mesh, raycaster));
  const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 7);
  p.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();
  assert.deepEqual(firstHit(mesh, raycaster), threeHit(mesh, raycaster));
});
