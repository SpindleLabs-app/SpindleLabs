// Shared pieces of save-picker.mjs (export hunt 2026-11-12, SL #644): the page launcher (also open-file.mjs's and browser-tabs.mjs's, on their own ports) and a stand-in save picker whose files are real browser files. Port 4796.
import { launch } from "./browser.mjs";
import { preview } from "vite";
export const PORT = 4796;
export async function boot(port = PORT) {
  const server = await preview({ preview: { port, strictPort: true }, logLevel: "error" });
  const browser = await launch();
  return { server, browser, url: `http://localhost:${port}/`, close: async () => { await browser.close(); await server.close(); } };
}
let failed = 0;
export const fails = () => failed;
export async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n  ${String(e.stack ?? e).split("\n").slice(0, 6).join("\n  ")}`); }
}
/**
 * A save picker like Chrome's, but its files are REAL browser files (the origin's private file system), so
 * createWritable / write / close behave as the browser's own do. __fault = { at: "create"|"write"|"close", times }
 * makes the next writes fail there; __abortNext closes the picker (AbortError); __hold keeps the picker open until
 * __release() and refuses a second picker meanwhile as Chrome does (NotAllowedError "File picker already active").
 */
export const REAL_FILE_PICKER = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  window.__picks = [];
  window.__writes = [];
  window.__fault = null;
  window.__abortNext = false;
  window.__hold = false;
  let active = null;
  const wrap = (real, name) => ({
    name,
    createWritable: async () => {
      const f = window.__fault;
      const hit = (at) => f && f.at === at && f.times > 0 && (f.times--, true);
      if (hit("create")) throw Object.assign(new Error("permission was taken away"), { name: "NotAllowedError" });
      const w = await real.createWritable();
      return {
        write: async (d) => {
          if (hit("write")) return w.write({ type: "write" }); // a REAL failed write (no data): the browser's own stream goes bad, as it does when the disk is full
          window.__writes.push(name);
          return w.write(d);
        },
        close: async () => {
          if (hit("close")) { await w.abort(); return w.close(); } // a REAL failed close
          return w.close();
        },
      };
    },
  });
  window.showSaveFilePicker = async (o) => {
    window.__picks.push(o.suggestedName);
    if (active) throw Object.assign(new Error("File picker already active."), { name: "NotAllowedError" });
    if (window.__abortNext) { window.__abortNext = false; throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" }); }
    if (window.__hold) { await (active = new Promise((r) => (window.__release = r))); active = null; }
    const name = window.__chosen ?? o.suggestedName;
    const dir = await navigator.storage.getDirectory();
    return wrap(await dir.getFileHandle(name, { create: true }), name);
  };
  window.__read = async (name) => {
    const dir = await navigator.storage.getDirectory();
    try { return await (await (await dir.getFileHandle(name)).getFile()).text(); } catch (e) { return `<<no file: ${e.name}>>`; }
  };
};
export const NO_PICKER = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  delete window.showSaveFilePicker;
};
export const readFile = (page, name) => page.evaluate((n) => window.__read(n), name);
/** The first preset's sizes in a saved project text, e.g. {width:40,depth:30,height:20}; and all features' summaries. */
export function shapeOf(text) {
  const p = JSON.parse(text);
  const d = p.workspaces.design;
  return { profiles: (d.profiles ?? []).map((x) => ({ kind: x.kind, width: x.width, depth: x.depth })), features: (d.timeline ?? d.features ?? []).map((f) => `${f.type ?? ""}:${f.intent?.summary ?? ""}:${JSON.stringify(f.parameters ?? f.intent?.parameters ?? {}).slice(0, 120)}`), name: p.name };
}
export const mark = (page) => page.evaluate(() => document.querySelector("#save-status")?.textContent);
export const status = (page) => page.evaluate(() => document.querySelector("#file-status")?.textContent);
/** Every key of the app's store (IndexedDB "fission", store "kv") with its value; only once the app has opened it. */
export const stored = (page) =>
  page.evaluate(
    () =>
      new Promise((done, fail) => {
        const r = indexedDB.open("fission");
        r.onsuccess = () => {
          const tx = r.result.transaction("kv", "readonly");
          const kv = tx.objectStore("kv");
          const out = {};
          const keys = kv.getAllKeys();
          keys.onsuccess = () => {
            for (const k of keys.result) kv.get(k).onsuccess = (e) => (out[k] = e.target.result);
          };
          tx.oncomplete = () => (r.result.close(), done(out));
          tx.onerror = () => fail(tx.error);
        };
        r.onerror = () => fail(r.error);
      }),
  );
/** The stored projects as {id, name, modified (the summary's save time), sizes (the first feature's parameters)}. */
export async function storedProjects(page) {
  const all = await stored(page);
  return Object.keys(all).filter((k) => k.startsWith("project/")).map((k) => {
    const p = JSON.parse(all[k]);
    const id = k.slice(8);
    return { id, name: p.name, modified: all[`summary/${id}`] ? JSON.parse(all[`summary/${id}`]).modified : null, sizes: JSON.stringify(p.workspaces?.design?.timeline?.features?.[0]?.intent?.parameters ?? {}) };
  });
}
export const savedMark = (page) => page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved", null, { timeout: 15000 });
export const volumeIs = (page, want) => page.waitForFunction((w) => document.querySelector("#volume")?.textContent === w, want, { timeout: 15000 });
