// Offline mode: registers the service worker (offline-sw.js, written into the
// built app by offline.mjs), which keeps the app and its kernel so it opens
// with no connection: for everyone once offline mode is released
// (offline.config.mjs), and before then in a browser that chose it with
// `?offline` (offline-switch.ts), which also gets the manifest link here, so
// it can be installed as an app. A new version installs in the background and waits; this
// shows "A new version of SpindleLabs is ready" with Reload, which tells the
// waiting worker to take over and reloads once it has, so the page and
// the kernel always come from one build. A tab still on the old version
// when another tab updates says so too. Only in the built app (the dev
// server has no worker), and never in a frame: main.ts imports this after
// frame-guard.ts, which stops a framed page first.
import { hideNotice, showNotice as show } from "./app-notice.ts";
import { pageOfflineChosen } from "./offline-switch.ts";
import "./styles/offline-status.css";

/** Offline mode's switch, from offline.config.mjs (set in vite.config.ts). Off: nothing is kept for offline use unless this browser chose it with `?offline`, and an earlier install is removed. */
declare const __OFFLINE_MODE__: boolean;

/** Set once this browser has been told the app is kept for offline use, so it is said once. */
export const TOLD_KEY = "spindlelabs.offline.told";

/** What a page under offline mode says about itself (shown only when no other notice is up: an update or a lost kernel matters more). */
export const OFFLINE_WORDS = {
  kept: "SpindleLabs is now kept on this device, so it opens without internet. To add it as an app, choose Install in the browser's address bar or menu.",
  offline: "You're offline. SpindleLabs still works, and your designs save on this device. Signing in and your account's copies wait until you're back online.",
  blocked: "This browser won't keep SpindleLabs for offline use (its settings block it), so it still needs the internet to open.",
} as const;

const PREFIX = "spindlelabs-"; // the caches sw.js makes

type Shown = "ready" | "elsewhere";

const WORDS: Record<Shown, string> = {
  ready: "A new version of SpindleLabs is ready.",
  elsewhere: "SpindleLabs was updated in another tab. Reload to use the new version here too.",
};

/** The worker could not keep a new version for lack of storage (it says so once, then waits a day before trying again). */
function showNoRoom() {
  show("no-room", "There isn't enough storage on this device to keep the new version of SpindleLabs for offline use, so this version stays. Freeing some space lets it update.", {
    label: "OK",
    title: "Hide this notice",
    press: () => hideNotice("no-room"),
  });
}

/**
 * The first visit: files the page loaded before the worker controlled it
 * (an on-demand chunk such as the in-browser AI's runner) are named to the
 * active worker, which keeps the ones it should (sw.js keepOnDemand); later
 * ones too, while the page stays uncontrolled.
 */
function nameLoadedFiles(reg: ServiceWorkerRegistration) {
  const sw = navigator.serviceWorker;
  const base = new URL(reg.scope);
  const send = (entries: PerformanceEntry[]) => {
    if (sw.controller || !reg.active) return;
    const paths = entries.map((e) => new URL(e.name, location.href)).filter((u) => u.origin === base.origin && u.pathname.startsWith(base.pathname + "assets/")).map((u) => u.pathname.slice(base.pathname.length));
    if (paths.length) reg.active.postMessage({ type: "keep", paths });
  };
  send(performance.getEntriesByType("resource"));
  if (typeof PerformanceObserver === "undefined") return;
  const watch = new PerformanceObserver((list) => (sw.controller ? watch.disconnect() : send(list.getEntries())));
  watch.observe({ type: "resource" });
}

/** Shows `kind` with an OK that hides it, unless another notice is up. */
function sayOnce(kind: keyof typeof OFFLINE_WORDS) {
  if (document.getElementById("app-update")) return;
  show(kind, OFFLINE_WORDS[kind], { label: "OK", title: "Hide this notice", press: () => hideNotice(kind) });
}

/** The first time this browser has the app kept (a person who just chose `?offline`), says so once. */
function tellKept() {
  try {
    if (localStorage.getItem(TOLD_KEY)) return;
    localStorage.setItem(TOLD_KEY, "1");
  } catch {
    return; // no storage: never risk saying it on every visit
  }
  sayOnce("kept");
}

/**
 * While the device has no connection, a small "Offline" mark beside the save status (gone once back online); pressed,
 * it says what still works. Never a notice over the view on its own: on a phone that covers the buttons people tap.
 */
