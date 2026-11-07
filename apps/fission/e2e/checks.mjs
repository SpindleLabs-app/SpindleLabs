// The browser checks `npm run e2e` runs (and CI splits with shard.mjs): every
// .mjs file in this folder, found by reading the folder, so a new check runs
// as soon as its file is added and no pull request has to edit one shared
// line of package.json. Only the files below are not checks; each says why.
// smoke.mjs runs first, as the quickest sign the build works, then the rest by
// name. A check that imports TypeScript (a "./x.ts" path) runs with Node's
// type stripping.
import { readdirSync, readFileSync } from "node:fs";

/** Files other checks import, never run on their own (e2e/checks.test.mjs checks each is still imported). */
export const HELPERS = [
  "backdrop.mjs",
  "browser.mjs",
  "kernel-cap.mjs",
  "live-site.mjs",
  "monkey-core.mjs",
  "monkey-units.mjs",
  "png.mjs",
  "properties.mjs",
  "sketch-screen.mjs",
  "soak-judge.mjs",
  "soak-model.mjs",
  "start.mjs",
];

/** Files run somewhere else, or by hand. */
export const ELSEWHERE = {
  "checks.mjs": "this list",
  "shard.mjs": "the runner that runs the checks",
  "soak.mjs": "the nightly random testing (40 minutes)",
  "monkey-plants.mjs": "proof the monkey catches bugs, run by hand (npm test checks its plants still apply)",
  "soak-plants.mjs": "proof the soak test catches bugs, run by hand (npm test checks its plants still apply)",
  "_shots.mjs": "scratch screenshots, run by hand",
};

/** The check that runs first. */
export const FIRST = "smoke.mjs";

/** Whether a check's source imports TypeScript, so needs Node's type stripping. */
export const importsTypeScript = (source) => /(?:\bfrom\s*|\bimport\s*\(?\s*)["'][^"']+\.ts["']/.test(source);

/**
 * The commands for the checks among `files` (names in this folder), `read` giving a file's source:
 * every .mjs that is not a test (*.test.mjs, run by npm test), a helper or run elsewhere; FIRST first, then by name.
 */
export function checkCommands(files, read) {
  const skip = new Set([...HELPERS, ...Object.keys(ELSEWHERE)]);
  const names = files.filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && !skip.has(f));
  names.sort((a, b) => (a === FIRST ? -1 : b === FIRST ? 1 : a < b ? -1 : a > b ? 1 : 0));
  return names.map((f) => (importsTypeScript(read(f)) ? `node --experimental-strip-types --no-warnings e2e/${f}` : `node e2e/${f}`));
}

/** The commands for the checks in this folder. */
export function allChecks() {
  const dir = new URL("./", import.meta.url);
  return checkCommands(readdirSync(dir), (f) => readFileSync(new URL(f, dir), "utf8"));
}
