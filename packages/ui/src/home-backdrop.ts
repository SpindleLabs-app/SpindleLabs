// The home screen's living background: slowly drifting circuit-style lines, the design you carry on with turning in
// the middle as thin lines, and a pulse that sweeps up it and brightens what it passes. Drawn on one 2D canvas, behind
// the screen's words (aria-hidden, no pointer), kept light on purpose: at most 30 frames a second, at most about 1,500
// segments, the pixel ratio capped at 1.5, nothing at all while the tab is hidden or the screen is closed. Under
// prefers-reduced-motion, on a weak machine (`lowEnd`) or once a frame proves slow it draws one still picture instead.
// The pure parts (the shape's fit, the projection, the pulse, the drifting lines, the low-end rule) are tested by hand
// in test/home-backdrop.test.ts. Styles: the end of src/styles/home-screen.css.
import { formatLength, type Unit } from "@fission/core";
import { currentUnit } from "./unit-choice.ts";

/** The cube shown when the project has no shape to show: 12 edges, as pairs of x y z points, half-size 1. */
export const NEUTRAL_SHAPE: readonly number[] = (() => {
  const c = (i: number) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1];
  const out: number[] = [];
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) out.push(...c(i), ...c(i | bit));
  return out;
})();

export const MAX_SEGMENTS = 1500;
export const FRAME_MS = 1000 / 30;
export const MAX_ALPHA = 0.5; // the brightest a pulsed line gets: words on top stay readable
export const BASE_ALPHA = 0.16;
/** Steps of brightness the shape's lines are batched into. */
export const BUCKETS = 10;
export const PULSE_SECONDS = 7;
export const TURN_SECONDS = 28;
export const PITCH = 0.42;
export const CAMERA = 5;

/**
 * The edges (pairs of x y z points) centred on their box's middle and scaled so the farthest point from it is 1, cut to
 * at most `max` segments by keeping every n-th. Null when there is nothing to draw: no segment, a bad number, or every
 * point the same.
 */
export function fitShape(lines: ArrayLike<number> | null | undefined, max = MAX_SEGMENTS): Float32Array | null {
  if (!lines) return null;
  const count = Math.floor(lines.length / 6);
  if (count === 0) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count * 6; i++) {
    const v = lines[i];
    if (!Number.isFinite(v)) return null;
    lo[i % 3] = Math.min(lo[i % 3], v);
    hi[i % 3] = Math.max(hi[i % 3], v);
  }
  const mid = lo.map((l, k) => (l + hi[k]) / 2);
  const radius = Math.max(...lo.map((l, k) => Math.max(hi[k] - mid[k], mid[k] - l)));
  if (!(radius > 0)) return null;
  const step = Math.max(1, Math.ceil(count / max));
  const kept = Math.ceil(count / step);
  const out = new Float32Array(kept * 6);
  for (let n = 0; n < kept; n++) for (let j = 0; j < 6; j++) out[n * 6 + j] = (lines[n * step * 6 + j] - mid[j % 3]) / radius;
  return out;
}

export interface Projected {
  /** Screen offset from the middle, in units of the shape's radius (y down). */
  x: number;
  y: number;
  /** Nearer is smaller; 0 is the middle's distance. */
  depth: number;
  /** The height before turning, up is +1: what the pulse sweeps along. */
  height: number;
}

/** A point turned `yaw` about the up (z) axis, tipped towards the viewer by `pitch`, seen from `camera` away. Pure. */
export function project(x: number, y: number, z: number, yaw: number, pitch = PITCH, camera = CAMERA): Projected {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rx = x * c - y * s;
  const ry = x * s + y * c; // the depth axis before tipping
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const up = z * cp - ry * sp;
  const depth = z * sp + ry * cp;
  const k = camera / (camera + depth);
  return { x: rx * k, y: -up * k, depth, height: z };
}

/**
 * The brightness (0..1) of a line at `height` (-1..1) at `seconds`: a faint base, a bright band that climbs the shape once
 * every PULSE_SECONDS and is about 0.3 tall, and a slow breathing of the whole. Never above 1, never below the base.
 */
