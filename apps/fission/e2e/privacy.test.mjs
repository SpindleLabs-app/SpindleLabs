// The privacy page keeps up with the code: every address the app's source names
// is either a service the page names, or listed as never contacted
// (outside-services.mjs); and with optional accounts on, the page names the
// account services too. Run by `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNTS } from "../accounts.config.mjs";
import { ACCOUNT_SERVICES, CONTACTED, NOT_CONTACTED } from "../outside-services.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const page = readFileSync(join(root, "apps/fission/public/privacy.html"), "utf8").replace(/<[^>]*>/g, " ");

function sources() {
  const dirs = [];
  for (const top of ["packages", "workspaces"]) for (const d of readdirSync(join(root, top))) dirs.push(join(root, top, d, "src"));
  dirs.push(join(root, "apps/fission/src"));
  const files = [join(root, "apps/fission/index.html")];
  const walk = (d) => {
    let names;
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      if (n === "wasm" || n === "node_modules") continue; // the kernel's committed build is checked by its own release
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mts|js|mjs|html)$/.test(n)) files.push(p);
    }
  };
  dirs.forEach(walk);
  return files;
}

/** Every host in an http(s) address in `text`. */
export function hostsIn(text) {
  return [...text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])/g)].map((m) => m[1].toLowerCase());
}

const covered = (host, list) => list.some((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));

test("hostsIn finds each address's host, and only addresses", () => {
  assert.deepEqual(hostsIn("fetch('https://api.example.org/v1') or http://[::1]:8 and ftp://x.org, https:// alone"), ["api.example.org", "[::1]"]);
});

test("every address in the app's source is a service the privacy page names, or listed as never contacted", () => {
  const unknown = [];
  for (const f of sources()) {
    for (const host of hostsIn(readFileSync(f, "utf8"))) {
      if (covered(host, CONTACTED) || covered(host, ACCOUNT_SERVICES) || NOT_CONTACTED.some((n) => n.host === host)) continue;
      unknown.push(`${f.slice(root.length)}: ${host}`);
    }
  }
  assert.deepEqual(unknown, [], "add each to outside-services.mjs (and, if contacted, to the privacy page)");
});

test("the privacy page names every service the app can contact", () => {
  for (const s of CONTACTED) assert.ok(page.includes(s.name), `privacy.html doesn't mention ${s.name} (${s.why})`);
});

test("with accounts on, the privacy page names the account services; with them off it claims no accounts exist", () => {
  if (ACCOUNTS) {
    for (const s of ACCOUNT_SERVICES) assert.ok(page.includes(s.name), `accounts are on but privacy.html doesn't mention ${s.name} (${s.why})`);
  } else {
    assert.match(page, /no accounts/, "while accounts are off the page says so");
  }
});

test("the check can fail: a page missing a service, or an unlisted address, is caught", () => {
  const without = page.replace(/Hugging Face/g, "a model site");
  assert.equal(CONTACTED.every((s) => without.includes(s.name)), false);
  assert.equal(covered("tracker.example.net", CONTACTED) || NOT_CONTACTED.some((n) => n.host === "tracker.example.net"), false);
  assert.equal(covered("eu.api.anthropic.com", CONTACTED), true); // a subdomain of a named service counts as that service
});

test("the privacy page has no unfilled blanks", () => {
  assert.equal(/\{\{|\}\}/.test(page), false, "privacy.html still has a {{…}} blank to fill");
});

// My designs (account features 1): the page says what is kept, the first-time question, and the limits the code uses.
test("with My designs in the app, the privacy page says what it keeps, when it is sent, and its limits", () => {
  const designs = readFileSync(join(root, "packages/account/src/designs.ts"), "utf8");
  const n = (name) => Number(new RegExp(`${name}: ([\\d* ]+)`).exec(designs)[1].split("*").reduce((a, b) => a * Number(b), 1));
  const MIB = 1024 * 1024;
  assert.equal(n("maxDesigns"), 200);
  const words = page.replace(/\s+/g, " ");
  assert.match(words, new RegExp(`up to ${n("maxDesigns")} designs and ${n("maxBytes") / MIB} MB in all, each design up to ${n("maxDesignBytes") / MIB} MB`));
  for (const must of ["My designs", "its project file", "a small picture of it", "which workspace it was last saved from", "nothing is sent until you choose", "Keep my designs in my account", "Deleting your account deletes every design in it", "including every design in your account"]) assert.ok(words.includes(must), `the page says "${must}"`);
  assert.ok(!/Your designs stay in your browser on your device: the people who make SpindleLabs never receive them/.test(words), "the old promise that designs never leave the device is gone");
});

// Earlier versions in the account (account features 2): the page says how many and how often, as the code keeps them.
test("with earlier versions in the account, the privacy page says how often, how many, the space and deleting", () => {
  const designs = readFileSync(join(root, "packages/account/src/designs.ts"), "utf8");
  const n = (name) => Number(new RegExp(`${name}: (\\d+)`).exec(designs)[1]);
  const words = page.replace(/\s+/g, " ");
  assert.ok(words.includes(`at most one every ${n("versionGapMinutes")} minutes and the newest ${n("versionsKept")} of each design`), "how often and how many, as the code says");
  for (const must of ["Earlier versions:", "Nothing extra is sent for this", "with earlier versions counted in the 20 MB", "the oldest earlier versions are deleted first", "deletes a design and its earlier versions", "its earlier versions"]) assert.ok(words.includes(must), `the page says "${must}"`);
});
