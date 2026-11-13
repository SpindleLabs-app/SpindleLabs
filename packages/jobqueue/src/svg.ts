// A laser job's SVG file read for the file check (step Q2): the drawing's outer box in millimetres, and which of the
// laser's layers each shape is on by its colour, the same colours Laser's own files use (workspaces/laser ops.ts,
// kept equal by test/laser-check.test.ts): a red outline (#f00) is cut, a blue outline (#00f) scored, a black fill
// (#000) engraved. Any other colour is refused in words, so the teacher never has to guess what a green line means.
//
// It reads what drawing programs write: paths (every command, arcs and Béziers boxed exactly, box2d.ts), rect (with
// round corners), circle, ellipse, line, polyline and polygon; groups and links; transforms; colours from attributes,
// from style="…" and from a <style> sheet with plain tag, .class and #id rules; and the document's size and viewBox
// for millimetres. Text, pictures, clones and nested drawings are refused with what to do instead. Never throws.

import { addArc, addCubic, addLine, addQuadratic, Box, compose, IDENTITY, type Affine, type Pt } from "./box2d.ts";

export type LaserLayer = "cut" | "score" | "engrave";

/** What a laser drawing comes to: its outer box (mm), the shapes on each layer, and notes for the teacher. */
export interface DrawingRead {
  width: number;
  height: number;
  /** How much more (mm) the true width or height may be than said: 0 when measured exactly (curves read by sampling). */
  slack: number;
  layers: Record<LaserLayer, number>;
  notes: string[];
}

export type Read = { ok: true; drawing: DrawingRead } | { ok: false; reason: string };

/** Most elements an SVG may hold, and how deep groups may go. */
export const SVG_LIMITS = { elements: 200_000, depth: 64 };

// ---------------------------------------------------------------- the XML

interface El {
  name: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[e] ?? whole;
  });
}

class XmlError extends Error {}