export function pulse(height: number, seconds: number): number {
  const front = scanHeight(seconds); // the band's middle: starts below the shape, ends above it
  const d = (height - front) / 0.3;
  const band = Math.exp(-d * d);
  const breath = 0.9 + 0.1 * Math.sin(seconds * 0.9);
  return Math.min(1, (0.32 + 0.68 * band) * breath);
}

/** The scan band's middle height at `seconds` (the same band as `pulse`'s). Pure. */
export const scanHeight = (seconds: number): number => ((seconds / PULSE_SECONDS) % 1) * 2.8 - 1.4;

/**
 * The whole shape's extra brightness (0..0.6) as the band reaches the top, about 8.6 tenths of the way through each pulse:
 * a short flash that fades over about half a second either side. Pure.
 */
export function flash(seconds: number): number {
  const d = (((seconds / PULSE_SECONDS) % 1) - FLASH_AT) / 0.05;
  return 0.6 * Math.exp(-d * d);
}
export const FLASH_AT = 0.86;

/** How far the turntable's ripple has spread (0..1) in the first 40% of each pulse, else null (no ripple). Pure. */
export function ripple(seconds: number): number | null {
  const phase = (seconds / PULSE_SECONDS) % 1;
  return phase < 0.4 ? phase / 0.4 : null;
}

/** The lowest height of a fitted shape (its z), -1 for none. Pure. */
export function floorOf(shape: ArrayLike<number>): number {
  let lo = Infinity;
  for (let i = 2; i < shape.length; i += 3) lo = Math.min(lo, shape[i]);
  return Number.isFinite(lo) ? lo : -1;
}

/** The red, green and blue (0..255) of a #rgb, #rrggbb or rgb() colour; null when it can't be read. Pure. */
export function rgbOf(colour: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const m = colour.match(/[\d.]+/g);
  return /^\s*rgba?\(/.test(colour) && m && m.length >= 3 ? (m.slice(0, 3).map(Number) as [number, number, number]) : null;
}

/** Relative luminance (0..1, WCAG) of a colour `rgbOf` reads; 0 when it can't be read. Pure. */
export function luminance(colour: string): number {
  const rgb = rgbOf(colour);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The size of the edges' box along x, y and z (in their own unit), or null when `fitShape` would draw nothing. Pure. */
export function extentOf(lines: ArrayLike<number> | null | undefined): [number, number, number] | null {
  if (!fitShape(lines, 1) || !lines) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < Math.floor(lines.length / 6) * 6; i++) {
    lo[i % 3] = Math.min(lo[i % 3], lines[i]);
    hi[i % 3] = Math.max(hi[i % 3], lines[i]);
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

/** The size label under the turntable: "61.4 × 56.9 × 22 mm" (millimetres in, shown in `unit`). Pure. */
export function sizeWords([x, y, z]: readonly number[], unit: Unit): string {
  const n = (mm: number) => formatLength(mm, unit).split(" ")[0];
  return `${n(x)} × ${n(y)} × ${formatLength(z, unit)}`;
}

export interface Placement {
  cx: number;
  cy: number;
  /** Pixels for the shape's radius of 1. */
  scale: number;
}

/**
 * Where the turning shape goes in a `w` × `h` window whose words end `top` pixels down: centred across, and in the room
 * under the words when it fits there (the picture from the corner marks' top, 1.45 radii above the middle, to the size
 * label's foot, about 1.65 radii and 40 px below: 3.1 radii and 40 px in all, with 16 px kept above and below). It is
 * never smaller than MIN_SCALE of the window's short side (it then stands at the window's foot, partly under the words)
 * nor larger than MAX_SCALE. Pure.
 */
export function placeShape(w: number, h: number, top: number): Placement {
  const short = Math.min(w, h);
  const free = h - Math.max(0, top);
  const scale = Math.max(MIN_SCALE * short, Math.min(MAX_SCALE * short, (free - 40 - 32) / 3.1));
  const block = 3.1 * scale + 40;
  const blockTop = free - 32 >= block ? h - free + 16 + (free - 32 - block) / 2 : h - block - 16;
  return { cx: w / 2, cy: blockTop + 1.45 * scale, scale };
}
export const MIN_SCALE = 0.17;
export const MAX_SCALE = 0.3;

/** Small seeded generator (mulberry32): the same seed gives the same lines. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Trace {
  /** Corner points relative to the trace's start; every step is along an axis or a 45° diagonal. */
  points: { x: number; y: number }[];
  x: number;
  y: number;
  /** Drift in pixels a second. */
  vx: number;
  vy: number;
  /** Where the bright dash starts along it, 0..1, and how fast it runs (fractions a second). */
  dash: number;
  speed: number;
  /** Total length in pixels. */
  length: number;
}

/** `count` drifting traces for a `w` × `h` window. Pure and seeded. */
export function makeTraces(seed: number, count: number, w: number, h: number): Trace[] {
  const rnd = seeded(seed);
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 1], [-1, 0], [0, -1], [-1, -1]];
  const out: Trace[] = [];
  for (let i = 0; i < count; i++) {
    const points = [{ x: 0, y: 0 }];
    let length = 0;
    const turns = 2 + Math.floor(rnd() * 3);
    let last = Math.floor(rnd() * dirs.length);
    for (let t = 0; t < turns; t++) {
      // Turn by 45° or 90° from the way before, never straight back.
      last = (last + (rnd() < 0.5 ? 1 : 7) + (rnd() < 0.4 ? 1 : 0)) % dirs.length;
      const run = 40 + rnd() * 150;
      const p = points[points.length - 1];
      const [dx, dy] = dirs[last];
      const norm = Math.hypot(dx, dy);
      points.push({ x: p.x + (dx / norm) * run, y: p.y + (dy / norm) * run });
      length += run;
    }
    const heading = rnd() * Math.PI * 2;
    const speed = 3 + rnd() * 9;
    out.push({ points, x: rnd() * w, y: rnd() * h, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, dash: rnd(), speed: 0.05 + rnd() * 0.12, length });
  }
  return out;
}

