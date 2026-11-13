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
  assert.ok(words.includes(`always keeps a version that was left unchanged for ${n("versionGapMinutes")} minutes or more`), "the state a session ended in is kept (issue #628, item 3)");
  for (const must of ["Earlier versions:", "Nothing extra is sent for this", "with earlier versions counted in the 20 MB", "the oldest earlier versions are deleted first", "deletes a design and its earlier versions", "its earlier versions"]) assert.ok(words.includes(must), `the page says "${must}"`);
});

// Settings that follow you (account features 3): the page lists every setting the code sends, and the code's limits.
const syncedSettings = () => [...readFileSync(join(root, "apps/fission/src/settings-sync.ts"), "utf8").matchAll(/\{ key: "([^"]+)", kind: "[a-z-]+", words: "([^"]+)" \}/g)].map((m) => ({ key: m[1], words: m[2] }));
/** The settings sent that the page (as text) doesn't name. */
const unnamedSettings = (text) => syncedSettings().filter((s) => !text.replace(/\s+/g, " ").includes(s.words));

test("with settings that follow you, the privacy page lists every setting sent, what never is, and the limits", () => {
  const listed = syncedSettings();
  assert.ok(listed.length >= 6, "the list in settings-sync.ts was read");
  assert.deepEqual(unnamedSettings(page), []);
  for (const s of listed) assert.ok(!/ai|key|session|account/i.test(s.key.replace(/^spindlelabs/, "")), `${s.key} must never be an AI key, a sign-in or account data`);
  const words = page.replace(/\s+/g, " ");
  const settings = readFileSync(join(root, "packages/account/src/settings.ts"), "utf8");
  const n = (name) => Number(new RegExp(`${name}: ([\\d* ]+)`).exec(settings)[1].split("*").reduce((a, b) => a * Number(b), 1));
  assert.match(words, new RegExp(`up to ${n("maxSettings")} settings and ${n("maxBytes") / 1024} KB in all`));
  for (const must of ["Settings that follow you", "the AI assistant's settings and any AI key", "Keep my settings in my account", "deletes the settings kept in your account straight away", "the settings in your account replace this browser's own", "and the settings kept in it"]) assert.ok(words.includes(must), `the page says "${must}"`);
});

test("the settings check can fail: a page missing one setting's words is caught", () => {
  assert.deepEqual(unnamedSettings(page.replace(/your slicer presets/g, "some things")).map((s) => s.key), ["spindlelabs.slice.presets"]);
});

test("every setting that follows you is a key the app really keeps (a renamed key would silently stop following)", () => {
  const all = sources().filter((f) => !f.endsWith("settings-sync.ts")).map((f) => readFileSync(f, "utf8")).join("\n");
  const missing = syncedSettings().filter(({ key }) => {
    if (all.includes(`"${key}"`)) return false;
    // A key built from a template, such as `spindlelabs.fits.${nozzle}`: its fixed start, and the rest as a value the app uses.
    const m = /^(.*\.)([^.]+)$/.exec(key);
    return !(m && all.includes("`" + m[1] + "${") && all.includes(`"${m[2]}"`));
  });
  assert.deepEqual(missing.map((s) => s.key), []);
});

// Friends (account features 6): the page says what is kept and who sees it, with the limits the code (and so the
// migration, checked by packages/account test/friends.test.ts) has.
const friendsLimits = () => {
  const code = readFileSync(join(root, "packages/account/src/friends.ts"), "utf8");
  const n = (name) => Number(new RegExp(`${name}: (\\d+)`).exec(code)[1]);
  return { maxFriends: n("maxFriends"), maxWaiting: n("maxWaiting"), triesADay: n("triesADay"), requestDays: n("requestDays"), codeLength: n("codeLength") };
};
/** What the page (as text) is missing about Friends. */
function friendsGaps(text) {
  const words = text.replace(/\s+/g, " ");
  const l = friendsLimits();
  const must = [
    "Friends",
    "Nobody can search for you",
    "the only way anyone can ask you is by typing your exact profile ID",
    `your profile ID (${l.codeLength} random letters and digits)`,
    "you see only the ID you typed, never their name",
    "Friends see each other's display name and the day they became friends",
    "never told to the other person",
    `up to ${l.maxFriends} friends, ${l.maxWaiting} requests waiting at once, and ${l.triesADay} profile IDs typed a day`,
    `Requests are deleted after ${l.requestDays} days`,
    "the people you blocked stay blocked",
    "Download my data includes your profile ID, friends, requests and blocks",
    "the settings kept in it, and your friends",
  ];
  return must.filter((m) => !words.includes(m));
}

test("with Friends, the privacy page says what is kept, who sees what, saying no, the limits and turning it off", () => {
  assert.deepEqual(friendsGaps(page), []);
});

test("the Friends check can fail: a page with another limit, or missing who sees what, is caught", () => {
  assert.ok(friendsGaps(page.replace("up to 200 friends", "up to 500 friends")).length > 0);
  assert.ok(friendsGaps(page.replace("you see only the ID you typed, never their name", "you see their name")).length > 0);
});