/** The document's elements as a tree, comments and declarations skipped; the generator comment if there is one. */
function parseXml(text: string): { root: El; comments: string[] } {
  const top: El = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: El[] = [top];
  const comments: string[] = [];
  let count = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    const parent = stack[stack.length - 1] as El;
    if (lt < 0) {
      parent.text += decode(text.slice(i));
      break;
    }
    if (lt > i) parent.text += decode(text.slice(i, lt));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end < 0) throw new XmlError("a comment never ends");
      comments.push(text.slice(lt + 4, end));
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end < 0) throw new XmlError("a CDATA block never ends");
      parent.text += text.slice(lt + 9, end);
      i = end + 3;
    } else if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end < 0) throw new XmlError("a declaration never ends");
      i = end + 2;
    } else if (text.startsWith("<!", lt)) {
      // <!DOCTYPE …>, perhaps with an internal subset in [ … ].
      let j = lt + 2;
      let depth = 0;
      for (; j < n; j++) {
        const ch = text[j];
        if (ch === "[") depth += 1;
        else if (ch === "]") depth -= 1;
        else if (ch === ">" && depth <= 0) break;
      }
      if (j >= n) throw new XmlError("a declaration never ends");
      i = j + 1;
    } else if (text[lt + 1] === "/") {
      const end = text.indexOf(">", lt);
      if (end < 0) throw new XmlError("an end tag never ends");
      const name = text.slice(lt + 2, end).trim();
      if (stack.length < 2 || parent.name !== name) throw new XmlError(`</${name}> does not close the open <${parent.name}>`);
      stack.pop();
      i = end + 1;
    } else {
      const nameMatch = /^<([A-Za-z_:][-\w.:]*)/.exec(text.slice(lt, lt + 200));
      if (!nameMatch) throw new XmlError("a stray <");
      const el: El = { name: nameMatch[1] as string, attrs: {}, children: [], text: "" };
      let j = lt + nameMatch[0].length;
      let selfClosing = false;
      for (;;) {
        while (j < n && /\s/.test(text[j] as string)) j++;
        if (j >= n) throw new XmlError(`<${el.name}> never ends`);
        if (text[j] === ">") {
          j += 1;
          break;
        }
        if (text.startsWith("/>", j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        const attr = /^([A-Za-z_:][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(text.slice(j, j + 1_000_000));
        if (!attr) throw new XmlError(`a broken attribute in <${el.name}>`);
        el.attrs[attr[1] as string] = decode(attr[3] ?? attr[4] ?? "");
        j += attr[0].length;
      }
      count += 1;
      if (count > SVG_LIMITS.elements) throw new XmlError(`more than ${SVG_LIMITS.elements} elements`);
      parent.children.push(el);
      if (!selfClosing) {
        if (stack.length > SVG_LIMITS.depth * 2) throw new XmlError("groups nested too deep");
        stack.push(el);
      }
      i = j;
    }
  }
  if (stack.length !== 1) throw new XmlError(`<${(stack[stack.length - 1] as El).name}> is never closed`);
  return { root: top, comments };
}

/** The element's name without its namespace prefix, and whether it had one (Inkscape's own elements are prefixed). */
const local = (name: string): { name: string; prefixed: boolean } => {
  const k = name.indexOf(":");
  // An "svg:" prefix is SVG's own namespace written out; any other is a program's own.
  return k < 0 ? { name, prefixed: false } : { name: name.slice(k + 1), prefixed: name.slice(0, k) !== "svg" };
};

// ---------------------------------------------------------------- numbers, lengths, transforms

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** CSS pixels (the SVG user unit with no viewBox) in each unit. */
const PX_PER: Record<string, number> = { px: 1, "": 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16, q: 96 / 101.6 };

function length(s: string | undefined): { value: number; unit: string } | null {
  if (s === undefined) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? { value, unit: (m[2] as string).toLowerCase() } : null;
}

/** A length attribute in user units (a unit given is turned to CSS pixels); `fallback` when absent. */
function userLength(s: string | undefined, fallback: number): number {
  if (s === undefined) return fallback;
  const l = length(s);
  if (!l) throw new ShapeError(`a length "${s.slice(0, 20)}" the check can't read`);
  if (l.unit === "%") throw new ShapeError("a length in % of the page, which the check can't size: give it in mm or plain numbers");
  const per = PX_PER[l.unit];
  if (per === undefined) throw new ShapeError(`a length in "${l.unit}"`);
  return l.value * per;
}

function numbers(s: string): number[] {
  const out: number[] = [];
  const re = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  for (const m of s.matchAll(re)) out.push(Number(m[0]));
  return out;
}

class ShapeError extends Error {}

/** The transform attribute as one map (functions applied right to left, as written left to right). */
export function parseTransform(s: string): Affine {
  let m: Affine = IDENTITY;
  const re = /\s*,?\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/y;
  let i = 0;
  const t = s.trim();
  while (i < t.length) {
    re.lastIndex = i;
    const f = re.exec(t);
    if (!f) throw new ShapeError(`a transform "${t.slice(0, 40)}" the check can't read`);
    i = re.lastIndex;
    const a = numbers(f[2] as string);
    if (!a.every(Number.isFinite)) throw new ShapeError("a transform with a number that isn't one");
    let step: Affine;
    switch (f[1]) {
      case "matrix":
        if (a.length !== 6) throw new ShapeError("a matrix() without six numbers");
        step = a as Affine;
        break;
      case "translate":
        if (a.length < 1 || a.length > 2) throw new ShapeError("a translate() without one or two numbers");
        step = [1, 0, 0, 1, a[0] as number, a[1] ?? 0];
        break;
      case "scale":
        if (a.length < 1 || a.length > 2) throw new ShapeError("a scale() without one or two numbers");
        step = [a[0] as number, 0, 0, a[1] ?? (a[0] as number), 0, 0];
        break;
      case "rotate": {
        if (a.length !== 1 && a.length !== 3) throw new ShapeError("a rotate() without one or three numbers");
        const r = ((a[0] as number) * Math.PI) / 180;
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        const [cos, sin] = [Math.cos(r), Math.sin(r)];
        // translate(cx, cy) rotate(r) translate(−cx, −cy)
        step = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case "skewX":
        if (a.length !== 1) throw new ShapeError("a skewX() without one number");
        step = [1, 0, Math.tan(((a[0] as number) * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        if (a.length !== 1) throw new ShapeError("a skewY() without one number");
        step = [1, Math.tan(((a[0] as number) * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = compose(m, step);
  }
  return m;
}

// ---------------------------------------------------------------- paths

/** Adds the path data `d`, mapped by `m`, to the box. Throws ShapeError on data it can't read. */
export function addPath(box: Box, m: Affine, d: string): void {
  let i = 0;
  const n = d.length;
  const skip = () => {
    while (i < n && /[\s,]/.test(d[i] as string)) i++;
  };
  const num = (): number => {
    skip();
    NUM.lastIndex = i;
    const r = NUM.exec(d);
    if (!r) throw new ShapeError("path data with a missing number");
    i = NUM.lastIndex;
    return Number(r[0]);
  };
  const flag = (): boolean => {
    skip();
    const ch = d[i];
    if (ch !== "0" && ch !== "1") throw new ShapeError("path data with an arc flag that isn't 0 or 1");
    i += 1;
    return ch === "1";
  };
  const more = (): boolean => {
    skip();
    return i < n && /[-+.\d]/.test(d[i] as string);
  };
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastCubic: Pt | null = null;
  let lastQuad: Pt | null = null;
  let cmd = "";
  skip();
  if (i < n && !/[Mm]/.test(d[i] as string)) throw new ShapeError("path data that doesn't start with a move");
  while (true) {
    skip();
    if (i >= n) break;
    if (/[A-Za-z]/.test(d[i] as string)) {
      cmd = d[i] as string;
      i += 1;
    } else if (cmd === "" || /[Zz]/.test(cmd)) {
      throw new ShapeError("path data with numbers and no command");
    } else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    const C = cmd.toUpperCase();
    let nextCubic: Pt | null = null;
    let nextQuad: Pt | null = null;
    switch (C) {
      case "M": {
        cur = at(num(), num());
        start = cur;
        box.add(map1(m, cur));
        break;
      }
      case "Z":
        addLine(box, m, cur, start);
        cur = start;
        break;
      case "L": {
        const p = at(num(), num());
        addLine(box, m, cur, p);
        cur = p;
        break;
      }
      case "H": {
        const x = num();
        const p: Pt = [rel ? cur[0] + x : x, cur[1]];
        addLine(box, m, cur, p);
        cur = p;
        break;
      }
      case "V": {
        const y = num();
        const p: Pt = [cur[0], rel ? cur[1] + y : y];
        addLine(box, m, cur, p);
        cur = p;
        break;
      }
      case "C": {
        const p1 = at(num(), num());
        const p2 = at(num(), num());
        const p3 = at(num(), num());
        addCubic(box, m, cur, p1, p2, p3);
        nextCubic = p2;
        cur = p3;
        break;
      }
      case "S": {
        const p1: Pt = lastCubic ? [2 * cur[0] - lastCubic[0], 2 * cur[1] - lastCubic[1]] : cur;
        const p2 = at(num(), num());
        const p3 = at(num(), num());
        addCubic(box, m, cur, p1, p2, p3);
        nextCubic = p2;
        cur = p3;
        break;
      }
      case "Q": {
        const p1 = at(num(), num());
        const p2 = at(num(), num());
        addQuadratic(box, m, cur, p1, p2);
        nextQuad = p1;
        cur = p2;
        break;
      }
      case "T": {
        const p1: Pt = lastQuad ? [2 * cur[0] - lastQuad[0], 2 * cur[1] - lastQuad[1]] : cur;
        const p2 = at(num(), num());
        addQuadratic(box, m, cur, p1, p2);
        nextQuad = p1;
        cur = p2;
        break;
      }
      case "A": {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        const p = at(num(), num());
        addSvgArc(box, m, cur, p, rx, ry, rot, large, sweep);
        cur = p;
        break;
      }
      default:
        throw new ShapeError(`path data with a command "${cmd}"`);
    }
    lastCubic = nextCubic;
    lastQuad = nextQuad;
    if (/[Zz]/.test(cmd) && more()) throw new ShapeError("path data with numbers after a close");
  }
}

const map1 = (m: Affine, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

/**
 * An SVG arc from p to q (radii, the x axis's turn in degrees, the two flags) to centre form, by the SVG
 * specification's own steps (its implementation notes, "conversion from endpoint to center parameterization"),
 * radii grown when they are too small to reach, as the specification says; a zero radius is a straight line.
 */
export function addSvgArc(box: Box, m: Affine, p: Pt, q: Pt, rx0: number, ry0: number, rotDeg: number, large: boolean, sweep: boolean): void {
  if (p[0] === q[0] && p[1] === q[1]) return;
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) {
    addLine(box, m, p, q);
    return;
  }
  const phi = (rotDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const hx = (p[0] - q[0]) / 2;
  const hy = (p[1] - q[1]) / 2;
  const x1 = cos * hx + sin * hy;
  const y1 = -sin * hx + cos * hy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const c: Pt = [cos * cx1 - sin * cy1 + (p[0] + q[0]) / 2, sin * cx1 + cos * cy1 + (p[1] + q[1]) / 2];
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta0 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dTheta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  // In the arc's own frame the ellipse is c + (rx cos θ, ry sin θ) turned by φ: u and v are its turned axes.
  addArc(box, m, c, [rx * cos, rx * sin], [-ry * sin, ry * cos], theta0, dTheta);
}

// ---------------------------------------------------------------- colours and styles

type Paint = { kind: "none" } | { kind: "rgb"; rgb: number } | { kind: "current" } | { kind: "other"; text: string };

const NAMED: Record<string, number> = {
  black: 0x000000, red: 0xff0000, blue: 0x0000ff, white: 0xffffff, lime: 0x00ff00, green: 0x008000, yellow: 0xffff00,
  cyan: 0x00ffff, aqua: 0x00ffff, magenta: 0xff00ff, fuchsia: 0xff00ff, gray: 0x808080, grey: 0x808080, silver: 0xc0c0c0,
  orange: 0xffa500, purple: 0x800080, navy: 0x000080, maroon: 0x800000,
};

export function parsePaint(s: string): Paint {
  const t = s.trim().toLowerCase();
  if (t === "none" || t === "transparent") return { kind: "none" };
  if (t === "currentcolor") return { kind: "current" };
  let m = /^#([0-9a-f]{3,4})$/.exec(t);
  if (m) {
    const h = m[1] as string;
    if (h.length === 4 && h[3] !== "f") return { kind: "other", text: s.trim() };
    return { kind: "rgb", rgb: parseInt(h.slice(0, 3).split("").map((c) => c + c).join(""), 16) };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(t);
  if (m) {
    if (m[2] !== undefined && m[2] !== "ff") return { kind: "other", text: s.trim() };
    return { kind: "rgb", rgb: parseInt(m[1] as string, 16) };
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(t);
  if (m) {
    const parts = (m[1] as string).split(/[\s,/]+/).filter((x) => x !== "");
    if (parts.length === 3 || (parts.length === 4 && Number(parts[3]?.replace("%", "")) === (parts[3]?.endsWith("%") ? 100 : 1))) {
      const v = parts.slice(0, 3).map((x) => (x.endsWith("%") ? (Number(x.slice(0, -1)) * 255) / 100 : Number(x)));
      if (v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return { kind: "rgb", rgb: ((v[0] as number) << 16) | ((v[1] as number) << 8) | (v[2] as number) };
    }
    return { kind: "other", text: s.trim() };
  }
  if (t in NAMED) return { kind: "rgb", rgb: NAMED[t] as number };
  return { kind: "other", text: s.trim() };
}

/** The laser's colours, as Laser writes them (ops.ts OP_LOOK): an outline's colour picks cut or score, a fill's engrave. */
export const LASER_COLOURS = { cut: 0xff0000, score: 0x0000ff, engrave: 0x000000 } as const;

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, "0")}`;

/** The properties the check reads, as they stand on an element. */
interface Style {
  fill: string;
  stroke: string;
  color: string;
  "stroke-width": string;
  display: string;
  visibility: string;
  opacity: string;
  "fill-opacity": string;
  "stroke-opacity": string;
}

const INHERITED = ["fill", "stroke", "color", "stroke-width", "visibility", "fill-opacity", "stroke-opacity"] as const;
const PROPS = new Set<string>(["fill", "stroke", "color", "stroke-width", "display", "visibility", "opacity", "fill-opacity", "stroke-opacity"]);

interface Rule {
  kind: "tag" | "class" | "id";
  name: string;
  decls: Record<string, string>;
  order: number;
}

function declarations(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(";")) {
    const k = part.indexOf(":");
    if (k < 0) continue;
    const prop = part.slice(0, k).trim().toLowerCase();
    const value = part.slice(k + 1).replace(/!important/i, "").trim();
    if (PROPS.has(prop)) out[prop] = value;
  }
  return out;
}

/** A <style> sheet's plain rules (tag, .class, #id, comma lists); anything fancier is refused, never guessed. */
function sheetRules(css: string, from: number): Rule[] {
  const rules: Rule[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let order = from;
  let used = 0;
  for (const m of body.matchAll(re)) {
    used += m[0].length;
    const decls = declarations(m[2] as string);
    for (const sel of (m[1] as string).split(",").map((x) => x.trim())) {
      if (sel.startsWith("@")) throw new ShapeError(`a style rule "${sel.slice(0, 30)}"`);
      const s = /^(\.|#)?([A-Za-z_][-\w]*)$/.exec(sel);
      if (!s) throw new ShapeError(`a style rule "${sel.slice(0, 30)}" the check can't read (only tag, .class and #id rules)`);
      rules.push({ kind: s[1] === "." ? "class" : s[1] === "#" ? "id" : "tag", name: s[2] as string, decls, order: order++ });
    }
  }
  if (body.replace(/\s+/g, "").length > 0 && used === 0) throw new ShapeError("a <style> sheet the check can't read");
  return rules;
}

const SPECIFICITY = { tag: 1, class: 10, id: 100 } as const;

function ownStyle(el: El, rules: readonly Rule[], parent: Style): Style {
  const s: Style = { ...parent, display: "inline", opacity: "1" };
  // Presentation attributes, then the sheet by specificity and order, then style="…".
  for (const p of PROPS) if (el.attrs[p] !== undefined) (s as unknown as Record<string, string>)[p] = el.attrs[p] as string;
  const classes = (el.attrs.class ?? "").split(/\s+/).filter((c) => c !== "");
  const tag = local(el.name).name;
  const hits = rules
    .filter((r) => (r.kind === "tag" ? r.name === tag : r.kind === "class" ? classes.includes(r.name) : r.name === el.attrs.id))
    .sort((a, b) => SPECIFICITY[a.kind] - SPECIFICITY[b.kind] || a.order - b.order);
  for (const r of hits) Object.assign(s, r.decls);
  if (el.attrs.style !== undefined) Object.assign(s, declarations(el.attrs.style));
  for (const p of INHERITED) if (s[p] === "inherit") s[p] = parent[p];
  return s;
}

const ROOT_STYLE: Style = { fill: "black", stroke: "none", color: "black", "stroke-width": "1", display: "inline", visibility: "visible", opacity: "1", "fill-opacity": "1", "stroke-opacity": "1" };

const zero = (s: string): boolean => {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) && v <= 0;
};

// ---------------------------------------------------------------- the drawing

const SKIPPED = new Set(["defs", "symbol", "clipPath", "mask", "marker", "pattern", "linearGradient", "radialGradient", "title", "desc", "metadata", "style", "script", "filter", "font", "font-face", "namedview"]);
const GROUPS = new Set(["g", "a", "switch"]);
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const REFUSED: Record<string, string> = {
  text: "has text: turn the text into outlines (paths) in the drawing program first",
  tspan: "has text: turn the text into outlines (paths) in the drawing program first",
  textPath: "has text: turn the text into outlines (paths) in the drawing program first",
  image: "has a picture in it: the laser check reads only lines and shapes (pictures come later)",
  use: "has a clone (a copy linked to another shape): unlink the clones in the drawing program first",
  svg: "has a drawing inside the drawing: ungroup or flatten it in the drawing program first",
  foreignObject: "has something that isn't a drawing in it",
};

interface Walk {
  rules: Rule[];
  box: Box;
  layers: Record<LaserLayer, number>;
  invisible: number;
  clipped: number;
}

function shapeBox(el: El, tag: string, m: Affine, box: Box): void {
  const a = el.attrs;
  const num = (k: string, fallback = 0) => userLength(a[k], fallback);
  switch (tag) {
    case "path":
      if ((a.d ?? "").trim() !== "") addPath(box, m, a.d as string);
      return;
    case "rect": {
      const [x, y, w, h] = [num("x"), num("y"), num("width"), num("height")];
      if (!(w > 0 && h > 0)) return;
      let rx = a.rx !== undefined && a.rx !== "auto" ? num("rx") : NaN;
      let ry = a.ry !== undefined && a.ry !== "auto" ? num("ry") : NaN;
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (rx === 0 || ry === 0) {
        addPath(box, m, `M${x},${y}H${x + w}V${y + h}H${x}Z`);
        return;
      }
      addPath(box, m, `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`);
      return;
    }
    case "circle":
    case "ellipse": {
      const [cx, cy] = [num("cx"), num("cy")];
      const rx = tag === "circle" ? num("r") : num("rx");
      const ry = tag === "circle" ? rx : num("ry");
      if (!(rx > 0 && ry > 0)) return;
      addArc(box, m, [cx, cy], [rx, 0], [0, ry], 0, 2 * Math.PI);
      return;
    }
    case "line":
      addLine(box, m, [num("x1"), num("y1")], [num("x2"), num("y2")]);
      return;
    default: {
      const v = numbers(a.points ?? "");
      if (v.length % 2 === 1) throw new ShapeError(`a ${tag} with an odd count of numbers`);
      for (let k = 0; k + 3 < v.length; k += 2) addLine(box, m, [v[k] as number, v[k + 1] as number], [v[k + 2] as number, v[k + 3] as number]);
      if (v.length === 2) addLine(box, m, [v[0] as number, v[1] as number], [v[0] as number, v[1] as number]);
    }
  }
}

function walk(el: El, m: Affine, style: Style, w: Walk, depth: number): void {
  for (const child of el.children) {
    const { name: tag, prefixed } = local(child.name);
    if (prefixed) continue; // a drawing program's own notes (Inkscape's, Illustrator's)
    if (SKIPPED.has(tag)) continue;
    const s = ownStyle(child, w.rules, style);
    if (s.display.trim() === "none" || zero(s.opacity)) continue;
    const refused = REFUSED[tag];
    if (refused !== undefined) throw new ShapeError(refused);
    const own = child.attrs.transform !== undefined ? compose(m, parseTransform(child.attrs.transform)) : m;
    if (child.attrs["clip-path"] !== undefined || child.attrs.mask !== undefined) w.clipped += 1;
    if (GROUPS.has(tag)) {
      if (depth > SVG_LIMITS.depth) throw new ShapeError("groups nested too deep");
      walk(child, own, s, w, depth + 1);
      continue;
    }
    if (!SHAPES.has(tag)) throw new ShapeError(`has a <${tag}> the check doesn't know`);
    if (s.visibility.trim() === "hidden" || s.visibility.trim() === "collapse") continue;
    const resolve = (p: string): Paint => {
      const paint = parsePaint(p);
      return paint.kind === "current" ? parsePaint(s.color) : paint;
    };
    const stroke = zero(s["stroke-width"]) || zero(s["stroke-opacity"]) ? ({ kind: "none" } as Paint) : resolve(s.stroke);
    const fill = tag === "line" || zero(s["fill-opacity"]) ? ({ kind: "none" } as Paint) : resolve(s.fill);
    const on: LaserLayer[] = [];
    if (stroke.kind === "rgb" && stroke.rgb === LASER_COLOURS.cut) on.push("cut");
    else if (stroke.kind === "rgb" && stroke.rgb === LASER_COLOURS.score) on.push("score");
    else if (stroke.kind !== "none") throw new ShapeError(`has an outline in ${stroke.kind === "rgb" ? hex(stroke.rgb) : `"${stroke.kind === "other" ? stroke.text.slice(0, 30) : "an unknown colour"}"`}: the laser reads red (#ff0000) outlines as cut and blue (#0000ff) as score, so make every outline one of those`);
    if (fill.kind === "rgb" && fill.rgb === LASER_COLOURS.engrave) on.push("engrave");
    else if (fill.kind !== "none") throw new ShapeError(`has a shape filled in ${fill.kind === "rgb" ? hex(fill.rgb) : `"${fill.kind === "other" ? fill.text.slice(0, 30) : "an unknown colour"}"`}: the laser reads only a black (#000000) fill, as engrave, so make fills black or remove them`);
    if (on.length === 0) {
      w.invisible += 1;
      continue;
    }
    const before = new Box();
    shapeBox(child, tag, own, before);
    if (before.empty) continue;
    if (!before.finite) throw new ShapeError("has a shape with a number that isn't one");
    w.box.addBox(before);
    for (const l of on) w.layers[l] += 1;
  }
}

function collectRules(el: El, out: Rule[]): void {
  for (const c of el.children) {
    if (local(c.name).name === "style") out.push(...sheetRules(c.text, out.length));
    else collectRules(c, out);
  }
}

/** The SVG file's text read as a laser drawing, or why it can't be. */
export function readSvg(text: string): Read {
  let doc: ReturnType<typeof parseXml>;
  try {
    doc = parseXml(text);
  } catch (e) {
    return { ok: false, reason: `The SVG file is damaged (${e instanceof XmlError ? e.message : "it can't be read"}). Save it again from the drawing program.` };
  }
  const root = doc.root.children.find((c) => local(c.name).name === "svg");
  if (!root || doc.root.children.length !== 1) return { ok: false, reason: "The file is not an SVG drawing: it has no single <svg> at its top." };
  const notes: string[] = [];
  try {
    // Millimetres per user unit: from width and height against the viewBox, else CSS pixels.
    const illustrator = doc.comments.some((c) => /Adobe Illustrator/i.test(c));
    const pxMm = illustrator ? 25.4 / 72 : 25.4 / 96;
    const vb = root.attrs.viewBox !== undefined ? numbers(root.attrs.viewBox) : null;
    if (vb && (vb.length !== 4 || !((vb[2] as number) > 0 && (vb[3] as number) > 0))) return { ok: false, reason: "The SVG's viewBox isn't four numbers with a width and height above 0, so its size can't be read." };
    const lw = length(root.attrs.width);
    const lh = length(root.attrs.height);
    const physical = (l: { value: number; unit: string } | null): number | null => {
      if (!l || l.unit === "%" || !(l.value > 0)) return null;
      const per = PX_PER[l.unit];
      if (per === undefined) throw new ShapeError(`gives its size in "${l.unit}"`);
      return l.unit === "" || l.unit === "px" ? l.value * pxMm : (l.value * per * 25.4) / 96;
    };
    const wMm = physical(lw);
    const hMm = physical(lh);
    const inPixels = (lw === null || lw.unit === "" || lw.unit === "px" || lw.unit === "%") && (lh === null || lh.unit === "" || lh.unit === "px" || lh.unit === "%");
    let sx = pxMm;
    let sy = pxMm;
    if (vb) {
      const fx = wMm !== null ? wMm / (vb[2] as number) : hMm !== null ? hMm / (vb[3] as number) : pxMm;
      const fy = hMm !== null ? hMm / (vb[3] as number) : fx;
      if ((root.attrs.preserveAspectRatio ?? "").trim().startsWith("none")) [sx, sy] = [fx, fy];
      else if ((root.attrs.preserveAspectRatio ?? "").includes("slice")) sx = sy = Math.max(fx, fy);
      else sx = sy = Math.min(fx, fy);
    }
    if (inPixels) notes.push(illustrator ? "The SVG gives its size in pixels; read at 72 to the inch, as Illustrator writes them." : "The SVG gives its size in pixels; read at 96 to the inch (the web's, and Inkscape's). If it looks the wrong size, save it with millimetres.");
    const rules: Rule[] = [];
    collectRules(root, rules);
    const w: Walk = { rules, box: new Box(), layers: { cut: 0, score: 0, engrave: 0 }, invisible: 0, clipped: 0 };
    const rootStyle = ownStyle(root, rules, ROOT_STYLE);
    walk(root, [sx, 0, 0, sy, 0, 0], rootStyle, w, 0);
    if (w.invisible > 0) notes.push(`${w.invisible} shape${w.invisible === 1 ? " has" : "s have"} no outline and no fill, so the laser skips ${w.invisible === 1 ? "it" : "them"}.`);
    if (w.clipped > 0) notes.push("Part of the drawing is clipped or masked; the check measured the whole shapes, so the size may be a little more than what shows.");
    if (w.box.empty) return { ok: false, reason: "The SVG has nothing for the laser: no red, blue or black-filled shape." };
    return { ok: true, drawing: { width: w.box.width, height: w.box.height, slack: 0, layers: w.layers, notes } };
  } catch (e) {
    if (e instanceof ShapeError) return { ok: false, reason: `The SVG ${e.message.startsWith("has") || e.message.startsWith("gives") ? e.message : `has ${e.message}`}.` };
    return { ok: false, reason: "The SVG couldn't be read." };
  }
}