/** Where a trace's start is `seconds` on, wrapped so it comes back in from the other side once wholly off the window. Pure. */
export function traceStart(t: Trace, seconds: number, w: number, h: number): { x: number; y: number } {
  const reach = 360; // longer than any trace's span, so it is off screen before it jumps
  const wrap = (v: number, size: number) => (((v + reach) % (size + 2 * reach)) + (size + 2 * reach)) % (size + 2 * reach) - reach;
  return { x: wrap(t.x + t.vx * seconds, w), y: wrap(t.y + t.vy * seconds, h) };
}

export interface Machine {
  cores?: number;
  memory?: number; // GB, navigator.deviceMemory
  saveData?: boolean;
}

/** A machine too weak for the moving picture: 2 cores or fewer, 2 GB or less, or data saving on. Unknown counts as fine. Pure. */
export function lowEnd(m: Machine): boolean {
  return (m.cores !== undefined && m.cores <= 2) || (m.memory !== undefined && m.memory <= 2) || m.saveData === true;
}

/** Frames this slow (milliseconds of drawing, averaged over SLOW_WINDOW frames) end the motion. */
export const SLOW_MS = 14;
export const SLOW_WINDOW = 24;
/** The moment the still picture shows: the pulse part way up, the shape turned a little. */
export const STILL_AT = 9.5;

export interface Backdrop {
  /** Starts drawing (the screen is up): the moving picture, or one still one. */
  start(): void;
  /** Stops all drawing (the screen is closed). */
  stop(): void;
  /**
   * Where the shape to turn comes from: the project's edges, or null for the neutral cube. Asked now and about once a
   * second while drawing (a project still reopening under the screen shows its body when it arrives); a new array is
   * fitted again, the same one is not.
   */
  setSource(source: () => ArrayLike<number> | null): void;
  /** The words moved (the list scrolled or changed): a still picture is drawn again in the room left (a moving one follows by itself). */
  redraw(): void;
  readonly mode: "live" | "still" | "off";
}

