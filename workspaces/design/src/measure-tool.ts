// Measure (step 35e2l2): what Inspect ▾ Measure shows, worked out apart from
// the page. Like Fusion's Measure: the first click picks one thing (a face,
// an edge, a corner, or with a double-click a whole body), the second
// another, and a third starts again from it; clicking the first thing again
// lets it go. The kernel measures them exactly (`body_measure`); this file
// turns its answer into the panel's rows in the unit chosen in Settings,
// and into the line drawn in the view between the two nearest points.
// Nothing here is saved or undone: measuring changes no part.

import { areaIn, formatLength, volumeIn, type AnalysisOverlay, type MeasureFacts, type Measured, type Unit } from "@fission/core";

/** One thing picked: shown body `body` (its place in the scene), and which of its parts by the kernel's index. */
export type MeasureTarget = { body: number; kind: "face" | "edge" | "vertex"; index: number } | { body: number; kind: "body" };

export interface MeasurePicks {
  first: MeasureTarget | null;
  second: MeasureTarget | null;
}

export const NO_PICKS: MeasurePicks = { first: null, second: null };

const same = (a: MeasureTarget | null, b: MeasureTarget): boolean => a !== null && a.body === b.body && a.kind === b.kind && (a.kind === "body" || (b.kind !== "body" && a.index === b.index));

/**
 * The picks after a click on `t` (module comment): fills the first, then
 * the second, then starts again with `t` first; `t` again lets it go.
 */
export function picked(p: MeasurePicks, t: MeasureTarget): MeasurePicks {
  if (same(p.second, t)) return { first: p.first, second: null };
  if (same(p.first, t)) return { first: p.second, second: null };
  if (p.first === null) return { first: t, second: null };
  if (p.second === null) return { first: p.first, second: t };
  return { first: t, second: null };
}

/** What each kind of pick is called, by the kernel's word for it. */
export const KIND_WORDS: Record<MeasureFacts["kind"], string> = {
  vertex: "Corner",
  line: "Straight edge",
  arc: "Arc edge",
  circle: "Circle edge",
  plane: "Flat face",
  cylinder: "Round face",
  sphere: "Ball face",
  body: "Body",
};

/** "Flat face of Body 2", "Body 1". */
export function pickWords(facts: MeasureFacts, bodyName: string): string {
  return facts.kind === "body" ? bodyName : `${KIND_WORDS[facts.kind]} of ${bodyName}`;
}

/** One row of the panel: its id (for tests and styles), its label and its value in words. */
export interface MeasureRow {
  id: string;
  label: string;
  value: string;
}

/** Degrees to 2 decimals, trailing zeros dropped: "90°", "33.69°". */
export function degrees(d: number): string {
  if (!Number.isFinite(d)) return "—";
  const s = d.toFixed(2).replace(/\.?0+$/, "");
  return `${s === "-0" ? "0" : s}°`;
}

/** A number in words: 3 decimals from 1 up, 3 significant digits below (so 0.000155 in² isn't 0), trailing zeros dropped. */
export function amount(x: number): string {
  if (!Number.isFinite(x)) return "—";
  const s = Math.abs(x) >= 1 || x === 0 ? x.toFixed(3) : Number(x.toPrecision(3)).toFixed(12);
  const t = s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  return t === "-0" ? "0" : t;
}

/** An area in the unit's squares: "100 mm²", "0.155 in²". */
export const area = (mm2: number, unit: Unit): string => `${amount(areaIn(mm2, unit))} ${unit}²`;

/** A volume in the unit's cubes: "1000 mm³", "0.061 in³". */
export const volume = (mm3: number, unit: Unit): string => `${amount(volumeIn(mm3, unit))} ${unit}³`;

/** A point "x, y, z" in the unit, each 3 decimals. */
export function point(p: readonly number[], unit: Unit): string {
  return p.map((x) => formatLength(x, unit).replace(` ${unit}`, "")).join(", ") + ` ${unit}`;
}

/**
 * The rows for one pick's own facts, ids prefixed `prefix` ("first", "second"); with `named` each label says
 * whose fact it is ("First area"), so two picks' rows are told apart.
 */
export function factRows(f: MeasureFacts, unit: Unit, prefix: string, named = false): MeasureRow[] {
  const rows: MeasureRow[] = [];
  const whose = named ? `${prefix[0].toUpperCase()}${prefix.slice(1)} ` : "";
  const row = (key: string, label: string, value: string) => rows.push({ id: `${prefix}-${key}`, label: whose === "" ? label : whose + label.toLowerCase(), value });
  if (f.point) row("point", "Position", point(f.point, unit));
  if (f.length !== undefined) row("length", "Length", formatLength(f.length, unit));
  if (f.radius !== undefined) {
    row("radius", "Radius", formatLength(f.radius, unit));
    row("diameter", "Diameter", formatLength(2 * f.radius, unit));
  }
  if (f.sweep !== undefined) row("sweep", "Sweep", degrees(f.sweep));
  if (f.centre && f.kind !== "cylinder") row("centre", "Centre", point(f.centre, unit));
  if (f.area !== undefined) row("area", "Area", area(f.area, unit));
  if (f.volume !== undefined) row("volume", "Volume", volume(f.volume, unit));
  return rows;
}

/**
 * Every row the panel shows for `m`: with two picks the distance, how far
 * along x, y and z it goes (first to second), the angle and centre to
 * centre when they have them, then each pick's own facts, named by whose
 * they are; with one pick its facts alone.
 */
export function measureRows(m: Measured, unit: Unit): MeasureRow[] {
  const rows: MeasureRow[] = [];
  if (m.distance) {
    const g = m.distance;
    rows.push({ id: "distance", label: "Distance", value: formatLength(g.distance, unit) });
    (["x", "y", "z"] as const).forEach((axis, i) => rows.push({ id: `d${axis}`, label: `Along ${axis.toUpperCase()}`, value: formatLength(g.to[i] - g.from[i], unit) }));
  }
  if (m.angle !== undefined) rows.push({ id: "angle", label: "Angle", value: degrees(m.angle) });
  if (m.centres) rows.push({ id: "centres", label: "Centre to centre", value: formatLength(m.centres.distance, unit) });
  rows.push(...factRows(m.first, unit, "first", m.second !== undefined));
  if (m.second) rows.push(...factRows(m.second, unit, "second", true));
  return rows;
}

/** The overlay's id: one measurement shown at a time. */
export const MEASURE_OVERLAY = "measure";

/**
 * The line between the two nearest points, with a dot at each end, drawn
 * over everything, and the distance in the view's legend; null with fewer
 * than two picks.
 */
export function measureOverlay(m: Measured | null, unit: Unit): AnalysisOverlay | null {
  if (!m?.distance) return null;
  const g = m.distance;
  return {
    id: MEASURE_OVERLAY,
    label: `Distance ${formatLength(g.distance, unit)}`,
    detail: "The shortest distance between the two things measured.",
    marks: [],
    places: [{ severity: "info", from: g.from, to: g.to }, { severity: "info", point: g.from }, { severity: "info", point: g.to }],
  };
}

/** What the panel says to do next. */
export function measureHint(p: MeasurePicks): string {
  if (p.first === null) return "Click a face, edge or corner to measure. Double-click picks a whole body.";
  if (p.second === null) return "Click a second thing to measure the distance and angle between them.";
  return "Click another thing to start a new measurement.";
}
