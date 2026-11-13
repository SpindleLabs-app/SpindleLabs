// The outer box of a laser drawing (step Q2): lines, circular and elliptical arcs and Bézier curves, each after an
// affine map (an SVG transform, a DXF block's placement), boxed exactly. This is a yes/no fit check of a whole drawing
// against a bed, not 2D geometry the app builds on: the kernel's 2D curve library (docs/integration.md, decision 5)
// has no Béziers yet (Vector V1), and when it has, this moves there.
//
// The maths, each worked from the curve's own formula:
// - a line's box is its ends' box;
// - an elliptical arc, any affine image of a circle's arc, is p(θ) = c + u cos θ + v sin θ for θ from θ0 through a
//   sweep; x is extreme where dx/dθ = −ux sin θ + vx cos θ = 0, at θ = atan2(vx, ux) and that plus π (likewise y), so
//   its box is its ends' and those of the four angles that lie inside the sweep;
// - a Bézier curve's affine image is the Bézier of its control points' images; x of a cubic is extreme where its
//   derivative, the quadratic a t² + b t + c with a = −p0 + 3p1 − 3p2 + p3, b = 2(p0 − 2p1 + p2), c = p1 − p0, is 0
//   for t in (0, 1); a quadratic's derivative is linear, 0 at t = (p0 − p1) / (p0 − 2p1 + p2).

export type Pt = [number, number];

