// Offline mode: writes the service worker (sw.js beside this file) into the
// built app as offline-sw.js, with the build's version and the files it
// keeps, and the clean-up worker (sw-off.js) as sw.js, the name an earlier
// build registered the offline worker under. vite.config.ts runs
// `offlinePlugin()`; `writeServiceWorker(dir)` does the same to any built
// folder (the update test makes a second version with it).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { OFFLINE_MODE } from "./offline.config.mjs";

const TEMPLATE = fileURLToPath(new URL("./sw.js", import.meta.url));
const KILL_SWITCH = fileURLToPath(new URL("./sw-off.js", import.meta.url));
/** The name of the list of on-demand chunks the build leaves beside the app (read here, never served as a page). */
export const ON_DEMAND = "on-demand.json";
/** The offline worker's name in the built app. Every build has it: offline.ts registers it for everyone once offline mode is released, and before that for a browser that asked with `?offline` (src/offline-switch.ts). */
export const WORKER = "offline-sw.js";
/** The clean-up worker's name: what the build of 2026-10-28 registered as its offline worker, so a browser that still has that one finds this and is cleaned. */
export const KILL_NAME = "sw.js";

/** Every file under `dir`, as forward-slash paths relative to it, sorted. */
export function filesIn(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Files of the build the service worker never keeps: CNAME names the custom
 * domain for GitHub Pages, which reads it and need not serve it, and one
 * file the server doesn't give stops the whole install.
 */
const NEVER_KEPT = new Set(["CNAME"]);

/**
 * The build's version and the files to keep. `files` maps each path to
 * its bytes; the two workers and the on-demand list are never part of it.
 * Also each kept or on-demand file's SHA-256 (the worker checks every
 * answer against it) and the bytes kept (to see there is room first).
 * The version is the first 16 hex digits of SHA-256 over one line per
 * file (path, a NUL, the SHA-256 of its bytes), sorted by path, so it
 * changes when any byte, name, added or removed file does, and only then.
 */
export function buildInfo(files, onDemand = []) {
  const paths = Object.keys(files)
    .filter((p) => p !== WORKER && p !== KILL_NAME && p !== ON_DEMAND)
    .sort();
  const hashOf = Object.fromEntries(paths.map((p) => [p, createHash("sha256").update(files[p]).digest("hex")]));
  const lines = paths.map((p) => `${p}\0${hashOf[p]}\n`).join("");
  const version = createHash("sha256").update(lines).digest("hex").slice(0, 16);
  const lazy = new Set(onDemand);
  const precache = paths.filter((p) => !lazy.has(p) && !NEVER_KEPT.has(p));
  const listed = paths.filter((p) => lazy.has(p));
  const hashes = Object.fromEntries([...precache, ...listed].sort().map((p) => [p, hashOf[p]]));
  const size = precache.reduce((n, p) => n + Buffer.byteLength(files[p]), 0);
  return { version, precache, onDemand: listed, hashes, size };
}

/** The service worker's source for `info`. */
export function serviceWorkerSource(info) {
  return `self.__SPINDLELABS_BUILD__ = ${JSON.stringify(info)};\n${readFileSync(TEMPLATE, "utf8")}`;
}

/** Writes the clean-up worker (sw-off.js) as sw.js, for a browser that still has the 2026-10-28 build's worker. */
export function writeKillSwitch(dir) {
  writeFileSync(join(dir, KILL_NAME), readFileSync(KILL_SWITCH, "utf8"));
}

/** Writes the offline worker into the built folder `dir` as `name` (offline-sw.js; the checks of an old install write it as sw.js); returns its build info. */
export function writeServiceWorker(dir, name = WORKER) {
  const files = {};
  for (const p of filesIn(dir)) files[p] = readFileSync(join(dir, p));
  const onDemand = files[ON_DEMAND] ? JSON.parse(files[ON_DEMAND].toString("utf8")) : [];
  const info = buildInfo(files, onDemand);
  writeFileSync(join(dir, name), serviceWorkerSource(info));
  return info;
}

/**
 * Modules main.ts loads by import() on every start, so kept at install like
 * the rest: the account code (only in a build with accounts on).
 */
export const AT_START = [fileURLToPath(new URL("./src/account.ts", import.meta.url))];

/**
 * The chunks only loaded on demand (by import(), never statically, and not
 * on every start), so not kept at install: the in-browser AI's library is
 * 6 MB, and it fetches its model from the network anyway. Kept the first
 * time they load.
 */
export function onDemandChunks(bundle) {
  const chunks = Object.values(bundle).filter((c) => c.type === "chunk");
  const statically = new Set(chunks.flatMap((c) => c.imports));
  const atStart = (c) => c.facadeModuleId !== undefined && AT_START.includes(resolve(c.facadeModuleId));
  return chunks.filter((c) => c.isDynamicEntry && !c.isEntry && !statically.has(c.fileName) && !atStart(c)).map((c) => c.fileName);
}

/**
 * The Vite plugin. Always: the on-demand chunks listed, and once the whole
 * build (workers too) is on disk the offline worker (offline-sw.js) and the
 * clean-up worker (sw.js) written. With offline mode on for everyone, also
 * the manifest link in index.html; off, offline.ts adds it only in a
 * browser that chose offline (`?offline`), so no one else is offered an
 * install.
 */
export function offlinePlugin(enabled = OFFLINE_MODE) {
  let outDir = "";
  return {
    name: "spindlelabs-offline",
    apply: "build",
    configResolved(config) {
      // resolve, not join: a full path (a plant build into the temp folder) stays itself.
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml() {
      return enabled ? [{ tag: "link", attrs: { rel: "manifest", href: "./manifest.webmanifest" }, injectTo: "head" }] : [];
    },
    generateBundle(_options, bundle) {
      this.emitFile({ type: "asset", fileName: ON_DEMAND, source: JSON.stringify(onDemandChunks(bundle)) });
    },
    closeBundle() {
      writeKillSwitch(outDir);
      writeServiceWorker(outDir);
    },
  };
}