interface Env {
  win: Window & typeof globalThis;
  doc: Document;
  /** Where the screen's words end, in CSS pixels from the window's top (the picture sits in the room below). */
  room?: () => number;
}

/** Draws on `canvas`; harmless where there is no 2D context (a test DOM). */
export function homeBackdrop(canvas: HTMLCanvasElement, env: Env = { win: window, doc: document }): Backdrop {
  const { win, doc } = env;
  const ctx = (() => {
    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  })();
  const neutral = fitShape(NEUTRAL_SHAPE) as Float32Array;
  let shape = neutral;
  /** Where the shape is drawn now (eased towards `placeShape`'s answer). */
  let place: Placement | null = null;
  /** The project's size in millimetres, for the label under the turntable; null for the neutral cube. */
  let size3: [number, number, number] | null = null;
  let source: () => ArrayLike<number> | null = () => null;
  let from: ArrayLike<number> | null | undefined; // undefined: not read yet
  let watch = 0;
  /** Reads the source; true when the shape changed. */
  function reshape(): boolean {
    let lines: ArrayLike<number> | null = null;
    try {
      lines = source();
    } catch {
      lines = null; // a picture is never worth a broken screen
    }
    if (lines === from) return false;
    from = lines;
    const fitted = fitShape(lines);
    shape = fitted ?? neutral;
    size3 = fitted ? extentOf(lines) : null;
    canvas.dataset.shape = fitted ? `project ${fitted.length / 6}` : "neutral"; // what the browser check reads
    return true;
  }
  function watching() {
    watch = 0;
    if (!running) return;
    if (reshape() && !live()) draw(STILL_AT);
    watch = win.setTimeout(watching, 1000);
  }
  let traces: Trace[] = [];
  let w = 0;
  let h = 0;
  let timer = 0;
  let running = false;
  let slow = false;
  let lastFrame = 0;
  let t0 = 0;
  const costs: number[] = [];
  const motion = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  const nav = win.navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const weak = lowEnd({ cores: nav.hardwareConcurrency, memory: nav.deviceMemory, saveData: nav.connection?.saveData });
  const live = () => !(motion?.matches ?? false) && !weak && !slow;
  const set = (mode: string) => (canvas.dataset.backdrop = mode);
  set("off");

  const colour = () => win.getComputedStyle(doc.documentElement).getPropertyValue("--look-accent").trim() || "#4da3ff";

  function size() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(win.devicePixelRatio || 1, weak || slow ? 1 : 1.5);
    w = Math.max(1, Math.round(rect.width || win.innerWidth || 1));
    h = Math.max(1, Math.round(rect.height || win.innerHeight || 1));
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    traces = makeTraces(7, Math.max(10, Math.min(34, Math.round((w * h) / 42000))), w, h);
  }

  /** Whether the page is light (its surface bright): glows add light on a dark page, and would wash out a light one. */
  const lightPage = () => luminance(win.getComputedStyle(doc.documentElement).getPropertyValue("--surface").trim()) > 0.5;

  function draw(seconds: number) {
    if (!ctx) return;
    const ink = colour();
    const glow = !lightPage();
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.globalCompositeOperation = glow ? "lighter" : "source-over";
    // The drifting lines: faint, each with a brighter dash running along it, and a dot at each end.
    for (const t of traces) {
      const s = traceStart(t, seconds, w, h);
      ctx.beginPath();
      t.points.forEach((p, i) => (i === 0 ? ctx.moveTo(s.x + p.x, s.y + p.y) : ctx.lineTo(s.x + p.x, s.y + p.y)));
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.09;
      ctx.setLineDash([]);
      ctx.stroke();
      const dash = Math.max(18, t.length * 0.16);
      ctx.setLineDash([dash, t.length * 2]);
      ctx.lineDashOffset = -(((t.dash + t.speed * seconds) % 1) * (t.length + dash) - dash);
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.2;
      for (const p of [t.points[0], t.points[t.points.length - 1]]) {
        ctx.beginPath();
        ctx.arc(s.x + p.x, s.y + p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The design, turning on a turntable: lines brighter where the scan band is, nearer to the viewer, and all at once
    // as the band reaches the top (the flash).
    const want = placeShape(w, h, env.room?.() ?? h * 0.5);
    // Eased towards where it should be, so a list that grows or scrolls moves the picture smoothly (a still picture jumps).
    place = place === null || !live() ? want : { cx: want.cx, cy: place.cy + (want.cy - place.cy) * 0.12, scale: place.scale + (want.scale - place.scale) * 0.12 };
    const { cx, cy, scale } = place;
    const yaw = (seconds / TURN_SECONDS) * Math.PI * 2 + 0.6;
    const at = (x: number, y: number, z: number) => {
      const p = project(x, y, z, yaw);
      return { x: cx + p.x * scale, y: cy + p.y * scale, depth: p.depth };
    };
    const lift = flash(seconds);
    // Turntable: a ring under the shape with ticks every 5°, turning with it; a ripple spreads out from it each pulse.
    const floor = floorOf(shape) - 0.08;
    // A soft pool of light on the turntable, brighter in the flash.
    const base = at(0, 0, floor);
    const rgb = rgbOf(ink) ?? [77, 163, 255];
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.3 * scale);
    pool.addColorStop(0, `rgba(${rgb.join(",")},1)`);
    pool.addColorStop(1, `rgba(${rgb.join(",")},0)`);
    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.scale(1, Math.sin(PITCH) * 0.95);
    ctx.globalAlpha = (glow ? 0.13 : 0.08) * (1 + lift);
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(0, 0, 1.3 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.16 + 0.2 * lift;
    const ringFoot = ring(at, 1.25, floor);
    ctx.globalAlpha = 0.1;
    ring(at, 1.32, floor);
    ctx.beginPath();
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      const inner = k % 6 === 0 ? 1.12 : 1.19;
      const p = at(Math.cos(a) * inner, Math.sin(a) * inner, floor);
      const q = at(Math.cos(a) * 1.25, Math.sin(a) * 1.25, floor);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.globalAlpha = 0.18;
    ctx.stroke();
    const spread = ripple(seconds);
    if (spread !== null) {
      ctx.globalAlpha = 0.3 * (1 - spread);
      ring(at, 1.32 + spread * 1.6, floor);
    }
    // The shape's lines, batched by brightness (one path per step of brightness keeps a 1,500-line body cheap).
    const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
    for (let i = 0; i < shape.length; i += 6) {
      const a = at(shape[i], shape[i + 1], shape[i + 2]);
      const b = at(shape[i + 3], shape[i + 4], shape[i + 5]);
      const height = (shape[i + 2] + shape[i + 5]) / 2;
      const near = 1 - Math.max(-1, Math.min(1, (a.depth + b.depth) / 2)) * 0.25; // nearer reads brighter
      const alpha = Math.min(MAX_ALPHA, (BASE_ALPHA + (MAX_ALPHA - BASE_ALPHA) * Math.min(1, pulse(height, seconds) + lift)) * near);
      buckets[Math.min(BUCKETS - 1, Math.round((alpha / MAX_ALPHA) * (BUCKETS - 1)))].push(a.x, a.y, b.x, b.y);
    }
    // Corner marks round the shape, like a view finder.
    const half = 1.42 * scale;
    const arm = Math.min(22, half * 0.2);
    const top = cy - half * 1.02;
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + sx * half;
      const y = sy < 0 ? top : ringFoot + 14;
      ctx.moveTo(x, y - sy * arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x - sx * arm, y);
    }
    ctx.stroke();
    if (size3) {
      ctx.globalAlpha = 0.55;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(sizeWords(size3, currentUnit(doc)), cx, ringFoot + 22);
    }
    for (let k = 0; k < BUCKETS; k++) {
      const list = buckets[k];
      if (list.length === 0) continue;
      ctx.beginPath();
      for (let j = 0; j < list.length; j += 4) {
        ctx.moveTo(list[j], list[j + 1]);
        ctx.lineTo(list[j + 2], list[j + 3]);
      }
      const alpha = (k / (BUCKETS - 1)) * MAX_ALPHA;
      if (glow) {
        ctx.globalAlpha = alpha * 0.22; // the soft halo
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      if (k >= BUCKETS - 2) {
        // The brightest lines' ends sparkle.
        ctx.beginPath();
        for (let j = 0; j < list.length; j += 2) {
          ctx.moveTo(list[j] + 1.8, list[j + 1]);
          ctx.arc(list[j], list[j + 1], 1.8, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
    // The scan ring: a glowing circle at the band's height, while the band is on the shape.
    const front = scanHeight(seconds);
    if (front > floor && front < 1.05) {
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = 1.5;
      ring(at, 1.1, front);
      if (glow) {
        ctx.globalAlpha = 0.1;
        ctx.lineWidth = 6;
        ring(at, 1.1, front);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** A level circle of `radius` about the up axis at height `z`, drawn through `at`; gives its lowest point on screen. */
  function ring(at: (x: number, y: number, z: number) => { x: number; y: number }, radius: number, z: number): number {
    let foot = -Infinity;
    if (!ctx) return foot;
    ctx.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const p = at(Math.cos(a) * radius, Math.sin(a) * radius, z);
      foot = Math.max(foot, p.y);
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    return foot;
  }

  function frame(now: number) {
    timer = 0;
    if (!running) return;
    timer = win.requestAnimationFrame(frame);
    if (now - lastFrame < FRAME_MS - 1) return; // at most 30 a second
    lastFrame = now;
    const begun = win.performance.now();
    draw((now - t0) / 1000);
    costs.push(win.performance.now() - begun);
    if (costs.length >= SLOW_WINDOW) {
      const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
      costs.length = 0;
      if (mean > SLOW_MS) {
        slow = true; // too slow: one still picture from here on
        settle();
      }
    }
  }

  /** Runs, or paints the still picture, as the machine and the tab allow now. */
  function settle() {
    if (timer) win.cancelAnimationFrame(timer);
    timer = 0;
    if (!running || !ctx) return set("off"); // closed, or nothing to draw on (a test DOM): no loop at all
    size();
    if (live() && !doc.hidden) {
      set("live");
      t0 = win.performance.now();
      timer = win.requestAnimationFrame(frame);
    } else {
      set(live() ? "live" : "still"); // a hidden tab keeps its mode, drawing nothing
      draw(live() ? 0 : STILL_AT);
    }
  }

  const onVisible = () => running && settle();
  const onResize = () => running && settle();
  return {
    start() {
      if (running) return;
      running = true;
      doc.addEventListener("visibilitychange", onVisible);
      win.addEventListener("resize", onResize);
      motion?.addEventListener?.("change", onVisible);
      reshape();
      settle();
      if (ctx) watch = win.setTimeout(watching, 1000); // nothing to draw on (a test DOM): nothing to watch for
    },
    stop() {
      running = false;
      doc.removeEventListener("visibilitychange", onVisible);
      win.removeEventListener("resize", onResize);
      motion?.removeEventListener?.("change", onVisible);
      if (timer) win.cancelAnimationFrame(timer);
      if (watch) win.clearTimeout(watch);
      timer = 0;
      watch = 0;
      set("off");
    },
    setSource(next) {
      source = next;
      from = undefined; // read it again even if it gives the same array
      if (reshape() && running && !live()) draw(STILL_AT);
    },
    redraw() {
      if (running && ctx && !live() && !doc.hidden) draw(STILL_AT);
    },
    get mode() {
      return canvas.dataset.backdrop as "live" | "still" | "off";
    },
  };
}
