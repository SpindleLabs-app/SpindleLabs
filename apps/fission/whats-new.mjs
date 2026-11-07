// What's new for the build (Settings > About > What's new): the text of WHATS_NEW.md with every public line not
// folded in yet written in under its version, and the app's version, both from `changelog.py public` and
// `changelog.py version`. Those number the entries from main's history, so a clone without it (CI's shallow
// checkout, a fresh fork) or a machine without Python gets WHATS_NEW.md as committed and no version: never a
// number made up. The live site's build fetches the whole history (pages.yml), so it lists every release.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../../.github/scripts/changelog.py", import.meta.url));

/**
 * { text, version }: the numbered list and version, or the committed file and null when they can't be worked out.
 * `exact` (SPINDLE_WHATS_NEW_EXACT=1, the live build in pages.yml) throws instead of falling back, so the live site
 * never ships without the newest changes. `run` is execFileSync (a test passes a fake).
 */
export function whatsNew(run = execFileSync, read = (path) => readFileSync(path, "utf8"), exact = process.env.SPINDLE_WHATS_NEW_EXACT === "1") {
  const ask = (command) => run("python3", [SCRIPT, command, ROOT], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  try {
    const text = ask("public");
    const version = ask("version").trim();
    if (/^\d+\.\d+\.\d+$/.test(version) && text.startsWith("# What's new")) return { text, version };
  } catch (e) {
    // No history, no Python, or a changelog problem (CI's own check reports those): fall back below.
    if (exact) throw new Error(`What's new needs main's whole history (git fetch --unshallow) and Python: ${e.stdout || e.message}`);
  }
  if (exact) throw new Error("What's new: changelog.py gave no version or no list");
  return { text: read(`${ROOT}WHATS_NEW.md`), version: null };
}