/** An affine map [a, b, c, d, e, f]: (x, y) to (a x + c y + e, b x + d y + f), the order SVG's matrix() uses. */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** `outer` after `inner`: the map that does inner first, then outer. */
export function compose(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export function map(m: Affine, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** The map of a direction (no shift). */
export function mapDir(m: Affine, v: Pt): Pt {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

/** A box growing as points are added; empty until the first. */
export class Box {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  get empty(): boolean {
    return !(this.minX <= this.maxX);
  }
  get width(): number {
    return this.empty ? 0 : this.maxX - this.minX;
  }
  get height(): number {
    return this.empty ? 0 : this.maxY - this.minY;
  }
  add(p: Pt): void {
    if (p[0] < this.minX) this.minX = p[0];
    if (p[0] > this.maxX) this.maxX = p[0];
    if (p[1] < this.minY) this.minY = p[1];
    if (p[1] > this.maxY) this.maxY = p[1];
  }
  addBox(b: Box): void {
    if (b.empty) return;
    this.add([b.minX, b.minY]);
    this.add([b.maxX, b.maxY]);
  }
  /** True while every number put in was finite. */
  get finite(): boolean {
    return this.empty || [this.minX, this.minY, this.maxX, this.maxY].every(Number.isFinite);
  }
}

const TAU = 2 * Math.PI;

/** Whether angle θ lies on the sweep from θ0 through `sweep` (either way round; a sweep of 2π or more is everything). */
export function onSweep(theta: number, theta0: number, sweep: number): boolean {
  if (Math.abs(sweep) >= TAU) return true;
  const along = sweep >= 0 ? theta - theta0 : theta0 - theta;
  const turned = ((along % TAU) + TAU) % TAU;
  return turned <= Math.abs(sweep);
}

/** Adds the arc p(θ) = c + u cos θ + v sin θ, θ from θ0 through `sweep` (radians), mapped by `m`. */
export function addArc(box: Box, m: Affine, c: Pt, u: Pt, v: Pt, theta0: number, sweep: number): void {
  const C = map(m, c);
  const U = mapDir(m, u);
  const V = mapDir(m, v);
  const at = (t: number): Pt => [C[0] + U[0] * Math.cos(t) + V[0] * Math.sin(t), C[1] + U[1] * Math.cos(t) + V[1] * Math.sin(t)];
  box.add(at(theta0));
  box.add(at(theta0 + sweep));
  for (const axis of [0, 1]) {
    const t = Math.atan2(V[axis] as number, U[axis] as number);
    for (const s of [t, t + Math.PI]) if (onSweep(s, theta0, sweep)) box.add(at(s));
  }
}

/** Adds a straight line from p to q, mapped by `m`. */
export function addLine(box: Box, m: Affine, p: Pt, q: Pt): void {
  box.add(map(m, p));
  box.add(map(m, q));
}

/** The roots in (0, 1) of a t² + b t + c, the scale of the numbers deciding what counts as no t² term. */
export function unitRoots(a: number, b: number, c: number): number[] {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0) return [];
  const out: number[] = [];
  if (Math.abs(a) <= 1e-12 * scale) {
    if (b !== 0) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      // The root without cancellation first, the other from the product of roots (c / a).
      const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
      out.push(q / a);
      if (q !== 0) out.push(c / q);
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** Adds the cubic Bézier with control points p0..p3, mapped by `m`. */
export function addCubic(box: Box, m: Affine, p0: Pt, p1: Pt, p2: Pt, p3: Pt): void {
  const [P0, P1, P2, P3] = [p0, p1, p2, p3].map((p) => map(m, p)) as [Pt, Pt, Pt, Pt];
  box.add(P0);
  box.add(P3);
  const at = (t: number): Pt => {
    const s = 1 - t;
    const k = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t] as const;
    return [k[0] * P0[0] + k[1] * P1[0] + k[2] * P2[0] + k[3] * P3[0], k[0] * P0[1] + k[1] * P1[1] + k[2] * P2[1] + k[3] * P3[1]];
  };
  for (const i of [0, 1]) {
    const a = -P0[i]! + 3 * P1[i]! - 3 * P2[i]! + P3[i]!;
    const b = 2 * (P0[i]! - 2 * P1[i]! + P2[i]!);
    const c = P1[i]! - P0[i]!;
    for (const t of unitRoots(a, b, c)) box.add(at(t));
  }
}

/** Adds the quadratic Bézier with control points p0..p2, mapped by `m`. */
export function addQuadratic(box: Box, m: Affine, p0: Pt, p1: Pt, p2: Pt): void {
  const [P0, P1, P2] = [p0, p1, p2].map((p) => map(m, p)) as [Pt, Pt, Pt];
  box.add(P0);
  box.add(P2);
  for (const i of [0, 1]) {
    const den = P0[i]! - 2 * P1[i]! + P2[i]!;
    if (den === 0) continue;
    const t = (P0[i]! - P1[i]!) / den;
    if (t > 0 && t < 1) {
      const s = 1 - t;
      box.add([s * s * P0[0] + 2 * s * t * P1[0] + t * t * P2[0], s * s * P0[1] + 2 * s * t * P1[1] + t * t * P2[1]]);
    }
  }
}

/**
 * The arc between p and q with a DXF bulge b (the tangent of a quarter of the angle it turns through; positive turns
 * left, counter-clockwise), as centre, start angle and sweep; null for b = 0 or p = q (a straight line, or nothing).
 * The chord's half-length h and the sweep 4 atan b give the radius h / sin(sweep / 2); the centre lies off the
 * chord's middle, to the left for a positive bulge, by the radius times cos(sweep / 2).
 */
export function bulgeArc(p: Pt, q: Pt, b: number): { c: Pt; r: number; theta0: number; sweep: number } | null {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const chord = Math.hypot(dx, dy);
  if (b === 0 || chord === 0 || !Number.isFinite(b)) return null;
  const sweep = 4 * Math.atan(b);
  const r = chord / 2 / Math.abs(Math.sin(sweep / 2));
  // Distance from the chord's middle to the centre, signed along the chord's left normal.
  const off = (chord / 2) / Math.tan(sweep / 2);
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  const c: Pt = [mx - (dy / chord) * off, my + (dx / chord) * off];
  return { c, r, theta0: Math.atan2(p[1] - c[1], p[0] - c[0]), sweep };
}
