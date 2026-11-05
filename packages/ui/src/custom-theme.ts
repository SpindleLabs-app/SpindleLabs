// The Custom theme (Ben, 2026-11-04): the user picks three colours as hex and
// the app derives every colour token from them.
//   primary   the page and its panels (the dark navy, or white, of the base theme)
//   secondary the 3D view's sky and ground (the light blue; @fission/viewport)
//   highlight what is chosen: the selected tool, focus, the main button
// The base is the light or the dark theme, whichever the primary is closer to,
// so every token this does not touch keeps its tested value and its contrast.
// The tokens it does touch are moved so text stays readable: the primary is
// nudged until the theme's text has 4.5 : 1 on every panel colour (and the dim
// text 3 : 1), the highlight until it has 3 : 1 on the panel (4.5 : 1 as words),
// and each change is returned as a plain-words note for Settings to show.
// The pure part is here; `apps/fission/public/theme-init.js` replays the stored
// result before the first paint, and `theme-choice.ts` applies it.

export interface CustomColours {
  primary: string;
  secondary: string;
  highlight: string;
}
export type Base = "light" | "dark";
/** A token map: name without the leading `--` to its value, as theme.css writes it. */
export type Tokens = ReadonlyMap<string, string>;

/** The dark navy the dark theme is, the light blue of its sky, and its bright blue. */
export const DEFAULT_CUSTOM: CustomColours = { primary: "#0f141c", secondary: "#b0d0f4", highlight: "#4aa8ff" };
export const CUSTOM_NAMES = { primary: "Primary", secondary: "Secondary", highlight: "Highlight" } as const;

type Rgb = [number, number, number];

/** `#rgb` or `#rrggbb` (the # optional, any case) as numbers, or null. */
export function parseHex(text: string): Rgb | null {
  const m = text.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}