function followConnection() {
  const now = () => {
    const mark = document.getElementById("offline-status");
    if (navigator.onLine) {
      mark?.remove();
      hideNotice("offline");
      return;
    }
    if (mark) return;
    const button = Object.assign(document.createElement("button"), { type: "button", id: "offline-status", className: "offline-status", textContent: "Offline" });
    button.title = OFFLINE_WORDS.offline;
    button.setAttribute("aria-label", OFFLINE_WORDS.offline);
    button.addEventListener("click", () => sayOnce("offline")); // never over an update's or a lost kernel's notice
    const status = document.getElementById("save-status");
    if (status) status.after(button);
    else document.body.append(button);
  };
  now();
  addEventListener("online", now);
  addEventListener("offline", now);
}

/** The manifest link the build leaves out while offline mode is off for everyone: added for a browser that chose offline, so it can be installed. */
function linkManifest() {
  if (document.querySelector('link[rel="manifest"]')) return;
  document.head.append(Object.assign(document.createElement("link"), { rel: "manifest", href: "./manifest.webmanifest" }));
}

/** Shows the update notice (one at a time) with its Reload button. */
function showNotice(kind: Shown, reload: () => void) {
  show(kind, WORDS[kind], { label: "Reload", title: "Reload to use the new version; your design is kept", press: reload });
}

/**
 * Offline mode is off: remove what an earlier build left in this browser,
 * the service worker and its caches, so the live site is what opens. A page
 * that came from that worker is reloaded once (sessionStorage stops a loop)
 * to get the live copy. (A browser that still has the old worker is also
 * handed the clean-up worker as sw.js, offline.mjs, which does the same.)
 */
async function removeOffline() {
  const sw = navigator.serviceWorker;
  const wasControlled = sw.controller !== null;
  try {
    for (const reg of await sw.getRegistrations()) await reg.unregister();
    for (const key of await caches.keys()) if (key.startsWith(PREFIX)) await caches.delete(key);
  } catch {
    return; // blocked or private mode: nothing was kept
  }
  try {
    if (wasControlled && !sessionStorage.getItem("spindlelabs.offline-removed")) {
      sessionStorage.setItem("spindlelabs.offline-removed", "1");
      location.reload();
    }
  } catch {
    // no sessionStorage: leave the page as it is rather than risk a reload loop
  }
}

export function startOffline() {
  if (!import.meta.env.PROD) return;
  const chosen = !__OFFLINE_MODE__ && pageOfflineChosen();
  if (!("serviceWorker" in navigator)) {
    if (chosen) sayOnce("blocked");
    return;
  }
  if (!__OFFLINE_MODE__ && !chosen) {
    void removeOffline();
    return;
  }
  if (chosen) linkManifest();
  const sw = navigator.serviceWorker;
  let updating = false; // this tab pressed Reload
  const hadController = sw.controller !== null;
  sw.addEventListener("controllerchange", () => {
    if (updating) location.reload();
    // The first install takes no page over, so a change here means a new
    // version took over from another tab (or every other tab closed).
    else if (hadController) showNotice("elsewhere", () => location.reload());
  });
  const offer = (waiting: ServiceWorker) =>
    showNotice("ready", () => {
      updating = true;
      waiting.postMessage({ type: "skip-waiting" });
    });
  sw.addEventListener("message", (event) => {
    if (event.data?.type === "no-room") showNoRoom();
  });
  sw.startMessages();
  sw.register("./offline-sw.js", { scope: "./" })
    .then((reg) => {
      if (!sw.controller)
        void sw.ready.then((ready) => {
          nameLoadedFiles(ready);
          if (chosen) tellKept();
        });
      followConnection();
      // A version already waiting (found on an earlier visit), one still
      // installing (the browser may have started looking before this ran),
      // or one found by the look below or later.
      const follow = (next: ServiceWorker | null) =>
        next?.addEventListener("statechange", () => {
          if (next.state === "installed" && sw.controller) offer(next);
        });
      if (reg.waiting && sw.controller) offer(reg.waiting);
      else follow(reg.installing);
      reg.addEventListener("updatefound", () => follow(reg.installing));
      // Look for a new worker on every page load (one small request; browsers
      // don't always look on a reload), and again on coming back online.
      const look = () => void reg.update().catch(() => {}); // offline: nothing to find
      look();
      addEventListener("online", look);
    })
    .catch(() => {
      // no service workers here (blocked, private mode): the app works as before, online only
      if (chosen) sayOnce("blocked");
    });
}
