// Splits `npm run e2e` across CI's parallel e2e jobs: `node e2e/shard.mjs 2 3`
// runs the second of three shares, and `npm run e2e` is `shard.mjs 1 1`, all
// of them. The checks are every browser check file in this folder
// (checks.mjs), so a new check runs in some shard without touching CI or
// package.json. Each share runs every one of its checks, even after a failure,
// and fails if any did.
import { spawnSync } from "node:child_process";
import { allChecks } from "./checks.mjs";

/** Seconds each check took on CI (merge queue run 44522338962, 2026-11-19, all five shares: 8,081 s in all), to even out the shares; a check not listed counts as `UNKNOWN`.
 * Only the balance depends on them: a wrong or missing entry makes one share slower, never skips a check. Refresh them from a run's
 * shares when one share runs well past the others: each prints its checks' seconds on its last line. */
export const SECONDS = {
  "smoke.mjs": 190,
  "account.mjs": 65,
  "app-bar.mjs": 39,
  "app-updated.mjs": 62,
  "assistant.mjs": 223,
  "beginner-mistakes.mjs": 58,
  "big-saveload.mjs": 34,
  "bodies.mjs": 90,
  "body-mass.mjs": 8,
  "body-numbers.mjs": 13,
  "browser-tabs.mjs": 30,
  "bug-report.mjs": 7,
  "build-area.mjs": 12,
  "centre-arc.mjs": 35,
  "chamfer-arrow.mjs": 37,
  "chamfer-face-sketch.mjs": 10,
  "chamfer.mjs": 17,
  "closed-views.mjs": 92,
  "combine-check.mjs": 44,
  "combine-copy.mjs": 22,
  "combine-cut-ask.mjs": 14,
  "combine-history.mjs": 58,
  "combine-level-walls.mjs": 5,
  "combine-move.mjs": 11,
  "combine-pieces.mjs": 15,
  "combine-pins.mjs": 20,
  "combine-refused.mjs": 9,
  "combine.mjs": 46,
  "command-search-button.mjs": 12,
  "construct-snap.mjs": 18,
  "construct-use.mjs": 19,
  "construct.mjs": 15,
  "copy-svg-face.mjs": 15,
  "copy-svg-hole.mjs": 6,
  "copy-svg.mjs": 14,
  "custom-theme.mjs": 13,
  "design-defaults.mjs": 10,
  "display-name.mjs": 16,
  "double-press.mjs": 27,
  "duplicate.mjs": 15,
  "edge-lines.mjs": 105,
  "explode.mjs": 15,
  "export-3mf.mjs": 18,
  "export-failed.mjs": 5,
  "export-rebuilding.mjs": 16,
  "extrude-drag.mjs": 33,
  "extrude-operation.mjs": 28,
  "extrude-regions.mjs": 34,
  "extrude-several-curved.mjs": 5,
  "extrude-several.mjs": 8,
  "extrude-symmetric.mjs": 6,
  "extrude-through.mjs": 12,
  "extrude-units.mjs": 16,
  "extrude.mjs": 69,
  "face-corner-constraints.mjs": 9,
  "face-edges.mjs": 46,
  "face-hunt.mjs": 32,
  "face-sketch.mjs": 80,
  "file-notice.mjs": 5,
  "files-hunt.mjs": 13,
  "files.mjs": 34,
  "fit-tag.mjs": 17,
  "framing.mjs": 13,
  "free-placement.mjs": 45,
  "friends.mjs": 11,
  "fusion-picks.mjs": 41,
  "guide.mjs": 268,
  "hidden-edges.mjs": 68,
  "history.mjs": 24,
  "home-backdrop.mjs": 100,
  "home.mjs": 2,
  "image.mjs": 30,
  "insert.mjs": 33,
  "journeys.mjs": 199,
  "kept-history.mjs": 39,
  "kernel-lost.mjs": 37,
  "kernel-restart.mjs": 17,
  "laser-face.mjs": 19,
  "laser-page.mjs": 44,
  "laser-select.mjs": 8,
  "layout.mjs": 39,
  "leave-save.mjs": 68,
  "library-publish.mjs": 13,
  "long-part.mjs": 23,
  "lost-work.mjs": 38,
  "measure.mjs": 12,
  "merged-face-sketch.mjs": 7,
  "mirror-scale.mjs": 34,
  "monkey.mjs": 595,
  "motion.mjs": 6,
  "mouse-presets.mjs": 20,
  "move-bodies.mjs": 23,
  "move-drag.mjs": 95,
  "move-face-sketch.mjs": 21,
  "move-units.mjs": 7,
  "move.mjs": 47,
  "my-designs.mjs": 75,
  "navigation.mjs": 76,
  "no-webgl.mjs": 6,
  "offline-off.mjs": 18,
  "offline.mjs": 44,
  "ok-then-leave.mjs": 11,
  "ok-then-open.mjs": 88,
  "open-file.mjs": 24,
  "open-tool-export.mjs": 43,
  "parameters-follow.mjs": 8,
  "pattern-axis.mjs": 12,
  "pattern.mjs": 15,
  "phone-community.mjs": 3,
  "phone-file-exports.mjs": 8,
  "phone-float-extrude.mjs": 21,
  "phone-leftovers.mjs": 19,
  "phone-menus.mjs": 17,
  "phone-review.mjs": 3,
  "phone-sheet.mjs": 112,
  "phone-short.mjs": 23,
  "phone-sideways.mjs": 72,
  "phone-sketch-pan.mjs": 14,
  "phone-sketch-row.mjs": 8,
  "phone-sketch-touch.mjs": 80,
  "phone-start.mjs": 9,
  "phone-undo-sheet.mjs": 6,
  "phone-widths.mjs": 18,
  "plane-tint.mjs": 67,
  "point-drag.mjs": 45,
  "presets.mjs": 52,
  "preview-switches.mjs": 12,
  "print-check.mjs": 7,
  "print-log-sync.mjs": 53,
  "print-log.mjs": 16,
  "print-preview.mjs": 174,
  "printer-fits.mjs": 25,
  "project-name.mjs": 6,
  "projection-hunt.mjs": 26,
  "projection.mjs": 13,
  "projects.mjs": 66,
  "refit-angle.mjs": 6,
  "rename.mjs": 52,
  "reopen.mjs": 109,
  "restart-heal.mjs": 13,
  "restart-panels.mjs": 11,
  "retry-row.mjs": 35,
  "review-page.mjs": 1,
  "save-name.mjs": 40,
  "save-picker.mjs": 42,
  "select-lists.mjs": 15,
  "settings-follow.mjs": 57,
  "settings.mjs": 7,
  "share-likes.mjs": 10,
  "share.mjs": 38,
  "shell.mjs": 26,
  "shortcuts.mjs": 10,
  "size-text.mjs": 29,
  "skeleton.mjs": 8,
  "sketch-constraints.mjs": 19,
  "sketch-construction.mjs": 10,
  "sketch-dimensions.mjs": 25,
  "sketch-pixels.mjs": 12,
  "sketch-select.mjs": 10,
  "sketch-session.mjs": 240,
  "sketch-shapes.mjs": 30,
  "sketch-shell.mjs": 32,
  "sketch-tool.mjs": 101,
  "sketch-toolbar.mjs": 41,
  "sketch-units.mjs": 38,
  "sketch-view.mjs": 25,
  "sketch.mjs": 10,
  "slice-page.mjs": 75,
  "slice-presets.mjs": 25,
  "slice-print-fixes.mjs": 164,
  "slice-print.mjs": 45,
  "slice-settings-fold.mjs": 31,
  "snap-control.mjs": 22,
  "snap.mjs": 22,
  "solid-badge.mjs": 8,
  "storage-failing.mjs": 65,
  "storage-full.mjs": 127,
  "storage.mjs": 2,
  "styles.mjs": 1,
  "summary-units.mjs": 5,
  "switching.mjs": 33,
  "tablet-targets.mjs": 17,
  "tabs.mjs": 1,
  "testlab-page.mjs": 21,
  "theme.mjs": 16,
  "timeline-card.mjs": 22,
  "timeline.mjs": 336,
  "toolbar.mjs": 27,
  "tooltip.mjs": 17,
  "typed-entry.mjs": 81,
  "undo-open-tool.mjs": 50,
  "undo-settle-order.mjs": 10,
  "undo.mjs": 187,
  "units.mjs": 16,
  "versions.mjs": 26,
  "view-menu.mjs": 19,
  "whats-new.mjs": 4,
  "workspace-list.mjs": 11,
};
export const UNKNOWN = 30;

