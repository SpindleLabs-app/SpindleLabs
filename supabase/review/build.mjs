// The review page as plain files, for a host with no server of its own (community C5b, for a moderator with no
// terminal): `node supabase/review/build.mjs <folder>` writes index.html (its content security policy in the page,
// filled with the account service's address), review.js, review.css and config.json (public values only) there.
// The mirror (SpindleLabs-app.github.io) writes it into its copy of the site as /review/, so the page opens at
// https://spindlelabs-app.github.io/review/; it is never part of the app's own build (apps/fission/dist).
// Safe to publish: the page holds no secret and decides nothing; the moderation function checks every request
// against its MODERATORS list on the server, and review.js refuses to run inside another page's frame.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pageConfig, pageHtml } from "./serve.mjs";

export function buildReview(folder) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "index.html"), pageHtml());
  for (const name of ["review.js", "review.css"]) writeFileSync(join(folder, name), readFileSync(new URL(name, import.meta.url)));
  writeFileSync(join(folder, "config.json"), JSON.stringify(pageConfig()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const folder = process.argv[2];
  if (!folder) {
    console.error("usage: node supabase/review/build.mjs <folder>");
    process.exit(2);
  }
  buildReview(folder);
  console.log(`Review page written to ${folder}`);
}
