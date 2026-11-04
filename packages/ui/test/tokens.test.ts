import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// U1a: every colour the app's stylesheets paint with is a named token whose
// (dark) value is written once, in the colour-token block of theme.css. A raw
// colour anywhere else is refused, so the light theme (U1b) has one place to
// override and nothing can be missed; and every var(--name) a stylesheet uses
// must be defined, so a typo cannot silently paint nothing.
const repo = resolve(import.meta.dirname, "../../..");

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "target" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

const noComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const RAW = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

/** The colour-token block of theme.css (from its comment to the closing brace), or "" when it is gone. */
function tokenBlock(theme: string): string {
  const at = theme.indexOf("The colour tokens (U1a");
  if (at < 0) return "";
  const open = theme.indexOf(':root, [data-scene="dark"] {', at);
  const end = theme.indexOf("/* end of the colour tokens", open);
  return theme.slice(open, end < 0 ? theme.indexOf("\n}", open) + 2 : end);
}

/** Raw colours found outside the token block, as "file: colour" lines. */
export function rawColours(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [name, css] of files) {
    let body = noComments(css);
    if (name.endsWith("theme.css")) body = body.replace(noComments(tokenBlock(css)), "");
    for (const m of body.matchAll(RAW)) out.push(`${name}: ${m[0]}`);
  }
  return out;
}

/** var(--x) names used in the files but defined nowhere (a --x: declaration). */
export function undefinedTokens(files: Map<string, string>): string[] {
  const all = [...files.values()].map(noComments).join("\n");
  const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const out = new Set<string>();
  for (const m of all.matchAll(/var\((--[a-z0-9-]+)\s*[,)]/g)) if (!defined.has(m[1])) out.add(m[1]);
  return [...out].sort();
}

const files = new Map<string, string>();
for (const dir of ["packages", "workspaces", "apps"]) for (const p of cssFiles(join(repo, dir))) files.set(relative(repo, p), readFileSync(p, "utf8"));
const themeKey = "packages/ui/src/theme.css";

test("the stylesheets are found (the check cannot pass by looking at nothing)", () => {
  assert.ok(files.size > 40, `only ${files.size} css files`);
  assert.ok(files.has(themeKey));
  assert.ok(tokenBlock(files.get(themeKey)!).includes("--accent: #4aa8ff;"));
});

test("no raw colour outside the token block of theme.css", () => {
  assert.deepEqual(rawColours(files), []);
});

test("every var(--name) a stylesheet uses is defined", () => {
  assert.deepEqual(undefinedTokens(files), []);
});

test("the dark values are the ones the app has always had (hand-checked: the accent blue and the page navy)", () => {
  const block = tokenBlock(files.get(themeKey)!);
  // #4aa8ff = rgb(74, 168, 255): 0x4a = 4*16+10 = 74, 0xa8 = 10*16+8 = 168, 0xff = 255.
  assert.match(block, /--accent: #4aa8ff;/);
  // #0f141c = rgb(15, 20, 28): 0x0f = 15, 0x14 = 20, 0x1c = 28.
  assert.match(block, /--page: #0f141c;/);
});

test("the check fails on a raw colour in a feature file, a raw rgba, and a misspelt token", () => {
  const broken = new Map(files);
  const f = "packages/ui/src/styles/menu-button.css";
  broken.set(f, broken.get(f)! + "\n.menu-button { color: #fff; background: rgba(0, 0, 0, 0.5); border-color: var(--acent); }\n");
  assert.deepEqual(rawColours(broken), [`${f}: #fff`, `${f}: rgba(`]);
  assert.deepEqual(undefinedTokens(broken), ["--acent"]);
  // A raw colour in theme.css outside the block is refused too; inside the block it is the point.
  const theme = files.get(themeKey)! + "\nbody { color: #123456; }\n";
  broken.set(themeKey, theme);
  assert.deepEqual(rawColours(broken).filter((l) => l.startsWith(themeKey)), [`${themeKey}: #123456`]);
});