export const toHex = ([r, g, b]: Rgb): string => "#" + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");
const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** WCAG relative luminance, 0 to 1. */
export const luminance = ([r, g, b]: Rgb): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** `a` moved `t` (0 to 1) of the way to `b`. */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb;
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** Luminance at which black and white words are equally readable: (1.05 / (L + 0.05)) = ((L + 0.05) / 0.05), L = 0.179. A primary above it is a light theme. */
export const LIGHT_AT = 0.179;
const saturation = ([r, g, b]: Rgb): number => {
  const hi = Math.max(r, g, b);
  return hi === 0 ? 0 : (hi - Math.min(r, g, b)) / hi;
};
const solid = (v: string | undefined): Rgb | null => (v && /^#[0-9a-f]{6}$/i.test(v.trim()) ? parseHex(v) : null);

export interface CustomResult {
  /** The light or dark theme the colours sit on: `data-theme`. */
  base: Base;
  /** The tokens to set on the root, `--name` to value. */
  vars: Record<string, string>;
  /** The colours used, as `#rrggbb`: what was asked for, after any adjustment. */
  used: CustomColours;
  /** What was changed or refused, in plain words. */
  notes: string[];
}

/** Every colour a person must be able to read on: the page and its two panel colours. */
const GROUND = ["page", "surface", "surface-raised"] as const;
const stepToward = (c: Rgb, base: Base, step: number): Rgb => mix(c, base === "dark" ? BLACK : WHITE, step);

/** How a primary moves the neutral colours: the shift of each fill, line and panel colour from the base theme's page to the primary. */
function shifted(tokens: Tokens, primary: Rgb): Record<string, string> {
  const page = solid(tokens.get("page"));
  const out: Record<string, string> = {};
  if (!page) return out;
  const d = [0, 1, 2].map((i) => primary[i] - page[i]);
  for (const [name, value] of tokens) {
    if (!(name === "page" || name === "surface" || name === "surface-raised" || name.startsWith("fill-") || name.startsWith("line-"))) continue;
    const c = solid(value);
    if (!c) continue; // a veil (rgba) keeps its own look
    if (name !== "page" && name !== "surface" && name !== "surface-raised" && saturation(c) > 0.45) continue; // a status or accent colour keeps its hue
    out[`--${name}`] = toHex([0, 1, 2].map((i) => c[i] + d[i]) as Rgb);
  }
  out["--page"] = toHex(primary);
  return out;
}

/** The colour tokens that follow from the three colours, on the tokens of the base theme they sit on (`tokens` is each base's full map). */
export function deriveCustom(asked: Partial<CustomColours>, tokens: { dark: Tokens; light: Tokens }): CustomResult {
  const notes: string[] = [];
  const colour = (key: keyof CustomColours): Rgb => {
    const given = asked[key];
    const parsed = given === undefined ? null : parseHex(given);
    if (parsed) return parsed;
    if (given !== undefined && given.trim() !== "") notes.push(`${CUSTOM_NAMES[key]} "${given}" is not a hex colour (like #1a2b3c), so the standard one is kept.`);
    return parseHex(DEFAULT_CUSTOM[key])!;
  };
  let primary = colour("primary");
  let highlight = colour("highlight");
  const secondary = colour("secondary");
  const base: Base = luminance(primary) > LIGHT_AT ? "light" : "dark";
  const own = tokens[base];
  const text = solid(own.get("text")) ?? (base === "dark" ? WHITE : BLACK);
  const dim = solid(own.get("text-dim")) ?? text;

  // The primary: every panel colour it makes must carry the theme's words.
  const readable = (p: Rgb) => {
    const ground = shifted(own, p);
    return GROUND.every((g) => {
      const c = solid(ground[`--${g}`]);
      return !c || (contrast(text, c) >= 4.5 && contrast(dim, c) >= 3);
    });
  };
  const wanted = primary;
  for (let i = 0; i < 40 && !readable(primary); i++) primary = stepToward(primary, base, 0.05);
  if (toHex(wanted) !== toHex(primary)) notes.push(`Primary ${toHex(wanted)} was too close to the colour of the words, so it is now ${toHex(primary)} to keep them readable.`);
  const vars = shifted(own, primary);
  const ground = solid(vars["--surface-raised"]) ?? primary;

  // The highlight: 3 : 1 on the panel as a line or icon, 4.5 : 1 as words.
  const wantedHighlight = highlight;
  for (let i = 0; i < 40 && contrast(highlight, ground) < 3; i++) highlight = stepToward(highlight, base === "dark" ? "light" : "dark", 0.05);
  if (toHex(wantedHighlight) !== toHex(highlight)) notes.push(`Highlight ${toHex(wantedHighlight)} was too faint on the panels, so it is now ${toHex(highlight)}.`);
  let words = highlight;
  for (let i = 0; i < 40 && contrast(words, ground) < 4.5; i++) words = mix(words, base === "dark" ? WHITE : BLACK, 0.05);
  const bright = mix(highlight, WHITE, 0.12);
  const deep = mix(highlight, BLACK, 0.12);
  vars["--accent"] = toHex(highlight);
  vars["--accent-bright"] = toHex(bright);
  vars["--accent-deep"] = toHex(deep);
  vars["--accent-text"] = toHex(words);
  // Words on the highlight's fill: the near-black or white with more contrast.
  vars["--on-accent"] = contrast([7, 17, 28], bright) >= contrast(WHITE, bright) ? "#07111c" : "#ffffff";
  // The glows and the chosen-tool tint are the highlight at the base theme's own strengths.
  for (const [name, value] of own) {
    if (!name.startsWith("shade-74-168-255-")) continue;
    const alpha = value.match(/,\s*([\d.]+)\)\s*$/)?.[1];
    if (alpha) vars[`--${name}`] = `rgba(${highlight.map(Math.round).join(", ")}, ${alpha})`;
  }
  return { base, vars, used: { primary: toHex(primary), secondary: toHex(secondary), highlight: toHex(highlight) }, notes };
}

/** The base theme's token maps, read from the page's own stylesheets (the dark block is the root's own; the light block lays over it). */
export function readTokens(doc: Document): { dark: Map<string, string>; light: Map<string, string> } {
  const dark = new Map<string, string>();
  const lightOnly = new Map<string, string>();
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      const r = rule as CSSStyleRule;
      if (r.selectorText !== undefined && r.style) {
        const into = r.selectorText.includes('data-theme="light"') ? lightOnly : r.selectorText.includes("data-scene") ? dark : null;
        if (!into) continue;
        for (let i = 0; i < r.style.length; i++) {
          const n = r.style[i];
          if (n.startsWith("--")) into.set(n.slice(2), r.style.getPropertyValue(n).trim());
        }
      } else if ((rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // A sheet from another origin: not ours.
    }
  }
  return { dark, light: new Map([...dark, ...lightOnly]) };
}