/** The file a command runs, e.g. "smoke.mjs". */
export const fileOf = (command) => command.slice(command.lastIndexOf("/") + 1);

/** `cmds` dealt into `n` shares, longest first onto the lightest share; every command lands in exactly one, in the order given. */
export function shares(cmds, n, seconds = SECONDS) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`shard count must be a whole number from 1: ${n}`);
  const cost = (c) => seconds[fileOf(c)] ?? UNKNOWN;
  const order = cmds.map((c, i) => i).sort((a, b) => cost(cmds[b]) - cost(cmds[a]) || a - b);
  const load = Array(n).fill(0);
  const owner = [];
  for (const i of order) {
    let k = 0;
    for (let j = 1; j < n; j++) if (load[j] < load[k]) k = j;
    owner[i] = k;
    load[k] += cost(cmds[i]);
  }
  return load.map((_, k) => cmds.filter((_, i) => owner[i] === k));
}

/** Why a share must not run with this environment, or null. Nineteen checks
 * skip every case whose name lacks `ONLY`, so a leftover ONLY would run none
 * of them and still pass (test audit E-11): a share runs every check. */
export function refusal(env) {
  return env.ONLY ? `ONLY is set (${JSON.stringify(env.ONLY)}): a share runs every check, so unset it` : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const why = refusal(process.env);
  if (why) {
    console.log(why);
    process.exit(1);
  }
  const [k, n] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(k) || k < 1 || k > n) throw new Error(`usage: node e2e/shard.mjs <1..n> <n>, got ${k} ${n}`);
  const mine = shares(allChecks(), n)[k - 1];
  console.log(`e2e share ${k} of ${n}: ${mine.map(fileOf).join(", ")}`);
  const failed = [];
  const took = [];
  for (const c of mine) {
    console.log(`\n=== ${c}`);
    const start = Date.now();
    const r = spawnSync(c, { shell: true, stdio: "inherit" });
    took.push(`${fileOf(c)} ${Math.round((Date.now() - start) / 1000)} s`);
    if (r.status !== 0) failed.push(fileOf(c));
  }
  console.log(`\n${took.join(", ")}`);
  if (failed.length) {
    console.log(`FAILED: ${failed.join(", ")}`);
    process.exit(1);
  }
}
