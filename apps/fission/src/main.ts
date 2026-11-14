// The app shell: one project, one kernel, one viewport, and a switcher
// between workspaces. Each workspace fills the layout slots around the
// shared viewport (toolbar above, browser floating over its top left,
// properties right, a workspace's timeline in a thin row along the bottom); the
// viewport is shared, so switching keeps the camera and what is on screen.
// Workspaces stay warm (X7): each gets slots of its own the first time it is
// shown in a pane, and switching swaps whole slots in and out and puts the
// workspace to sleep or wakes it, so a switch rebuilds nothing. Split view (X3) shows a second workspace
// beside the first, in slots of its own, with its own camera on the same
// scene and the same project and selection. Change notes (X5) show over
// each pane's viewport, for the workspace in that pane.
/// <reference types="vite/client" />
// First, before any module that starts work: a framed page stops here (audit S10).
import { pageShareSwitch } from "./share-switch.ts";
import "./frame-guard.ts";
import "@fission/ui/theme.css";
// Every feature's own styles (src/styles/<feature>.css in packages/ui and the
// workspaces), loaded without a list, so two features never edit one file.
import.meta.glob(["../../../packages/ui/src/styles/*.css", "../../../packages/print/src/styles/*.css", "../../../workspaces/*/src/styles/*.css"], { eager: true });
import { type FileFormat, ActionRegistry, CLIPBOARD_CHORDS, chordLabel, chordOf, parseChord, SHELL_SHORTCUTS, ShortcutTable, type Chord, ChangeNotes, DependencyGraph, DownstreamRegistry, emptyProject, FILE_FORMATS, formatInfo, headBytesFor, projectFromJson, routeFiles, unreadableMessage, type FileHead, projectToJson, RepresentationRegistry, createHistory, KernelClient, createSelection, type ChangeNote, type MountedWorkspace, type Project, type SavedHistory, type GeometryReference, type SharedViewport, type WorkspaceContext, type WorkspaceId, type WorkspacePlugin, workspaceName } from "@fission/core";
import { ProjectGone, shellTabs, type ShellTabs } from "./design-tabs.ts";
import { historyPanel, baseNameOf, startDesignDefaults, readGridSize, readGridSnap, bugReportDialog, bugReportEndpoint, changeNote, fileMenu, fileSections, shellCommands, type FileMenuParts, holdSkeleton, keepTypingVisible, PROJECT_KIND, repeatGuard, saveFile, type FileHandle, iconSvg, openElsewhere, shortcutList, parseWhatsNew, whatsNewList, whatsNewNote, defaultSplit, showPlaceholder, SPLIT_MIN_WIDTH_PX, splitChoices, WarmPool, fillSettings, SETTINGS_KEY, SettingsStore, startTheme, startUnits, readUnitChoice, startMouse, readMouseChoice, startTooltips, readThemeChoice, applyCustom, readCustom, withIcon, workspaceSwitcher, homeScreen, projectNameBox } from "@fission/ui";
import { paneViewports, Viewer, type ViewportView } from "@fission/viewport";
import { communityPage } from "@fission/community";
import { bringForward, forget, MAX_PROJECT_NAME, rename as renameKept, keepStorage, keptEntry, localStore, OPENING_KEY, recoverUnsaved, reopenGuard, startAutosave, STORAGE_ANSWER_MS, storedCopy, type Autosave, type AutosaveStatus, type OpeningChannel } from "@fission/storage";
import { listedProjects } from "./projects.ts";
import { startPrintLog } from "./print-log.ts";
import { versionList, versionTime, type VersionPlace } from "@fission/ui";
import { createAssistant } from "./assistant.ts";
import { startOffline } from "./offline.ts";
import { openLatest, watchKernel } from "./kernel-lost.ts";
import { startPhoneFloat } from "./phone-float.ts";
import { sheetDrag } from "./sheet-drag.ts";
import { liftOverSheets } from "./undo-lift.ts";
import { appLoaded } from "./loading.ts";
import { ALL_WORKSPACES_SWITCH, listedWorkspaces } from "./listed-workspaces.ts";
import { designWorkspace } from "@fission/design";
import { renderWorkspace } from "@fission/render";
import { simulateWorkspace } from "@fission/simulate";
import { manufactureWorkspace } from "@fission/manufacture";
import { laserWorkspace } from "@fission/laser";
import { sliceWorkspace, slicePageWorkspace } from "@fission/slice";
/** The Slice page (slice-page.config.mjs): off in the shipped build until it does everything Slice for printing does. */
declare const __SLICE_PAGE__: boolean;
import { circuitWorkspace } from "@fission/circuit";
import { vectorWorkspace } from "@fission/vector";
import { imageWorkspace } from "@fission/image";
import { layoutWorkspace } from "@fission/layout";
import { keptSteps } from "./kept-steps.ts";

const workspaces: WorkspacePlugin[] = [
  designWorkspace,
  renderWorkspace,
  simulateWorkspace,
  manufactureWorkspace,
  laserWorkspace,
  __SLICE_PAGE__ ? slicePageWorkspace : sliceWorkspace,
  circuitWorkspace,
  vectorWorkspace,
  imageWorkspace,
  layoutWorkspace,
];

// Whether the ?test-hooks debug surface is built in (vite.config.ts): true in dev and the
// test build, false in the live Pages build, where the whole surface below is dropped (audit S12).
declare const __TEST_HOOKS__: boolean;
// The browser test of a kernel lost mid-call (e2e/kernel-lost.mjs) shortens its deadline with ?test-hooks&kernel-deadline=<ms>.
const hooks = new URLSearchParams(location.search);
const kernel = new KernelClient({ floorMs: (__TEST_HOOKS__ && hooks.has("test-hooks") && Number(hooks.get("kernel-deadline"))) || undefined });
// The kernel's files missing (a deploy since this page loaded, or the network): say which, and recover (kernel-lost.ts).
watchKernel(kernel);
// Opened on a build a deploy has replaced (kept by the browser): open the new one before the user starts (kernel-lost.ts).
if (import.meta.env.PROD) openLatest();
// The one conversion layer: every workspace says what it can hand over.
const representations = new RepresentationRegistry();
for (const w of workspaces) w.registerRepresentations?.(representations, kernel);
// The shell opens whole projects, dropped or pasted like any other file (X6).
representations.registerImporter({
  formats: ["project"],
  workspace: null,
  open: async (name, bytes) => {
    // A browser that can't keep projects holds the design on screen nowhere else: Open asks before it replaces one
    // with changes (it was gone without a question, export hunt 2026-11-12, #644 item 2). A file that can't be read
    // is refused first, in its own words, so no one is asked about an Open that won't happen.
    await okLanded();
    if (!canKeep && ctx.history.canUndo()) {
      projectFromJson(bytes, workspaces);
      if (!window.confirm(`Open "${name}" in place of your design? This browser can't keep projects, so the design on screen is saved nowhere: Cancel, then use Save to keep it as a file first.`)) return;
    }
    openProject(bytes, name);
  },
});
// The one action registry: the verbs each workspace offers for a selection.
const actions = new ActionRegistry();
for (const w of workspaces) w.registerActions?.(actions);
// The one downstream registry: what each workspace makes from the design (Design shows them as chips).
const downstream = new DownstreamRegistry();
for (const w of workspaces) w.registerDownstream?.(downstream);
// The workspaces DESIGN ▾ lists (listed-workspaces.ts); the rest stay built in, opened by their links.
const everyWorkspace = new URLSearchParams(location.search).has(ALL_WORKSPACES_SWITCH);
const listed = listedWorkspaces(workspaces, everyWorkspace);
const workspaceTitle = (id: WorkspaceId) => workspaces.find((w) => w.id === id)?.title ?? id;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// Optional accounts (accounts.config.mjs): with the switch off, the build has no account code and contacts no service.
declare const __ACCOUNTS__: { url: string; anonKey: string } | null;
/** The home screen (home.config.mjs): the app opens on it over the last project; off in the shipped build until released. */
declare const __HOME_SCREEN__: boolean;
/** The design tabs (tabs.config.mjs; also on with the home screen, which is built with them): off until released. */
declare const __DESIGN_TABS__: boolean;
/** The account code's hooks once it has started (only with accounts on): My designs. */
let accountHooks: import("./account.ts").AccountHooks | null = null;
/**
 * A small picture of the largest 3D view on screen for My designs (192 × 128, WebP, else PNG or JPEG under 32 KiB),
 * or null when there is none. The views keep their last frame (preserveDrawingBuffer), so this reads what is shown.
 */
function pictureOfView(): string | null {
  try {
    const shown = [...document.querySelectorAll<HTMLCanvasElement>("canvas")].filter((c) => !c.closest("dialog") && c.width > 0 && c.height > 0 && c.getBoundingClientRect().width > 0);
    const view = shown.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!view) return null;
    const w = 192, h = 128;
    const out = document.createElement("canvas");
    Object.assign(out, { width: w, height: h });
    const g = out.getContext("2d");
    if (!g) return null;
    // Cover: the middle of the view, cut to 3:2.
    const scale = Math.max(w / view.width, h / view.height);
    const sw = w / scale, sh = h / scale;
    g.drawImage(view, (view.width - sw) / 2, (view.height - sh) / 2, sw, sh, 0, 0, w, h);
    for (const [type, q] of [["image/webp", 0.75], ["image/jpeg", 0.7], ["image/png", undefined]] as const) {
      const url = out.toDataURL(type, q);
      if (url.startsWith(`data:${type};base64,`) && url.length <= 32 * 1024) return url;
    }
    return null;
  } catch {
    return null; // a view that can't be read (a lost WebGL context, a tainted canvas): no picture this time
  }
}
// The one viewer (one scene); each workspace on screen sees it through a
// pane of its own: its own camera, the viewer's body, selection and picks.
const viewer = new Viewer($("viewport"));
const pane = paneViewports(viewer);
/** Redraws the Undo and Redo buttons (set once they exist, below): a tool's panel opened or closed (issue #520). */
let refreshUndoRedo = () => {};
const ctx: WorkspaceContext = {
  project: emptyProject(),
  projectChanged: (label, mergeKey) => projectChanged(label, mergeKey),
  kernel,
  selection: createSelection(),
  history: null!, // created just below: it captures the project as it starts
  graph: new DependencyGraph(),
  // The page's first slots; each workspace gets slots of its own (paneCtx, X7).
  toolbar: $("toolbar"),
  browser: $("browser"),
  properties: $("properties"),
  timeline: $("timeline"),
  viewport: pane(viewer.main),
  representations,
  actions,
  downstream,
  changeNotes: new ChangeNotes(),
  openWorkspace: (id) => openFrom("main", id),
  workspaceTitle,
  openFile: () => $("open-file").click(),
  // A new design in place of the saved or opened one: its file and name go, so Save asks where (app hunt 2026-11-04).
  // Undo puts the file back with the design (issue #520): the design as it was is kept with its file, the cleared one with none.
  startedFresh: () => {
    fileOf(projectToJson(ctx.project), { handle: savedTo, name: projectFile });
    savedTo = null;
    projectFile = null;
    freshPending = true; // the cleared design, once recorded (projectChanged), has no file
    fileOwner++;
  },
  toolChanged: () => refreshUndoRedo(),
  fileName: () => (projectFile === null ? null : baseNameOf(projectFile, PROJECT_KIND.extension)),
};

// The one undo history (step 20): whole-project snapshots, put back the way
// a file is opened, then every workspace on screen is mounted afresh on it.
ctx.history = createHistory({ capture: () => projectToJson(ctx.project), restore: restoreSnapshot });
/** Mounts in progress: a change a workspace makes while being mounted is a default filled in, not an undo step. */
let mounting = 0;
/**
 * The id of a new project started in place of the last one (skipped, or
 * Start fresh instead): kept from its first change on, not from the
 * defaults its workspaces fill in, so until then a reload opens the last one.
 */
let keepOnChange: string | null = null;
/** New let the file go (startedFresh): the next change recorded is the cleared design, kept with no file (`fileOf`). */
let freshPending = false;
function projectChanged(label = "Edit", mergeKey?: string) {
  if (keepOnChange !== null && mounting === 0) keep(keepOnChange);
  autosave?.changed();
  if (mounting === 0) ctx.history.record(label, mergeKey);
  if (freshPending && mounting === 0) {
    freshPending = false;
    fileOf(projectToJson(ctx.project), { handle: null, name: null });
  }
  tabs?.sync();
}
/** Runs a show or mount; once the last one ends, takes whatever defaults the workspaces filled in into the present undo step. */
function mountingDone<T>(run: () => T): T {
  mounting++;
  try {
    return run();
  } finally {
    if (--mounting === 0) ctx.history.amend(); // ignored while an undo is putting a snapshot back
  }
}
/** Puts an undo snapshot back: read like an opened file, so a snapshot that doesn't read cleanly leaves everything as it was. */
function restoreSnapshot(text: string) {
  const project = projectFromJson(text, workspaces);
  ctx.project = project;
  const file = filesOf.get(text);
  if (file) {
    savedTo = file.handle;
    projectFile = file.name;
  }
  pool.forgetAll(); // every warm workspace showed the project as it was
  show(current);
  if (split) mountSplit(split.id);
  autosave?.changed();
}

// The View group (SF3a): each view builds its own navigation bar
// (packages/viewport nav-bar.ts); the main one gets the id the e2e tests
// and the phone layout use.
$("viewport").querySelector<HTMLElement>(".view-controls")!.id = "view-controls";

// What is selected, read by the e2e test (17d draws it on screen).
ctx.selection.onChange((items) => (document.body.dataset.selection = items.map((r) => r.id).join(" ")));

// Change notes (X5): a strip over each pane's viewport shows the notes about
// the workspace in that pane (docs/integration.md, principle 9), redrawn
// after every change to the graph or the notes; × dismisses one. Notes
// about a workspace not on screen wait until it is shown.
function notesStrip(host: HTMLElement): HTMLElement {
  const strip = Object.assign(document.createElement("div"), { className: "notes-strip" });
  strip.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-dismiss]")?.dataset.dismiss;
    if (id) ctx.changeNotes.dismiss(id);
  });
  host.append(strip);
  return strip;
}
const notesStrips = { main: notesStrip($("viewport")), split: notesStrip($("split-viewport")) };
const drawn = new WeakMap<HTMLElement, string>();
/** Draws `notes` in `strip`, keeping open any "Why?" the user opened; nothing changes when nothing would. */
function drawNotes(strip: HTMLElement, notes: ChangeNote[]) {
  const html = notes.map(changeNote).join("");
  if (drawn.get(strip) === html) return;
  const open = [...strip.querySelectorAll("details[open]")].map((d) => d.closest<HTMLElement>("[data-note]")!.dataset.note!);
  strip.innerHTML = html;
  drawn.set(strip, html);
  for (const id of open) strip.querySelector(`[data-note="${CSS.escape(id)}"] details`)?.setAttribute("open", "");
}
let notesQueued = false;
/** Redraws both strips once the current change is finished (a Design edit changes the graph several times, then records). */
function showNotes() {
  if (notesQueued) return;
  notesQueued = true;
  queueMicrotask(() => {
    notesQueued = false;
    const notes = ctx.changeNotes.current(ctx.graph);
    drawNotes(notesStrips.main, notes.filter((n) => n.workspace === current));
    drawNotes(notesStrips.split, notes.filter((n) => n.workspace === split?.id));
  });
}
let stopWatching = () => {};
/** The graph and notes of the project now open; the strips follow both. */
function useGraph(graph: DependencyGraph, notes: ChangeNotes) {
  stopWatching();
  ctx.graph = graph;
  ctx.changeNotes = notes;
  const stops = [graph.onChange(showNotes), notes.onChange(showNotes)];
  stopWatching = () => stops.forEach((stop) => stop());
  showNotes();
}
useGraph(ctx.graph, ctx.changeNotes);
// For the browser test only (?test-hooks): the graph and notes, so it can
// stand in a result in another workspace before any workspace makes one;
// the main view's camera, to check navigation (SF3a); split view's second
// view, to check its camera and to break its "no 3D view" on purpose; how
// many bodies the kernel holds (the monkey tester's leak check); the
// kernel's WebAssembly memory and the viewport's counts (the soak test's);
// any kernel call, to run the kernel out of memory (e2e/kernel-restart.mjs).
// __TEST_HOOKS__ is false in the live build, so this whole block is dropped there (audit S12).
if (__TEST_HOOKS__ && new URLSearchParams(location.search).has("test-hooks"))
  Object.assign(window, {
    fissionTest: {
      get graph() {
        return ctx.graph;
      },
      get notes() {
        return ctx.changeNotes;
      },
      camera: () => viewer.main.cameraPose(),
      splitView: () => split?.view ?? null,
      bodyCount: () => kernel.call("body_count"),
      wasmBytes: () => kernel.call("wasm_bytes"),
      kernelCall: (op: Parameters<typeof kernel.call>[0], ...args: unknown[]) => (kernel.call as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...args),
      gpu: () => viewer.memoryCounts(),
      // Whether the undo history holds work still to be recorded (a delete the kernel still plans, an OK it still checks):
      // the page shows the step before until it lands, so the monkey waits on it before reading the bar (issue #650).
      historyBusy: () => ctx.history.working(), // held work running by itself, not a question waiting on the person (SL #397)
    },
  });

type Page = WorkspaceId | "community";
let current: Page = "design";
/** The workspace shown last, where Community goes back to when pressed again. */
let lastWorkspace: WorkspaceId = "design";

// Warm workspaces (X7). Each pane has four slots, found by id
// (#toolbar or #split-toolbar…; the timeline row along the bottom from
// SF3d); a workspace mounted in a pane gets four elements of its own that take the slots' place in the page while it is
// shown (same id, role and label, so the layout and :empty rules apply
// unchanged). Asleep, its elements are out of the page, kept as they are.
type PaneId = "main" | "split";
type Slots = Required<Pick<WorkspaceContext, "toolbar" | "browser" | "properties" | "timeline">>;
const SLOT_KEYS = ["toolbar", "browser", "properties", "timeline"] as const;
const SLOT_IDS: Record<PaneId, Record<keyof Slots, string>> = {
  main: { toolbar: "toolbar", browser: "browser", properties: "properties", timeline: "timeline" },
  split: { toolbar: "split-toolbar", browser: "split-browser", properties: "split-properties", timeline: "split-timeline" },
};
/** Puts `slots` in the page in place of whatever fills `pane`'s slots now. */
function placeSlots(pane: PaneId, slots: Slots) {
  for (const key of SLOT_KEYS) {
    const now = $(SLOT_IDS[pane][key]);
    if (now !== slots[key]) now.replaceWith(slots[key]);
  }
}
/**
 * Each pane's slots as the page first had them (an element's attributes, no
 * children). New slots copy these, never the slots on screen: a mark a
 * workspace put on its own slot (Design's folded properties, U0b) must not
 * reach the next one's (found by image.mjs: Image's panel opened folded).
 */
const PRISTINE: Record<PaneId, Slots> = {
  main: Object.fromEntries(SLOT_KEYS.map((key) => [key, $(SLOT_IDS.main[key]).cloneNode(false)])) as Slots,
  split: Object.fromEntries(SLOT_KEYS.map((key) => [key, $(SLOT_IDS.split[key]).cloneNode(false)])) as Slots,
};
/** Four empty slots shaped like `pane`'s as the page first had them. */
const emptySlots = (pane: PaneId): Slots => Object.fromEntries(SLOT_KEYS.map((key) => [key, PRISTINE[pane][key].cloneNode(false) as HTMLElement])) as Slots;
const pool = new WarmPool<WorkspaceId, PaneId, { slots: Slots; view: MountedWorkspace }>({
  mount(pane, id) {
    const slots = emptySlots(pane);
    placeSlots(pane, slots);
    const view = workspaces.find((w) => w.id === id)!.mount(paneCtx(pane, slots));
    return { slots, view };
  },
  sleep(pane, _id, { view }) {
    view.sleep?.();
    placeSlots(pane, emptySlots(pane));
  },
  wake(pane, _id, { slots, view }) {
    placeSlots(pane, slots);
    view.wake?.();
  },
  unmount: (_pane, _id, { view }) => view.unmount(), // asleep: its slots are already out of the page
});
// DESIGN ▾ (U0f2b): one button naming the page on screen, its menu the
// workspaces listed (listed-workspaces.ts: Design and Slice in the public
// app, all ten with ?all-workspaces), in place of the tabs. An unlisted
// workspace opened by its link is still named on the button. Slice opens
// Slice for printing on the design (its own screen is not built yet).
const SLICE_SUMMARY = "Slice for printing: slice the design and save the printer's file";
const markTab = workspaceSwitcher(
  $("workspaces"),
  listed.map((w) => (w.id === "slice" ? { id: w.id, title: w.title, summary: SLICE_SUMMARY, placeholder: false } : { id: w.id, title: w.title, summary: w.summary, placeholder: w.status === "placeholder" })),
  (id) => (id === "slice" && !__SLICE_PAGE__ ? sliceForPrinting() : show(id as WorkspaceId)),
  { community: "Community", ...Object.fromEntries(workspaces.map((w) => [w.id, w.title])) },
);
/** DESIGN ▾'s Slice: Design on screen, then its File ▾ > Slice for printing, or the reason there is nothing to slice. */
function sliceForPrinting() {
  if (current !== "design") show("design");
  const entry = pool.awake("main")?.view.fileEntries?.()?.exports?.find((e) => e.id === "file-slice-print");
  if (!entry) return;
  if (entry.off) return fileStatus(entry.off);
  entry.run();
}

// The assistant (AI2): changes Design's part through Design's own run, as one undo step.
const assistant = createAssistant(
  $("assistant"),
  {
    history: ctx.history,
    project: () => ctx.project,
    design() {
      const where = pool.paneOf("design");
      return where && pool.showing(where) === "design" ? (pool.awake(where)?.view ?? null) : null;
    },
  },
  $("ai-status"),
);

function show(page: Page) {
  mountingDone(() => showPage(page));
}
function showPage(page: Page) {
  // Choosing the workspace that is in the second pane swaps the two panes.
  const swap = split?.id === page ? current : null;
  const workspace = workspaces.find((w) => w.id === page);
  if (workspace) pool.show("main", workspace.id);
  else {
    pool.hide("main"); // empty slots in its place
    showPlaceholder($("properties"), communityPage);
  }
  markTab(page);
  $("community").setAttribute("aria-pressed", String(page === "community"));
  document.body.dataset.activeWorkspace = page; // read by the e2e test
  current = page;
  tabs?.sync();
  if (workspace) lastWorkspace = workspace.id;
  if (swap) {
    if (swap === "community") closeSplit();
    else mountSplit(swap);
  }
  if (split) fillSplitChoice();
  showNotes();
  assistant.show(page, workspace?.title ?? "Community");
  if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
}

// Community pressed again closes it, back to the workspace it was opened from (like AI and Guide).
$("community").addEventListener("click", () => show(current === "community" ? lastWorkspace : "community"));

// Split view (X3): Split (over the viewport, wide screens only) puts a
// second workspace beside the first; the choice in its pane changes which;
// Close split, or a window too narrow for two, goes back to one. The
// second workspace gets slots of its own and a pane over a second view;
// the project, selection, history and registries are the first one's.
let split: { id: WorkspaceId; view: ViewportView; viewport: SharedViewport; settled: boolean; framed: boolean } | null = null;
const splitEntries = listed.map((w) => ({ id: w.id, title: w.title, placeholder: w.status === "placeholder" }));
const shownWorkspace = () => (current === "community" ? null : current);
/** What a workspace in `pane` sees: its own slots and that pane's viewport; the project, selection, history and registries are the one set. */
function paneCtx(pane: PaneId, slots: Slots): WorkspaceContext {
  return {
    get project() {
      return ctx.project;
    },
    set project(p) {
      ctx.project = p;
    },
    get graph() {
      return ctx.graph;
    },
    set graph(g) {
      ctx.graph = g;
    },
    get changeNotes() {
      return ctx.changeNotes;
    },
    set changeNotes(n) {
      ctx.changeNotes = n;
    },
    projectChanged: (label, mergeKey) => ctx.projectChanged(label, mergeKey),
    kernel: ctx.kernel,
    selection: ctx.selection,
    history: ctx.history,
    ...slots,
    viewport: pane === "main" ? ctx.viewport : split!.viewport,
    representations: ctx.representations,
    actions: ctx.actions,
    downstream: ctx.downstream,
    openWorkspace: (id) => openFrom(pane, id),
    workspaceTitle,
    openFile: ctx.openFile,
    startedFresh: ctx.startedFresh,
    toolChanged: ctx.toolChanged,
    fileName: ctx.fileName,
  };
}
/**
 * A workspace asked to open `id` (a downstream chip's click): with a split
 * open it goes in the other pane, beside the one that asked; otherwise it
 * replaces what is shown. Already on screen: nothing changes.
 */
function openFrom(asker: PaneId, id: WorkspaceId) {
  if (id === current || id === split?.id) return;
  if (split && asker === "main") mountSplit(id);
  else show(id);
}
function fillSplitChoice() {
  const select = $<HTMLSelectElement>("split-choice");
  select.replaceChildren(...splitChoices(splitEntries, shownWorkspace()).map((e) => new Option(e.title, e.id, false, e.id === split?.id)));
}
/** Shows workspace `id` in the second pane, opening the split if it is closed (the camera of an open one stays). */
function mountSplit(id: WorkspaceId) {
  mountingDone(() => mountSplitPane(id));
}
function mountSplitPane(id: WorkspaceId) {
  const workspace = workspaces.find((w) => w.id === id);
  if (!workspace) return;
  if (!split) {
    $("split").hidden = false;
    $("workspace").dataset.split = "on";
    $("workspace").classList.add("split-view"); // styles/split-view.css
    const view = viewer.addView($("split-viewport"));
    const viewport = pane(view);
    // The new view framed the body at home before the grid had settled its
    // size; frame it again once it has (the view's own resize runs first,
    // as its observer was registered first), or, while the pane shows no 3D
    // view (Image's 2D view, a placeholder), when a 3D workspace comes in.
    const settled = new ResizeObserver(([entry]) => {
      if (split?.view !== view) return settled.disconnect(); // closed before it settled: let the view go
      if (!entry || entry.contentRect.width === 0) return;
      settled.disconnect();
      split.settled = true;
      frameSplit();
    });
    settled.observe($("split-viewport"));
    split = { id, view, viewport, settled: false, framed: false };
  }
  split!.id = id;
  pool.show("split", id);
  showSoon(workspace);
  document.body.dataset.split = id; // read by the e2e test
  $("split-toggle").setAttribute("aria-pressed", "true");
  fillSplitChoice();
  showNotes();
}
/**
 * A workspace not built yet gets no 3D view in the second pane: the view
 * stops drawing (its camera kept for the next workspace there) and the
 * pane shows its name and "Coming soon" with what its page says it will
 * do; a working workspace gets the view back.
 */
function showSoon(workspace: WorkspacePlugin) {
  const soon = $("split-viewport").querySelector<HTMLElement>(".split-soon")!;
  const placeholder = workspace.status === "placeholder";
  split!.view.setDrawing(!placeholder);
  $("workspace").dataset.splitPane = placeholder ? "placeholder" : "workspace";
  soon.hidden = !placeholder;
  if (!placeholder) {
    frameSplit();
    return soon.replaceChildren();
  }
  const page = $("split-properties").querySelector(".placeholder");
  if (page) soon.replaceChildren(page.cloneNode(true));
  else soon.innerHTML = `<div class="placeholder"><h2></h2><p class="coming-soon">Coming soon</p></div>`;
  if (!page) soon.querySelector("h2")!.textContent = workspace.title;
}
/** Frames the second view at home once, the first time it shows in 3D at its settled size. */
function frameSplit() {
  if (!split || split.framed || !split.settled) return;
  const { dataset } = split.view.element;
  if (dataset.image !== undefined || dataset.drawing === "off") return;
  split.view.fit();
  split.framed = true;
}
function closeSplit() {
  if (!split) return;
  activePane = "main";
  pool.forgetPane("split"); // its viewport goes
  viewer.removeView(split.view);
  split = null;
  $("split").hidden = true;
  $("workspace").dataset.split = "off";
  $("workspace").classList.remove("split-view");
  delete $("workspace").dataset.splitPane;
  const soon = $("split-viewport").querySelector<HTMLElement>(".split-soon")!;
  soon.hidden = true;
  soon.replaceChildren();
  document.body.dataset.split = "";
  $("split-toggle").setAttribute("aria-pressed", "false");
  showNotes();
}
// Split only with every workspace listed (?all-workspaces): the public app lists no second workspace to show beside Design.
if (everyWorkspace) {
  const toggle = Object.assign(document.createElement("button"), { id: "split-toggle", type: "button", textContent: "Split", title: "Show a second workspace beside this one" });
  toggle.setAttribute("aria-pressed", "false");
  toggle.addEventListener("click", () => {
    if (split) return closeSplit();
    const id = defaultSplit(splitEntries, shownWorkspace())?.id;
    if (id) mountSplit(id);
  });
  $("viewport").append(toggle);
  $("split-choice").addEventListener("change", () => mountSplit($<HTMLSelectElement>("split-choice").value as WorkspaceId));
  $("split-close").addEventListener("click", () => {
    closeSplit();
    toggle.focus();
  });
  $("workspace").dataset.split = "off";
  // A half-width toolbar scrolls sideways (styles/split-view.css): the
  // mouse wheel scrolls it too, as a wheel has no sideways turn.
  $("workspace").addEventListener(
    "wheel",
    (e) => {
      const bar = (e.target as Element).closest<HTMLElement>(".split-view #toolbar, .split-view #split-toolbar");
      if (!bar || e.deltaX !== 0 || e.deltaY === 0 || bar.scrollWidth <= bar.clientWidth) return;
      bar.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
  const wide = matchMedia(`(min-width: ${SPLIT_MIN_WIDTH_PX}px)`);
  wide.addEventListener("change", () => {
    if (!wide.matches) closeSplit();
  });
}

// At phone width AI, Guide and Community fold behind Menu (theme.css),
// leaving the top bar's row to File ▾ and the workspace button. Choosing one,
// Escape or a tap anywhere else closes it; Escape puts focus back on Menu.
{
  const toggle = $("menu-toggle");
  const setMenu = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    $("topbar").dataset.menu = open ? "open" : "closed";
  };
  setMenu(false);
  toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  $("topbar-actions").addEventListener("click", () => setMenu(false)); // after the chosen button's own handler
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || toggle.getAttribute("aria-expanded") !== "true") return;
    // Menu's Escape is its own, as every menu's is (menu-button.ts): the shortcut table below never also cancels the sketch's plane prompt.
    e.preventDefault();
    e.stopImmediatePropagation();
    setMenu(false);
    toggle.focus();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!(e.target instanceof Node) || toggle.contains(e.target) || $("topbar-actions").contains(e.target)) return;
    setMenu(false);
  });
}

// Autosave (19c): the project is kept in this browser and saved a moment
// after each change; the top bar says "Saving…", "Saved" or what went wrong.
// Each project has its own stored id: an opened file becomes a new stored
// project rather than overwriting the one that was open.
// The browser closing the database under the page (site data cleared): the open project is stored again at once
// (export hunt 2026-11-12, #643 item 4: the mark said "Saved" over an empty store, and a reload opened nothing).
const store = localStore(workspaces, () => autosave?.lost());
// The kept project's undo steps, kept beside it in this browser (step 89), so a reload carries on where it was.
// Written as each save lands, never by a tab whose saves are refused (another tab stored the project since).
const steps = keptSteps(ctx.history, store.steps, () => projectToJson(ctx.project), {
  refused: () => autosave?.refused() ?? false,
  upgrade: (snapshot) => projectToJson(projectFromJson(snapshot, workspaces)), // as the project itself is read when it opens
});
/** Projects whose last change came back from the unsaved-changes journal at this start: their kept steps end before it (#627 item 7). */
const leftWithChange = new Set<string>();
/** The browser's localStorage, or null when storage is turned off (then the guard and the journal keep nothing). */
const local = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
// Marks the project being opened, so one that froze or crashed the tab isn't
// reopened on the next visit (audit S2, reopen.ts in @fission/storage). The
// tabs ask each other over a channel, so a tab started while another is still
// opening the project doesn't take that for a freeze (real-use hunt A3).
const guard = reopenGuard(local, {
  channel: (() => {
    try {
      return new BroadcastChannel(OPENING_KEY) as OpeningChannel; // its MessageEvent carries the `data` the guard reads
    } catch {
      return null; // no channel: a mark found is taken for a freeze, as before
    }
  })(),
});
window.addEventListener("pagehide", () => guard.finished());
// A phone locked or the app switched: the OS may kill the tab later with no pagehide (real-use hunt D1).
document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? guard.putAway() : guard.back()));
document.addEventListener("freeze", () => guard.putAway());
document.addEventListener("resume", () => guard.back());
let autosave: Autosave | null = null;
// Leaving (timeline hunt, finding 1): when the page is hidden, reloaded or
// closed, the changes not stored yet go to the unsaved-changes journal at
// once (unsaved.ts), and are put back on the next visit; the store's save
// starts too. Only when the journal can't be written (storage off or full)
// does the page ask before going, and only while a change waits, so a saved
// page never asks and stays fit for the back/forward cache.
// With no autosave nothing is journalled, so the page asks instead (lost-work hunt 2026-11-12, issue #627 items 3 and
// 4; it answered "all kept" and went without a word): while an opened file is not kept yet, and after a change when
// this browser's storage failed at the start. A new project not changed yet has nothing to lose.
// (#627 item 1, a size still waiting its turn in Design, is flushed here by the Undo and edit thread's fix.)
// An OK still with the kernel (held work, `history.waitingToRecord`) has recorded nothing yet, so neither the journal nor
// the store can keep it: the page asks before going while one is held (flat stress hunt 2026-11-13, SL #708 item 1: a reload
// straight after a Combine's OK went without a word and opened without the Combine; the lost-work family of #627).
const leaving = () => {
  steps.flush();
  const kept = autosave ? autosave.leaving() : statusBeforeOpening === null && (canKeep || !ctx.history.canUndo());
  return kept && !ctx.history.waitingToRecord();
};
// Shown again, or its window chosen again: a tab left open while another tab changed the project is told at once, before
// anything is edited, saved to a file or exported from the older state (export hunt 2026-11-12, #642 item 3: it went
// on saying "Saved"). Known stale before its next edit, it also writes no undo steps over the other tab's (item 4).
const backInView = () => void autosave?.check();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") leaving();
  else backInView();
});
window.addEventListener("focus", backInView);
window.addEventListener("pagehide", leaving);
function askBeforeLeaving(e: BeforeUnloadEvent) {
  if (leaving()) return;
  e.preventDefault();
  e.returnValue = ""; // older browsers ask only when this is set
}
/** What the save mark says now: put back when an opened file is abandoned before it was kept (issue #247). */
let shownStatus: AutosaveStatus = { state: "saved" };
/** Marks that say "Saving…" only while an opened project is stored again as it is: no change of the person's is waiting (tabs hunt A5). */
const storingAgain = new WeakSet<AutosaveStatus>();
const saveStatus = (s: AutosaveStatus) => {
  shownStatus = s;
  const el = $("save-status");
  el.dataset.state = s.state; // read by the e2e test
  el.textContent = s.state === "saving" ? "Saving…" : s.state === "saved" ? "Saved" : `Not saved: ${s.message}`;
  el.title = el.textContent; // the words behind the mark at phone width
  if (s.state === "saved") accountHooks?.saved(); // My designs: kept in the account a few seconds later, when signed in
  askWhileUnsaved();
};
/** Listens for beforeunload only while something could be lost (a saved page with nothing held stays fit for the back/forward cache). */
function askWhileUnsaved() {
  if (shownStatus.state === "saved" && !ctx.history.waitingToRecord()) window.removeEventListener("beforeunload", askBeforeLeaving);
  else window.addEventListener("beforeunload", askBeforeLeaving);
}
ctx.history.onBusy(askWhileUnsaved);
/**
 * After the first save of the user's own work (an edit, or a file opened), asks the browser not to clear the kept
 * projects when space runs low (real-use hunt B3). Never on load: the empty project a first visit stores is no work.
 */
const askToKeepStorage = keepStorage(globalThis.navigator?.storage);
/** A file has been opened in this tab (its first save is the user's work, with nothing to undo). */
let openedFile = false;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
/** False once the browser has shown it can't keep projects: then nothing autosaves, and Save/Open use files. */
let canKeep = true;
/**
 * Keeps the open project in the store under `id` from now on; `stored` when it was just opened from there as it is,
 * stored at `storedAt`: a save after another tab stored it since is refused and says so (app sweep, finding 2).
 */
/**
 * Settles once the last replaced project's saves have landed (finish's last one too), or after STORAGE_ANSWER_MS
 * when the store doesn't answer: a project looked up in the store waits for it (nightly issue #331).
 */
let lastWrites: Promise<void> = Promise.resolve();
/** Finishes the open project's autosave (`Autosave.finish`), noting its last saves in `lastWrites`. */
function finishAutosave(): string | null {
  if (autosave === null) return null;
  const done = autosave;
  const apart = done.finish();
  lastWrites = Promise.race([done.settled(), new Promise<void>((settle) => setTimeout(settle, STORAGE_ANSWER_MS))]);
  return apart;
}
function keep(id: string, stored = false, storedAt: Date | null = null, fromKept = false) {
  keepOnChange = null;
  finishAutosave();
  if (!canKeep) return;
  // Following the undo history: an amend (a face sketch settled, a pinned point followed once the kernel answers) is a
  // change no one records, and it can come after the edit was stored (hunt 26h). One that changes nothing (the history
  // started afresh on a reopened project) is not.
  steps.follow(id, leftWithChange.delete(id)); // its kept steps put back once read, if they end at the project as it is (after the reset that follows)
  autosave = startAutosave(store, id, () => ctx.project, (s) => (s.state === "saved" && (steps.saved(), openedFile || ctx.history.canUndo()) && askToKeepStorage(), saveStatus(s)), { journal: local, follows: ctx.history, stored, storedAt, fromKept });
  document.body.dataset.projectId = id; // read by the e2e test
  tabs?.sync();
}
/** A new project in place of the last one, kept once it is changed (`keepOnChange`). */
function keepOnFirstChange() {
  steps.stop(); // a new project: nothing of it kept until its first change
  finishAutosave(); // the last project keeps a change made within the quiet moment
  autosave = null;
  keepOnChange = newId();
}

// Save and Open: the whole project, every workspace's data, as one
// .spindle file (docs/project-format.md). Opening replaces the project
// only once all of it has read cleanly; a refused file leaves the open
// project as it was and says why.
const fileStatus = (message: string) => ($("file-status").textContent = message);
$("file-dismiss").addEventListener("click", () => fileStatus(""));
/** The file the project was last saved to (the save picker's), so Save writes it again without asking; Save As and a new or opened project let it go. */
let savedTo: FileHandle | null = null;
/**
 * The name of the file the project was opened from or last saved to, which Save offers (real-use hunt B5: Save
 * offered "Untitled", the name inside the file, so a quick Save made a second file beside it), and print files take
 * when the project has no name of its own (slicer hunt 2026-11-04, package 4b: every print file was "spindlelabs-…");
 * a new or other project lets it go.
 */
let projectFile: string | null = null;
/**
 * The file each design an undo step can put back belonged to, where New let one go (issue #520: File > New, then Undo,
 * brought the design back but Save offered "Untitled"): keyed by the step's snapshot, the project's text, so an Undo
 * back to the design opened puts its file back and a Redo of New lets it go again. A few kept, the newest last.
 */
const filesOf = new Map<string, { handle: FileHandle | null; name: string | null }>();
function fileOf(text: string, file: { handle: FileHandle | null; name: string | null }) {
  filesOf.delete(text);
  filesOf.set(text, file);
  while (filesOf.size > 8) filesOf.delete(filesOf.keys().next().value!);
}
/** Goes up each time another project takes the open one's place (new, opened, restored): a save that was still asking then knows its file is not this project's. */
let fileOwner = 0;
/** A Save is asking where or under what name: Save and Save As pressed again meanwhile (Ctrl+S held or mashed, the menu, the key behind the name box) do nothing, so there is one question and one file (export hunt 2026-11-12, SL #644 item 4; the Save icon's repeat guard only covered the icon). */
let saveAsking = false;
async function save(asNew = false) {
  if (saveAsking) return;
  saveAsking = true;
  try {
    await started; // the project shown, not the empty one the app starts with
    const owner = fileOwner;
    const result = await saveFile(document, { suggestedName: projectFile || ctx.project.name || "Untitled", kind: PROJECT_KIND, bytes: projectToJson(ctx.project), handle: asNew ? null : savedTo });
    if (result.status === "failed") return fileStatus(result.message);
    // Another project opened while this save was asking: the file holds the last project, so it is not kept as
    // this one's, or the next Save would write this project over it without asking (SL #644 item 5).
    if (result.status === "saved" && owner === fileOwner) {
      // The steps that belonged to the file this project had now belong to the one just saved to: an Undo back to a
      // design saved before a Save As must not bring the old file back, or the next Save writes over the copy left
      // behind without asking and the new file misses the work (app-wide hunt 2026-11-14, R-3).
      if (savedTo !== null || projectFile !== null) for (const [text, file] of filesOf) if (file.handle === savedTo && file.name === projectFile) filesOf.set(text, { handle: result.handle, name: result.name });
      savedTo = result.handle;
      projectFile = result.name;
      fileOf(projectToJson(ctx.project), { handle: savedTo, name: projectFile }); // an Undo back to here finds this file
    }
    fileStatus("");
  } catch (e) {
    fileStatus(e instanceof Error ? e.message : String(e));
  } finally {
    saveAsking = false;
  }
}
// The phone's keyboard opening never hides the box being typed in (clumsy-human hunt 11-04, keep-typing-visible.ts).
keepTypingVisible(window);
const SAVE_TITLE = $("save").title;
withIcon($("save"), "save"); // its word kept as its name, out of sight (styles/app-bar.css)
// A double-click, a held Enter or a mashed Save is one save, not a file per press (clumsy-user hunt 11-04).
const saveRepeats = repeatGuard();
$("save").addEventListener("click", () => {
  if (!saveRepeats()) void save();
});
const SAVE_AS_TITLE = "Save As…: save the whole project under a name and in a place you choose";
// Open takes what a drop or paste takes (X6): every format with an importer,
// routed by its contents, so a PNG opens in Image and a project as a project.
// A format whose workspace the public app doesn't list (images: Image) is left out, and refused if dropped (listed-workspaces.ts).
const listedImporter = (format: FileFormat) => {
  const importer = representations.importerFor(format);
  return importer && (!importer.workspace || listed.some((w) => w.id === importer.workspace)) ? importer : null;
};
$<HTMLInputElement>("open-file").accept = FILE_FORMATS.filter((f) => listedImporter(f.format))
  .flatMap((f) => (f.format === "project" ? [".spindle", ".json"] : f.extensions))
  .join(",");
const OPEN_TITLE = `Open ${FILE_FORMATS.filter((f) => listedImporter(f.format)).map((f) => f.many).join(", ")}`;
// File ▾ (U0f2a), first on the bar as in Fusion: New and the exports are
// the workspace's in use (the pane last clicked, as for keys), Open and
// Save the shell's. Save also stays one click, as the icon beside it.
/** A shell key as the user reads it here (Ctrl+S, or ⌘S on a Mac), for the File menu. */
const fileKey = (keys: string) => chordLabel(parseChord(keys), /Mac|iPhone|iPad/.test(navigator.platform));
// File ▾ > Print log… (account features 5): kept in this browser; the account code may keep it in the account too.
const printLog = startPrintLog(document);
const fileParts: FileMenuParts = {
  open: { id: "open", label: "Open…", title: OPEN_TITLE, key: fileKey("Mod+O"), run: () => $("open-file").click() },
  ...(__HOME_SCREEN__ ? { home: { id: "file-home", label: "Home…", title: "Home: carry on with the last project, start a new one, or find another", run: () => void home?.show() } } : {}),
  projects: { id: "file-projects", label: "Projects in this browser…", title: "Projects in this browser: every project kept here, to open again or delete", run: () => void projects.show() },
  ...(__ACCOUNTS__ ? { myDesigns: { id: "file-my-designs", label: "My designs…", title: "My designs: the designs kept in your account, to open on any device you sign in on", run: () => void accountHooks?.showDesigns() } } : {}),
  ...(__ACCOUNTS__ && pageShareSwitch().on ? { share: { id: "file-share", label: "Share…", title: "Share: make a link to a frozen copy of this design that anyone can open (this feature is still being checked)", run: () => void accountHooks?.share() } } : {}),
  versions: { id: "file-versions", label: "Earlier versions…", title: "Earlier versions: how this project was earlier, kept in this browser as you work, to restore (Undo takes it back)", run: () => void versions.show() },
  printLog: { id: "file-print-log", label: "Print log…", title: "Print log: the print files you saved from Slice for printing, to note how each one printed", run: () => printLog.show() },
  save: { id: "file-save", label: "Save", title: SAVE_TITLE, key: fileKey("Mod+S"), run: () => void save() },
  saveAs: { id: "file-save-as", label: "Save As…", title: SAVE_AS_TITLE, key: fileKey("Mod+Shift+S"), run: () => void save(true) },
  where: () => {
    const id = panesInUse().map((p) => pool.showing(p))[0];
    return id ? workspaceTitle(id) : "Community";
  },
  entries: () => {
    for (const p of panesInUse()) {
      const entries = pool.awake(p)?.view.fileEntries?.();
      if (entries) return entries;
    }
    return null;
  },
};
const file = fileMenu(document, fileParts);
$("file-bar").prepend(file.element);
// The command search box (S) lists the shell's own commands after the workspace's (issue #523): Undo and Redo, File ▾'s
// entries as File ▾ has them now (Export STL off with File ▾'s reason on an empty design) and Settings.
shellCommands(document, () => [
  { id: "shell-undo", label: "Undo", key: fileKey("Mod+Z"), off: ctx.history.undoLabel() === null ? "Nothing to undo" : undefined, run: () => undoRedo("undo") },
  { id: "shell-redo", label: "Redo", key: fileKey("Mod+Shift+Z"), off: ctx.history.redoLabel() === null ? "Nothing to redo" : undefined, run: () => undoRedo("redo") },
  ...fileSections(fileParts).flatMap((sec) => sec.items).map((i) => ({ id: `shell-${i.id}`, label: i.label, key: i.key, off: i.off, run: i.run })),
  { id: "shell-settings", label: "Settings", run: () => $("settings-open").click() },
]);
/** What Open says when the last project's changes, refused because another tab saved, were kept as project `name`. */
const keptApartWords = (name: string) => `Your changes in this tab couldn't be saved, because the project was changed in another tab meanwhile. Nothing is lost: they're kept in this browser as a separate project, “${name}” (File > Projects in this browser opens it).`;
/** Puts `project` in place of the open one: every workspace mounted afresh on it, nothing to undo. */
function replaceProject(project: Project) {
  savedTo = null; // the file belonged to the old project
  projectFile = null; // and so did its name
  filesOf.clear(); // and nothing of the old project can be undone back to
  freshPending = false;
  fileOwner++;
  ctx.selection.clear(); // it named the old part's faces
  ctx.project = project;
  useGraph(new DependencyGraph(), new ChangeNotes()); // the old notes were about the old project
  pool.forgetAll(); // every warm workspace showed the old project
  steps.stop(); // the old project's steps kept as they were, before the history starts afresh
  show(current); // mounts the workspace on the new project
  if (split) mountSplit(split.id); // and the second one
  ctx.history.reset(); // a new start: nothing from the old project to undo
  assistant.projectReplaced(); // an AI answer asked about the old project never reaches this one (tabs hunt E1)
  tabs?.landed();
}
/**
 * An OK the kernel is still checking lands before another project takes the open one's place (Open, Projects in this
 * browser, a shared link's copy), as the design tabs wait before a switch: opened at once, the step was dropped from the
 * project left behind without a word (app-wide hunt 2026-11-14, S-1). A question waiting for the person is not waited on.
 */
async function okLanded() {
  if (ctx.history.working()) await ctx.history.whenIdle();
}
/**
 * Replaces the open project with the one in `text`; throws, leaving the
 * open project as it was, when it doesn't read cleanly. The opened file is
 * kept in this browser only once it has shown (security audit S2): one that
 * freezes the tab while it builds is never stored, so never reopened.
 */
function openProject(file: string | Uint8Array, fileName = "") {
  const read = projectFromJson(file, workspaces);
  // A project never named takes its file's name, so two opened files can be told apart in Projects in this browser
  // (every one said "Untitled", export hunt 2026-11-12, #644 item 3); a name of its own it keeps.
  const fromFile = fileName.replace(/(\.spindlelabs|\.panosolid|\.fission)?\.json$|\.spindle$/i, "").trim().slice(0, MAX_PROJECT_NAME);
  const project = (read.name === "" || read.name === "Untitled") && fromFile !== "" ? { ...read, name: fromFile } : read;
  // The old project is kept as it was, its last change too (finish, not stop: one made within the quiet moment
  // before Open was dropped, timeline hunt follow-up); nothing of the new one is stored yet. Changes this tab couldn't
  // store (another tab saved since) are kept as a separate project, and said (round 2 hunt A5: Open dropped them).
  tabs?.expect(null);
  const apart = finishAutosave();
  autosave = null;
  // A file already kept here as it is (opened before, unchanged since) goes on under its stored id, not as one more
  // copy no one can reach (real-use hunt B3). Looked up while it opens, once the last project's saves have landed
  // (#331: one still landing, Save's new name stored by New's last save, left the save time read here stale, and
  // the opened file's first save was refused as another tab's); a store that can't answer means a new copy.
  // A file whose project took the file's name is also looked up under the name inside it: the project it was saved
  // from, still "Untitled" here, goes on under its id with the new name, not as a second copy beside it.
  const nothing = { found: undefined, exact: false } as { found: Awaited<ReturnType<typeof storedCopy>>; exact: boolean };
  const lookUp = async () => {
    const exact = await storedCopy(store, project);
    if (exact !== undefined || project === read) return { found: exact, exact: exact !== undefined };
    return { found: await storedCopy(store, read), exact: false };
  };
  const copy = canKeep ? lastWrites.then(lookUp).catch(() => nothing) : Promise.resolve(nothing);
  guard.finished(); // the last project, if it was still opening, didn't freeze the tab
  fileStatus(apart === null ? "" : keptApartWords(apart));
  replaceProject(project);
  projectFile = fileName.replace(/(\.spindlelabs|\.panosolid|\.fission)?\.json$/i, ""); // Save's own ending (.spindle) it takes off itself
  // Not kept until it has shown: until then the mark says "Saving…" and leaving asks first. It said "Saved" (the last
  // project's mark), and a reload in that moment quietly brought the last project back instead (issue #247).
  statusBeforeOpening ??= shownStatus; // a file opened while another was still opening: the mark from before both
  if (canKeep) saveStatus({ state: "saving" });
  let kept = false;
  const keepIt = () =>
    void copy.then((looked) => {
      const found = looked.found;
      let exact = looked.exact;
      if (kept) return;
      kept = true;
      unfollow();
      if (ticket !== openings) return; // another opening, or Start fresh, since
      statusBeforeOpening = null;
      // Its first save writes it (so it is the project a reload opens), checking no other tab changed the copy since.
      openedFile = true;
      // A file already kept here as it is, and not changed while it opened, is not stored again: only brought
      // forward (the same save time), as a project opened from the list is. Stored again it got a new save time, and
      // another tab still on that project had every later edit refused as "changed in another tab" (export hunt
      // 2026-11-12, #642 item 1).
      // Kept here already under the name inside the file (the project it was saved from) and not changed while it
      // opened: it stays that project, name and all, so nothing is stored and no other tab on it is overtaken.
      if (found !== undefined && !exact && !ctx.history.canUndo()) {
        ctx.project = { ...ctx.project, name: read.name };
        ctx.history.reset();
        exact = true;
      }
      if (found === undefined || !exact || ctx.history.canUndo()) {
        keep(found?.id ?? newId(), false, found?.modified ?? null);
        return autosave?.changed(); // store the opened file, with anything changed while it opened
      }
      keep(found.id, true, found.modified);
      const waiting: AutosaveStatus = { state: "saving" };
      storingAgain.add(waiting); // kept already as it is: nothing of the person's is waiting (tabs hunt A5)
      saveStatus(waiting);
      const mine = autosave;
      const done = () => void (autosave === mine && shownStatus === waiting && saveStatus({ state: "saved" }));
      bringForward(store, found.id, found.modified).then(done, () => (autosave === mine ? autosave?.changed() : undefined)); // can't be brought forward: stored as before
    });
  // Changed before it has shown (the engine still downloading on a first visit, a big file's first build): a tab that
  // takes an edit is not frozen, so the file is kept now, with the edit. It waited for the build, and a reload or a
  // closed tab meanwhile brought the last project back without the file or the edit (#627 item 3).
  const unfollow = ctx.history.onChange(() => ctx.history.canUndo() && keepIt());
  const ticket: number = whileOpening(OPENING_FILE, keepIt);
}

/** `asked`, or a refusal once it has taken STORAGE_ANSWER_MS: a store that never answers fails in words (tabs hunt B4). */
const inTime = <T>(asked: Promise<T>) =>
  Promise.race([asked, new Promise<never>((_, refuse) => setTimeout(() => refuse(new Error("browser storage didn't answer")), STORAGE_ANSWER_MS))]);
/**
 * Opens the project kept here as `id` (File > Projects in this browser, U6a; round 2 hunt A2/A3) in place of the open
 * one, which is kept as it is (finish, as Open does). Throws, leaving the open project as it was, when it can't be
 * read. Once it has shown it is kept under its own id, and stored again as it is with a new save number
 * (bringForward), so a reload opens it; one that freezes the tab building it is never brought forward, so a reload
 * opens the last project as before (security audit S2).
 */
async function openStored(id: string, modified: Date | null) {
  await started;
  await okLanded();
  // Its newest state when the store had no room for it (storage full), as start() opens it (real-use hunt B1).
  const kept = keptEntry(local, id);
  // Read before anything is replaced, so a store that never answers leaves the open project as it was (tabs hunt B4).
  const project = kept === null ? await inTime(store.open(id)) : projectFromJson(kept, workspaces);
  // Changes this tab couldn't store (another tab saved since) are kept as a separate project, and said, as Open does (round 2 hunt A5).
  tabs?.expect(id);
  const apart = finishAutosave();
  autosave = null;
  guard.finished();
  fileStatus(apart === null ? "" : keptApartWords(apart));
  replaceProject(project);
  const before = shownStatus;
  // Kept under its id at once, as start() keeps the last project: its autosave must take the project as the store
  // holds it. Started once it had shown, it took a size typed meanwhile for the stored state, said "Saved" and never
  // stored it (#627 item 2). Only bringing it forward waits for the build, so one that freezes the tab is not reopened.
  keep(id, kept === null, kept === null ? modified : null, kept !== null);
  statusBeforeOpening ??= before;
  const opening: AutosaveStatus = { state: "saving" };
  if (kept === null) storingAgain.add(opening); // it is in the store as it shows (one from the journal is not)
  saveStatus(opening);
  whileOpening(OPENING_FILE, () => {
    statusBeforeOpening = null;
    if (kept !== null) return saveStatus({ state: "error", message: "this browser's storage had no room for your latest changes. They're kept until it has, and Save keeps them as a file." });
    if (modified === null) return autosave?.changed(); // no save time to expect: its first save stores it, and lists it first
    // "Saving…" until it is the project a reload opens (leaving meanwhile asks first), unless an edit's own save took over the mark.
    const waiting: AutosaveStatus = { state: "saving" };
    storingAgain.add(waiting);
    saveStatus(waiting);
    const mine = autosave;
    const done = (s: AutosaveStatus) => void (autosave === mine && shownStatus === waiting && saveStatus(s));
    bringForward(store, id, modified).then(
      () => done({ state: "saved" }),
      (e) => {
        done({ state: "saved" }); // the project itself is stored as it was: only which one a reload opens is not
        fileStatus(`"${project.name || "Untitled"}" is open, but this browser couldn't mark it as the last project (${e instanceof Error ? e.message : String(e)}), so a reload may open another one: File > Projects in this browser reaches it.`);
      },
    );
  });
}
/** The account's version of kept project `id` saved `at` (only with accounts on and signed in); throws why not. */
async function accountVersionText(id: string, at: Date): Promise<string> {
  if (!accountHooks) throw new Error("this version is kept in your account: sign in to restore it");
  return accountHooks.versionText(id, at);
}
/** The open project's id when it is kept (null while a new one waits for its first change, or a file opens). */
const keptId = () => (autosave === null ? null : (document.body.dataset.projectId ?? null));
/**
 * Puts the open project's version saved `at` (File > Earlier versions, missing basics 3b) in place of the project as
 * it is now, as ONE undo step, the way Undo puts a state back: Undo takes it back. Throws, changing nothing, when it
 * can't be read.
 */
async function restoreVersion(at: Date, where: VersionPlace = "browser") {
  await started;
  const id = keptId();
  if (id === null) throw new Error("this project isn't kept in this browser yet, so it has no earlier versions");
  // A version kept only in the account (account features 2) is read from there, and opened as a file is, so one that
  // isn't a project, or comes from a newer SpindleLabs, is refused in the same words before anything changes.
  const text = where === "account" ? projectToJson(projectFromJson(await accountVersionText(id, at), workspaces)) : projectToJson(await store.openVersion(id, at));
  const when = versionTime(at, new Date());
  ctx.selection.clear(); // it named faces of the project as it is now
  // One step: the remount's amend inside it is taken into the step, not into the present (it would leave nothing to undo).
  ctx.history.step(`Restore the version from ${when}`, () => restoreSnapshot(text));
  fileStatus(`Restored the version from ${when}. Undo takes it back.`);
}
const versions = versionList(document, {
  list: async () => {
    const id = keptId();
    if (id === null) return null;
    const [times, account] = await Promise.all([store.versions(id), accountHooks?.versionsOf(id).catch(() => null) ?? null]);
    return { name: ctx.project.name, times, account };
  },
  restore: restoreVersion,
});
const projects = listedProjects(document, {
  store,
  journal: local,
  openId: keptId,
  open: openStored,
  removed: (id) => tabs?.forget(id), // its tab goes too (tabs hunt B3)
});

/** A new, empty project in place of the open one (the home screen's New, and "+" on the design tabs). */
async function startNewProject(keepNow = false) {
  await started;
  openings++; // a project still opening is never kept or counted as reopened
  endOffer();
  guard.finished();
  tabs?.expect(null);
  keepOnFirstChange(); // first: the last project's autosave must not store the new one over it
  replaceProject(emptyProject());
  // A new tab is kept at once, so it is still there when another tab is chosen and chosen back.
  if (keepNow && keepOnChange !== null) {
    keep(keepOnChange);
    autosave?.changed(); // stored now, not at its first change
  }
  fileStatus("");
}
/** The design tabs (only when the build has them, tabs.config.mjs): one tab for each project open at once. */
const tabs: ShellTabs | null = !__DESIGN_TABS__
  ? null
  : shellTabs(document, {
      after: $("topbar"),
      keptId,
      projectName: () => ctx.project.name,
      workspace: () => current,
      titles: () => Object.fromEntries(workspaces.map((w) => [w.id, w.title])),
      open: async (id) => {
        const listed = (await inTime(store.list())).find((s) => s.id === id);
        // Deleted here or in another window (tabs hunt B3, C2): said as such, and its tab closed, not a raw store error.
        if (listed === undefined && keptEntry(local, id) === null) throw new ProjectGone(id);
        return openStored(id, listed !== undefined && !listed.problem ? listed.modified : null);
      },
      start: () => startNewProject(true),
      idle: () => ctx.history.whenIdle(),
      preselect: (id) => {
        if (split?.id !== id && pages.includes(id)) current = id as Page; // the next project shows in the workspace its tab was in
      },
      capture: () => ({ history: ctx.history.save(), selection: [...ctx.selection.items], camera: viewer.main.cameraPose() }),
      apply: (view) => {
        const v = view as { history: SavedHistory; selection: GeometryReference[]; camera: Parameters<typeof viewer.main.restorePose>[0] };
        const project = ctx.project;
        // The steps come back only for the project as it was left; a project that differs starts afresh (already so).
        if (ctx.history.load(v.history)) ctx.selection.set(v.selection);
        // The camera once the workspace has shown the project and framed it, unless another tab was chosen meanwhile.
        void shownOnScreen().then(() => ctx.project === project && viewer.main.restorePose(v.camera));
      },
      // Only changes not stored yet: "Saving…" while an opened project is only being stored again as it is asked for
      // nothing (tabs hunt A5).
      unsaved: () => shownStatus.state !== "saved" && !storingAgain.has(shownStatus),
      report: fileStatus,
      kept: async () => (await inTime(store.list())).map((s) => ({ id: s.id, name: s.problem === undefined ? s.name : null })),
      view: () => $("viewport"),
      held: (id) => keptEntry(local, id) !== null,
      storage: local,
      session: (() => {
        try {
          return sessionStorage;
        } catch {
          return null; // storage off: each window starts from the last list
        }
      })(),
    });
/** The home screen (U6b, only when the build has it): over the open project, which stays open under it. */
const home = !__HOME_SCREEN__ ? null : homeScreen(document, {
  list: () => store.list(),
  openId: keptId,
  open: openStored,
  remove: async (id) => {
    if (id === keptId()) throw new Error("the open project can't be deleted here");
    await forget(store, local, id);
    tabs?.forget(id); // its tab goes too (tabs hunt B3)
  },
  // Not the open project (its name is the open one's to change; the screen offers no Rename for it).
  rename: async (id, name) => {
    if (id === keptId()) throw new Error("rename the open project in its own name box");
    await renameKept(store, id, name);
    tabs?.rename(id, name); // its tab says the new name (tabs hunt C5)
  },
  newProject: () => startNewProject(),
  chooseFile: () => $("open-file").click(),
  showGuide: () => $("guide-open").click(),
  workspaceTitle,
});

// While a project opens (the last one reopened, or a file), the top bar
// offers to start a new one instead once it has taken OFFER_MS, so a big
// project that takes long to build is never a wait with no way out
// (security audit S2). The project being opened is then never kept (a
// file) or counted as reopened (the last one, still kept as it was).
const OFFER_MS = 1500;
const OPENING_LAST = "Opening the last project…";
const OPENING_FILE = "Opening the project…";
/** The save mark from before a file began opening, while one is opening and not yet kept (null otherwise). */
let statusBeforeOpening: AutosaveStatus | null = null;
/** Counts openings: Start fresh, or another opening, ends the wait for the one before. */
let openings = 0;
/** What is being opened while the offer stands. */
let openingNow: string | null = null;
/** Settles once every workspace on screen has shown the project (each one's `ready`). */
const shownOnScreen = () => Promise.all((["main", "split"] as const).map((p) => pool.awake(p)?.view.ready)).then(() => {});
/** Returns the opening's ticket: `openings` moves past it once another opening, or Start fresh, ends its wait. */
function whileOpening(words: string, opened: () => void) {
  const ticket = ++openings;
  const loading = holdSkeleton($("viewport"), "view", words); // seen only if it takes over 200 ms (@fission/ui skeleton.ts)
  const offer = setTimeout(() => {
    if (ticket !== openings) return;
    openingNow = words;
    fileStatus(words);
    $("opening-fresh").hidden = false;
  }, OFFER_MS);
  void shownOnScreen().then(() => {
    void loading.done();
    clearTimeout(offer);
    if (ticket !== openings) return;
    endOffer();
    opened();
  });
  return ticket;
}
/** Takes the offer away, and its words if nothing has replaced them. */
function endOffer() {
  $("opening-fresh").hidden = true;
  if (openingNow !== null && $("file-status").textContent === openingNow) fileStatus("");
  openingNow = null;
}
$("opening-fresh").addEventListener("click", () => {
  const was = openingNow;
  openings++; // the project being opened is never kept or counted as reopened
  endOffer();
  guard.finished(); // the last project didn't freeze the tab: the next visit opens it as before
  tabs?.expect(null);
  keepOnFirstChange(); // first: the last project's autosave must not store the new one over it
  replaceProject(emptyProject());
  // The file is never kept: the mark says again what it said for the last project, kept as it was.
  if (statusBeforeOpening !== null) saveStatus(statusBeforeOpening);
  statusBeforeOpening = null;
  fileStatus(
    was === OPENING_LAST
      ? "Started a new project instead. The last one is still kept in this browser: reload the page, before changing anything, to try it again."
      : "Started a new project instead. The file was not opened: open it again to try again.",
  );
});
$("open-file").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("open-file");
  const file = input.files?.[0];
  input.value = ""; // so choosing the same file again opens it again
  if (file) await receive([file]);
});

// Files from outside (X6): a file dropped anywhere on the app, or pasted
// (outside a text field), goes through the representation registry: a
// project opens as Open does, a PNG or JPEG opens in Image, and anything
// else is refused in the top bar with what will take it and when. A file
// for a workspace not on screen asks first ("Open in Image?"; the owner's
// ask, 2026-10-28): Cancel opens nothing and leaves you where you were.
const elsewhere = openElsewhere(document);
/** A file the browser can no longer read: moved or deleted after the drag began, a cloud placeholder, a permission change. */
class Unreadable extends Error {}
/** Reads `part` of `file`; a failure says the file is too big for the browser (how much was being read) or gone. */
async function readBytes(file: File, part: Blob): Promise<ArrayBuffer> {
  try {
    return await part.arrayBuffer();
  } catch {
    throw new Unreadable(unreadableMessage(file.name, part.size));
  }
}
/** `folders[i]`: files[i] is a folder (a drop says so; it can't be read as a file). */
async function receive(files: File[], folders: readonly boolean[] = []) {
  await started; // or the project being reopened would replace what this opens
  let heads: FileHead[];
  try {
    // A project-named file is read whole (it is size-capped) so it can be parsed; anything else, its start.
    heads = await Promise.all(files.map(async (f, i): Promise<FileHead> => (folders[i] ? { name: f.name, size: f.size, head: new Uint8Array(), folder: true } : { name: f.name, size: f.size, head: new Uint8Array(await readBytes(f, f.slice(0, headBytesFor(f.name, f.size)))) })));
  } catch (e) {
    if (e instanceof Unreadable) return fileStatus(e.message);
    throw e;
  }
  const route = routeFiles(representations, heads, (w) => listed.some((l) => l.id === w)); // an unlisted workspace's files are refused (listed-workspaces.ts)
  if (!route) return;
  if (route.kind === "refused") return fileStatus(route.message);
  const file = files[0];
  const target = route.importer.workspace;
  if (target && pool.showing("main") !== target && pool.showing("split") !== target) {
    const here = pool.showing("main");
    if (!(await elsewhere.ask(file.name, formatInfo(route.format).one, workspaceName(target), here ? workspaceName(here) : null))) return;
  }
  try {
    await route.importer.open(file.name, new Uint8Array(await readBytes(file, file)));
  } catch (e) {
    if (e instanceof Unreadable) return fileStatus(e.message);
    return fileStatus(`Couldn't open “${file.name}”: ${e instanceof Error ? e.message : String(e)}`);
  }
  const into = route.importer.workspace;
  if (!into) return; // the shell itself (a project) has already shown it, and said what it says (openProject)
  fileStatus("");
  pool.forget(into); // mounted afresh, to show what it opened
  if (split?.id === into) mountSplit(into); // where it already is
  else show(into);
}
const carriesFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
const dropHint = (on: boolean) => {
  document.body.dataset.drop = on ? "on" : ""; // read by the e2e test
  $("workspace").classList.toggle("file-drop", on); // the outline (styles/file-drop.css)
};
window.addEventListener("dragover", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault(); // allows the drop
  e.dataTransfer!.dropEffect = "copy";
  dropHint(true);
});
window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) dropHint(false); // left the window
});
window.addEventListener("drop", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault(); // never let the browser navigate to the file
  dropHint(false);
  // Which of the dropped files are folders: only the drop's own items can tell, and only during the event.
  const entries = [...e.dataTransfer!.items].filter((item) => item.kind === "file").map((item) => item.webkitGetAsEntry?.() ?? null);
  const files = [...e.dataTransfer!.files];
  void receive(files, files.map((_, i) => entries[i]?.isDirectory === true));
});

// One shortcut table (X7b): the shell's keys and every workspace's. A key
// goes to the workspace in the pane last clicked or focused, then the other
// one on screen, then the shell; a sleeping workspace never hears one.
// Copy, cut and paste come from the clipboard events, so the browser's Edit
// menu runs them too. Keys are left alone while typing in a field, unless a
// shortcut says otherwise.
const shortcuts = new ShortcutTable(SHELL_SHORTCUTS, workspaces);
for (const c of shortcuts.clashes()) console.error(`Shortcut clash: ${c.message}`); // a unit test keeps this empty
let activePane: PaneId = "main";
for (const type of ["pointerdown", "focusin"] as const)
  document.addEventListener(type, (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest("#split")) activePane = "split";
    else if (e.target.closest("#workspace")) activePane = "main";
  }, true);
/** The panes showing a workspace, the one in use first. */
const panesInUse = (): PaneId[] => (activePane === "split" ? ["split", "main"] : ["main", "split"]).filter((p): p is PaneId => pool.showing(p as PaneId) !== null);
/** Typing in a field: a text box, text area, list or editable text. A tickbox, radio or button takes no letters, so keys still reach the shortcuts after one is clicked (found in SF1: ticking Snap to grid stopped L, R, C and A). */
const TEXT_FIELDS = "input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=range], [type=color], [type=file]), textarea, select, [contenteditable]:not([contenteditable=false])";
const inText = (t: EventTarget | null) => t instanceof Element && t.closest(TEXT_FIELDS) !== null;
/**
 * Undo and Redo keys in a text field are the browser's own, of the typing in it, except where the field holds no typing
 * of its own to take back: a field whose typing is the project's steps as typed (`data-undo="app"`, Design's size
 * boxes), a list, and a box emptied once its value was used (`data-undo="app-empty"`, the sketch's typed sizes after
 * Enter). There the keys are the project's Undo and Redo. Left to the browser they did nothing for the emptied box, and
 * in a size box untyped a digit as a NEW step, a 60 mm box becoming 6 mm (Undo hunt 2026-11-12, #623).
 */
const UNDO_KEYS = new Set(["undo", "redo", "redo-y"]);
function undoIsOurs(t: EventTarget | null): boolean {
  const field = t instanceof Element ? t.closest(TEXT_FIELDS) : null;
  if (!(field instanceof HTMLElement)) return false;
  return field instanceof HTMLSelectElement || field.dataset.undo === "app" || (field.dataset.undo === "app-empty" && (field as HTMLInputElement).value === "");
}
// The browser keeps one undo of typing for the whole page, not one per field: Ctrl+Z in the command search or a panel's
// box, with nothing left of its own to untype, went on to untype the last size typed in a size box, wherever the keys
// were. A size box's typing is never the browser's to take back or redo.
document.addEventListener(
  "beforeinput",
  (e) => {
    if ((e.inputType === "historyUndo" || e.inputType === "historyRedo") && e.target instanceof HTMLElement && e.target.dataset.undo === "app") e.preventDefault();
  },
  true,
);
const shellShortcuts: Record<string, (e: Event) => boolean> = {
  shortcuts: () => (showShortcuts(), true),
  undo: () => (undoRedo("undo"), true),
  redo: () => (undoRedo("redo"), true),
  "redo-y": () => (undoRedo("redo"), true),
  save: () => (void save(), true),
  "save-as": () => (void save(true), true),
  open: () => ($("open-file").click(), true),
  "paste-files": (e) => {
    const files = [...((e as ClipboardEvent).clipboardData?.files ?? [])];
    // No files: the workspace in use may take the text (Design's copied bodies, Ctrl+V); else text pastes as usual.
    if (files.length === 0) return panesInUse().some((p) => pool.awake(p)?.view.shortcut?.("paste-bodies", e) === true);
    void receive(files);
    return true;
  },
};
function runShortcut(chord: Chord, e: Event) {
  // Every dialog the app opens is modal (the key list, the guide, Design's item menu and its questions): while one is
  // open no shortcut runs, so Escape is the dialog's own and the browser closes it, wherever the focus went
  // (timeline hunt, finding 13: the item menu stayed open once the focus had left it).
  if (document.querySelector("dialog[open]")) return;
  const panes = panesInUse();
  const entry = shortcuts.lookup(chord, panes.map((p) => pool.showing(p)!));
  if (!entry || (!entry.inText && inText(e.target) && !(UNDO_KEYS.has(entry.id) && undoIsOurs(e.target)))) return;
  const done = entry.scope === "app" ? shellShortcuts[entry.id]?.(e) : pool.awake(panes.find((p) => pool.showing(p) === entry.scope)!)?.view.shortcut?.(entry.id, e);
  if (done !== false && done !== undefined) e.preventDefault();
}
const clipboardChords = new Set<string>(Object.values(CLIPBOARD_CHORDS));
document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  const chord = chordOf(e);
  if (chord && !clipboardChords.has(chord)) runShortcut(chord, e);
});
for (const type of ["copy", "cut", "paste"] as const) document.addEventListener(type, (e) => runShortcut(CLIPBOARD_CHORDS[type], e));
// The list of every key (?), the workspaces on screen first. No top-bar button:
// the bar has no room left for one at 1280 px (the wide-screen smoke check).
const shortcutDialog = Object.assign(document.createElement("dialog"), { id: "shortcuts", className: "shortcut-list" });
shortcutDialog.setAttribute("aria-labelledby", "shortcuts-title");
document.body.append(shortcutDialog);
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
/** Opens the list; `back`, when given, runs once it closes (Close or Escape): opened from Settings, it goes back there. */
function showShortcuts(back?: () => void) {
  const groups = shortcuts.help(panesInUse().map((p) => pool.showing(p)!)).map((g) => ({
    title: g.scope === "app" ? "Everywhere" : workspaceTitle(g.scope),
    onScreen: g.onScreen,
    rows: g.entries.map((e) => ({ keys: chordLabel(e.chord, mac), label: e.label })),
  }));
  shortcutDialog.innerHTML = `<header><h2 id="shortcuts-title">Keyboard shortcuts</h2><button type="button" class="close">Close</button></header>${shortcutList(groups)}`;
  shortcutDialog.querySelector(".close")!.addEventListener("click", () => shortcutDialog.close());
  if (back) shortcutDialog.addEventListener("close", back, { once: true });
  shortcutDialog.showModal();
}
// What's new (Settings > About): the public list of changes, built in from WHATS_NEW.md (whats-new.mjs). Like the
// shortcuts list, Close and Escape go back to Settings.
declare const __WHATS_NEW__: string;
declare const __APP_VERSION__: string | null;
const whatsNewDialog = Object.assign(document.createElement("dialog"), { id: "whats-new", className: "whats-new" });
whatsNewDialog.setAttribute("aria-labelledby", "whats-new-title");
document.body.append(whatsNewDialog);
function showWhatsNew(back?: () => void) {
  const note = Object.assign(document.createElement("p"), { className: "whats-new-note", textContent: whatsNewNote(__APP_VERSION__) });
  whatsNewDialog.innerHTML = `<header class="whats-new-head"><div class="whats-new-title"><h2 id="whats-new-title">What's new</h2><button type="button" class="close">Close</button></div></header><div class="whats-new-body">${whatsNewList(parseWhatsNew(__WHATS_NEW__))}</div>`;
  whatsNewDialog.querySelector(".whats-new-head")!.append(note);
  whatsNewDialog.querySelector(".close")!.addEventListener("click", () => whatsNewDialog.close());
  if (back) whatsNewDialog.addEventListener("close", back, { once: true });
  whatsNewDialog.showModal();
  whatsNewDialog.querySelector<HTMLElement>(".whats-new-body")!.scrollTop = 0;
}
// Settings: a card dialog of sections (@fission/ui settings.ts), kept in this
// browser alone. Close, Escape and a tap outside the card all leave it.
const settingsDialog = Object.assign(document.createElement("dialog"), { id: "settings", className: "settings" });
settingsDialog.setAttribute("aria-labelledby", "settings-title");
document.body.append(settingsDialog);
let browserSettings: SettingsStore | null = null;
const settings = () => (browserSettings ??= new SettingsStore(local));
// The theme (U1b, U2a): the page already wears it (public/theme-init.js ran before the first paint); this keeps it in step with the Settings choice and the device.
// The browser checks switch the tooltips off (e2e/browser.mjs) so code that reads a title under the mouse sees it; e2e/tooltip.mjs keeps them on. The live build has no such switch.
if (!(__TEST_HOOKS__ && (window as unknown as { __noTooltips?: boolean }).__noTooltips)) startTooltips(document);
// Units (U2c2): the page wears the stored unit (data-unit) and tells the screens when it changes.
const chooseUnit = startUnits(document, settings());
// Design's defaults (U2b): the grid size and Snap to grid a new sketch starts with, worn as data-grid-size and data-grid-snap.
const designDefaults = startDesignDefaults(document, settings());
// The mouse preset (U2d): the page wears it (data-mouse) and the 3D views follow it.
const chooseMouse = startMouse(document, settings());
const chooseTheme = startTheme(document, settings(), typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null);
$("settings-open").addEventListener("click", () => {
  settings(); // read once now, so the first real setting has its place
  // The shortcuts list opened from Settings closes back to it, with focus on its Show (Ben, 2026-11-04: it closed both).
  const backToSettings = () => {
    settingsDialog.showModal();
    settingsDialog.querySelector<HTMLElement>("[data-section=general] .settings-action")?.focus();
  };
  fillSettingsNow(backToSettings);
  settingsDialog.showModal();
});
/** The AI provider settings live in the assistant panel: open it (the AI button, if closed) and bring them into view. */
function showAiSettings() {
  const toggle = $("assistant-toggle");
  if (toggle.getAttribute("aria-pressed") !== "true") toggle.click();
  const target = document.querySelector<HTMLElement>(".ai-settings");
  target?.scrollIntoView({ block: "start" });
  target?.querySelector<HTMLElement>("select, input, button")?.focus();
}
/** What's new opened from Settings closes back to it, with focus on its Show. */
function backFromWhatsNew() {
  settingsDialog.showModal();
  document.getElementById("settings-whats-new")?.focus();
}
function fillSettingsNow(backToSettings: () => void) {
  fillSettings(settingsDialog, { version: $("version").textContent ?? "", onShortcuts: () => showShortcuts(backToSettings), onWhatsNew: () => showWhatsNew(backFromWhatsNew), theme: readThemeChoice(settings()), onTheme: chooseTheme, custom: readCustom(settings()), onCustom: (c) => applyCustom(document, settings(), c).notes, unit: readUnitChoice(settings()), onUnit: chooseUnit, onReportBug: () => bugReport.show(), mouse: readMouseChoice(settings()), onMouse: chooseMouse, grid: readGridSize(settings()), onGrid: designDefaults.setGrid, snap: readGridSnap(settings()), onSnap: designDefaults.setSnap, onAiSettings: showAiSettings });
}
// Report a bug (Ben, 2026-11-04, easier 2026-11-11; @fission/ui bug-report.ts): from Settings > About, one optional
// box and the open design attached (ticked by default), sent to the report service when there is one, else a filled-in
// GitHub issue in a new tab with the design downloaded to drag into it. The app adds the version, browser, screen,
// workspace and the page's last few errors (kept here from the moment the page starts).
const recentErrors: string[] = [];
const keepError = (text: string) => {
  recentErrors.push(text.slice(0, 300));
  if (recentErrors.length > 10) recentErrors.shift();
};
window.addEventListener("error", (e) => keepError(`${e.message}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`));
window.addEventListener("unhandledrejection", (e) => keepError(`Unhandled: ${e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason)}`));
const bugReport = bugReportDialog(document, {
  facts: () => ({ version: `${__APP_VERSION__ ?? "unknown"} (${$("version").textContent || "kernel not started"})`, browser: navigator.userAgent, screen: `${innerWidth} × ${innerHeight}`, workspace: current, errors: [...recentErrors] }),
  design: () => ({ name: projectFile || ctx.project.name || "Untitled", text: projectToJson(ctx.project) }),
  open: (url) => void window.open(url, "_blank", "noopener"),
  download: (name, text) => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  },
  // On SpindleLabs' own pages, the report service; a browser test may name a fake one before the page loads.
  endpoint: bugReportEndpoint(location.origin, (window as { __bugReportService?: string }).__bugReportService),
});
settingsDialog.addEventListener("click", (e) => {
  if (e.target === settingsDialog) settingsDialog.close(); // the backdrop belongs to the dialog element
});
// My designs' hooks, once the account code has started (pictureOfView and accountHooks are near the top).
if (__ACCOUNTS__)
  void import("./account.ts").then(async (m) => {
    // My designs (account features 1) reads and keeps projects through the same store as everything else, and opens
    // them the way File > Projects in this browser does.
    accountHooks =
      (await m.startAccounts(__ACCOUNTS__!, {
        list: () => store.list(),
        text: async (id) => {
          try {
            return projectToJson(await store.open(id));
          } catch {
            return null; // gone, or can't be read: not sent
          }
        },
        stored: (id) => store.text(id),
        asRead: (text) => {
          try {
            return projectToJson(projectFromJson(text, workspaces));
          } catch {
            return null;
          }
        },
        put: async (id, text, name, savedAt) => {
          const project = projectFromJson(text, workspaces);
          project.name = name;
          const key = id ?? newId();
          await store.save(key, project, savedAt);
          return key;
        },
        openId: () => (autosave === null ? null : (document.body.dataset.projectId ?? null)),
        open: openStored,
        workspace: () => current,
        picture: pictureOfView,
      }, {
        // Settings that follow you (account features 3) were just written to this browser's storage: the Settings
        // page's are read again and the theme and units put on at once; the slicer's are read when its dialog opens.
        applied: (keys) => {
          if (!keys.includes(SETTINGS_KEY)) return;
          settings().reload();
          chooseTheme(readThemeChoice(settings()));
          chooseUnit(readUnitChoice(settings()));
          chooseMouse(readMouseChoice(settings()));
          // Open meanwhile: it shows the new choices.
          if (settingsDialog.open) fillSettingsNow(() => settingsDialog.showModal());
        },
      }, {
        // Sharing links (community C2): the open design's text, a picture of it, and a link's copy opened as a new project.
        current: () => (ctx.project ? { name: ctx.project.name || "Untitled", text: projectToJson(ctx.project) } : null),
        picture: pictureOfView,
        openText: async (text) => {
          await started;
          await okLanded();
          openProject(text, "");
        },
      })) ?? null;
  });
// Undo and Redo (step 20b): the top bar's buttons and the keys above. Each
// button says what it would take back or do again, and is off when there is
// nothing; a snapshot that can't be put back says why and moves nothing.
// An OK the kernel still checks (Extrude, Move, Edit feature) is held in the history: Undo or Redo pressed meanwhile
// waits for it, in the order pressed, so it takes back that OK and not the step before (clumsy hunt 2026-11-04).
let pressesWaiting = 0;
let pressed: Promise<void> = Promise.resolve();
/** The presses of each button still waiting (clumsy-user hunt 2026-11-04: a waiting Undo looked as if nothing had happened). */
const waitingOn = { undo: 0, redo: 0 };
function undoRedo(which: "undo" | "redo") {
  // Pressed while a design tab opens, it was meant for the design being left: carried out, it took a step out of that
  // design or the one coming (tabs hunt A1, A2), so it is ignored.
  if (tabs?.switching()) return;
  if (pressesWaiting === 0 && !ctx.history.busy()) return undoRedoNow(which);
  pressesWaiting++;
  waitingOn[which]++;
  showUndoRedo();
  // What it waits for may end with nothing recorded (an OK refused, a question cancelled or still open: the history's
  // `callOff`). The press was for that, so it is dropped: carried out, it took back the step before (#622). So is a
  // press whose project was replaced meanwhile (another tab, Open, New): it was for that project (tabs hunt A2).
  const calledOff = ctx.history.callsOff();
  const owner = fileOwner;
  pressed = pressed
    .then(() => ctx.history.whenIdle())
    .then(() => {
      pressesWaiting--;
      waitingOn[which]--;
      if (ctx.history.callsOff() === calledOff && fileOwner === owner) undoRedoNow(which);
      showUndoRedo();
    });
}
/**
 * The tool whose panel is open in a pane on screen (issue #520, as Fusion's): Undo cancels just it, taking back no older
 * step (it recorded nothing before its OK); Redo and History's jumps wait until it closes, so nothing typed is lost.
 */
function openTool(): { name: string; cancel(): void } | null {
  for (const p of panesInUse()) {
    const tool = pool.awake(p)?.view.openTool?.() ?? null;
    if (tool) return tool;
  }
  return null;
}
function undoRedoNow(which: "undo" | "redo") {
  const tool = openTool();
  if (tool) {
    if (which === "undo") tool.cancel();
    return showUndoRedo();
  }
  try {
    ctx.history[which]();
  } catch (e) {
    return fileStatus(`Couldn't ${which}: ${e instanceof Error ? e.message : String(e)}`);
  }
  ctx.history.amend(); // defaults the remounted workspaces filled in
}
function showUndoRedo() {
  // An OK still with the kernel (held) is the tool finishing: Undo and Redo wait for it and then act on the project.
  const tool = ctx.history.busy() ? null : openTool();
  const buttons = [
    ["undo", "Undo", ctx.history.undoLabel(), "Mod+Z"],
    ["redo", "Redo", ctx.history.redoLabel(), "Mod+Shift+Z"],
  ] as const;
  for (const [id, verb, label, chord] of buttons) {
    const b = $<HTMLButtonElement>(id);
    // Pressed while an OK is still being worked out, it waits for it (History.whenIdle) and says so: lit and pulsing
    // (styles/undo-redo.css), its title saying why, until the press has been carried out.
    const waiting = waitingOn[id] > 0;
    b.toggleAttribute("aria-busy", waiting);
    if (waiting) b.setAttribute("aria-busy", "true");
    // What it says of the project's own steps, tool or none: the browser checks read it to see that nothing was recorded.
    b.dataset.projectStep = label === null ? `Nothing to ${id}` : `${verb} ${label} (${chordLabel(chord, mac)})`;
    if (tool && !waiting) {
      // A tool open: Undo cancels it alone, Redo waits until it closes (issue #520).
      b.disabled = id === "redo";
      b.title = id === "undo" ? `Undo: cancel ${tool.name} (${chordLabel(chord, mac)})` : `Redo waits until ${tool.name} is closed (OK or Cancel)`;
      continue;
    }
    // From the moment an OK is pressed (held work, `history.hold`) Undo would take it back once it lands, so it says so and
    // takes a press (SL #708 item 3: it stayed grey, or named the step before, until the kernel answered, and a press was lost).
    const ahead = id === "undo" && ctx.history.busy();
    b.disabled = label === null && !waiting && !ahead;
    b.title = waiting || ahead ? `${verb} waits for the change still being worked out${id === "undo" ? ", then takes it back" : ""}` : label === null ? `Nothing to ${id}` : `${verb} ${label} (${chordLabel(chord, mac)})`;
  }
}
// At phone width the pair leaves the bar for the main viewport's
// bottom-right corner, across from the View buttons (step 20c): one tap, by
// the thumb, beside the part it changes; the bar keeps its room for the
// workspace button. Wider screens keep it on the bar after Save, as Fusion.
const phone = matchMedia("(max-width: 640px)");
function placeUndoRedo() {
  const pair = $("undo-redo");
  pair.classList.toggle("docked", phone.matches);
  // Before the View buttons in the page: its top is higher, so keyboard focus still moves down the screen.
  if (phone.matches) $("view-controls").before(pair);
  else $("save").after(pair);
}
phone.addEventListener("change", placeUndoRedo);
placeUndoRedo();
// An open sheet lifts the docked pair above its top edge, so a size mistyped in it can be undone (SL #623 item 6).
liftOverSheets(document, $("undo-redo"), phone);
for (const id of ["undo", "redo"] as const) $(id).append(iconSvg(document, id)); // named by aria-label
$("undo").addEventListener("click", () => undoRedo("undo"));
$("redo").addEventListener("click", () => undoRedo("redo"));
ctx.history.onChange(showUndoRedo);
refreshUndoRedo = showUndoRedo;
ctx.history.onBusy(showUndoRedo);
showUndoRedo();
// The open project's name in the top bar's empty middle (UI audit 2026-11-12, Ben's choice A), renamed in place: a
// rename is an undo step and is stored like any edit, and the design tabs follow it. Shown again after every change to
// the history (an undo, another project opened). Phones leave it out (@fission/ui styles/project-name.css).
const nameBox = projectNameBox(document, {
  name: () => ctx.project.name,
  rename: (name) => {
    ctx.project.name = name;
    projectChanged("Rename project");
  },
  maxLength: MAX_PROJECT_NAME,
});
$("workspaces").after(nameBox.element);
ctx.history.onChange(nameBox.refresh);
// History: every step kept, to go back (or forward) to any of them at once. Waits for an OK the kernel still checks
// like Undo and Redo do, so it goes back from the finished step.
function jumpHistory(step: number) {
  const now = () => {
    const tool = openTool();
    // Going back would close the tool and lose what is typed in it (issue #520): it waits until the tool closes.
    if (tool) return fileStatus(`Finish or cancel ${tool.name} first (OK or Cancel), then go back in History.`);
    const target = ctx.history.steps()[step];
    try {
      // Refused while a sketch is open, for a step from before it (its own steps only, issue #520).
      if (ctx.history.jumpTo(step) === null && target !== undefined && target.state !== "current") return fileStatus("While a sketch is open, History goes back only through the sketch's own steps: Finish Sketch first.");
    } catch (e) {
      return fileStatus(`Couldn't go back: ${e instanceof Error ? e.message : String(e)}`);
    }
    ctx.history.amend(); // defaults the remounted workspaces filled in
  };
  if (tabs?.switching()) return; // meant for the design being left, as Undo (tabs hunt A1)
  if (pressesWaiting === 0 && !ctx.history.busy()) return now();
  pressesWaiting++;
  showUndoRedo();
  const owner = fileOwner;
  pressed = pressed
    .then(() => ctx.history.whenIdle())
    .then(() => {
      pressesWaiting--;
      if (fileOwner === owner) now(); // not in a project that replaced it meanwhile (tabs hunt A2)
      showUndoRedo();
    });
}
const historyUi = historyPanel(document, { steps: () => ctx.history.steps(), jump: jumpHistory, now: () => Date.now(), isPhone: () => phone.matches });
$("redo").after(historyUi.button);
document.body.append(historyUi.panel);
ctx.history.onChange(historyUi.refresh);
// AI, Guide and Community, small at the bar's right (styles/app-bar.css).
withIcon($("assistant-toggle"), "ai", 16);
withIcon($("guide-open"), "guide", 16);
withIcon($("community"), "community", 16);
withIcon($("settings-open"), "settings", 16);
/** The panel opened last of Files, Properties and the AI panel: the one sheet kept when the window narrows to a phone's. */
let lastSheet: "browser" | "properties" | "assistant" | null = null;
// One assistant panel for every workspace, beside the viewport.
const setAssistant = (open: boolean) => {
  const panel = $("assistant");
  if (!!panel.hidden !== open) return;
  if (open) lastSheet = "assistant";
  panel.hidden = !open;
  $("assistant-toggle").setAttribute("aria-pressed", String(open));
  document.body.classList.toggle("assistant-narrow", open); // styles/assistant-narrow.css
  if (open) assistant.opened();
};
$("assistant-toggle").addEventListener("click", () => {
  const open = !!$("assistant").hidden;
  // At phone width the panel is a sheet over the view like the other two (styles/phone-sheet.css): one at a time.
  if (open && window.matchMedia("(max-width: 640px)").matches) for (const slot of ["browser", "properties"]) $(`${slot}-toggle`).dispatchEvent(new CustomEvent("sheet-close"));
  setAssistant(open);
});
// At phone width the browser and properties fold away behind two toggles
// (theme.css hides a closed one there); wider screens hide the toggles and
// show both panels. The state lives on #workspace, so it survives switching.
for (const slot of ["browser", "properties"] as const) {
  const toggle = $(`${slot}-toggle`);
  const set = (open: boolean) => {
    if (open && toggle.getAttribute("aria-expanded") !== "true") lastSheet = slot;
    const was = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(open));
    $("workspace").dataset[slot] = open ? "open" : "closed";
    // The workspace in the slot hears its sheet open and shut (Body facts goes out when the sheet it opened shuts).
    if (was !== open) $(slot).dispatchEvent(new CustomEvent(`${slot}-sheet`, { detail: { open } }));
  };
  set(toggle.getAttribute("aria-expanded") === "true");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    // At phone width each opens as a sheet over the view (styles/phone-sheet.css): one at a time.
    if (open) for (const other of ["browser", "properties"] as const) if (other !== slot) $(`${other}-toggle`).dispatchEvent(new CustomEvent("sheet-close"));
    if (open && window.matchMedia("(max-width: 640px)").matches) setAssistant(false);
    set(open);
  });
  toggle.addEventListener("sheet-close", () => set(false));
}
// Narrowed to a phone's width, the panels open beside the view become sheets over it, and only one may be open (clumsy-user
// hunt 2026-11-04: Properties opened on a phone, the window widened, the AI panel opened, narrowed again: both sheets open,
// one over the other). The one opened last stays.
phone.addEventListener("change", () => {
  if (!phone.matches) return;
  for (const slot of ["browser", "properties"] as const) if (slot !== lastSheet) $(`${slot}-toggle`).dispatchEvent(new CustomEvent("sheet-close"));
  if (lastSheet !== "assistant") setAssistant(false);
});
// At phone width what a tool asks for lives in the Properties sheet, so the sheet opens when it appears
// (Edit feature, Move's boxes once a body is picked, Combine's once its bodies are: without the sheet open they are out of reach; not the plane prompt or
// Extrude's box: the bar over the view, phone-float.ts, holds the planes, Finish and Cancel) and closes again, if it opened it, when
// that is done, leaving the view clear to draw in; as the folded panel opens for a tool's box on a wide screen.
{
  const toggle = $("properties-toggle");
  const phone = window.matchMedia("(max-width: 640px)");
  let wanted = false;
  let opened = false;
  let shows = ""; // the Combine panel's count of times it was shown: one more means a Combine started again, even over an open one (#586)
  // `turned`: the screen just became phone width (a sketch started sideways, then the phone turned upright), so a prompt already up is shown.
  const update = (turned: boolean) => {
    const props = $("properties"); // a workspace's mount replaces the slot, so it is looked up each time
    const now = props.querySelector<HTMLElement>("#feature-edit:not([hidden])") !== null || props.querySelector("#move-panel:not([hidden]) #move-bodies:not([hidden])") !== null ||
      // Combine's operation and OK once its target and a tool are picked (or an edited Combine's), its hint over the view gone (35f1d).
      (props.querySelector("#combine-panel:not([hidden])") !== null && document.querySelector("#combine-hint[hidden]") !== null);
    const again = props.querySelector<HTMLElement>("#combine-panel:not([hidden])")?.dataset.shows ?? "";
    const restarted = now && again !== "" && again !== shows;
    shows = again;
    if (now === wanted && !(turned && now) && !restarted) return;
    wanted = now;
    const open = toggle.getAttribute("aria-expanded") === "true";
    if (now && phone.matches && !open) {
      toggle.click();
      opened = true;
      // The panel's first box took the keys while the sheet was still closed (nothing hidden is focused): give them again.
      const give = () => $("properties").querySelector<HTMLElement>("#feature-edit:not([hidden]) input")?.focus();
      give();
      // WebKit and Firefox lay the sheet out a frame later, and the row menu that chose Edit feature gives the focus back to
      // its opener (in the sheet just put away) as it closes, which WebKit can leave on the opener rather than the page:
      // try again until the focus is inside the panel (a tap on one of its boxes puts it there for good).
      for (const ms of [0, 50, 100, 200, 300, 500, 800]) setTimeout(() => !$("properties").querySelector("#feature-edit:not([hidden])")?.contains(document.activeElement) && give(), ms);
    } else if (!now && opened && open) {
      toggle.click();
      opened = false;
    } else if (!now) opened = false;
  };
  phone.addEventListener("change", () => phone.matches && update(true));
  new MutationObserver(() => update(false)).observe($("workspace"), { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "data-shows"] });
}
// At phone width the bar over the view (phone-float.ts) ends the tool in use; a tool ending puts the Properties sheet away.
startPhoneFloat($("workspace"), $("viewport"), () => {
  if (window.matchMedia("(max-width: 640px)").matches) $("properties-toggle").dispatchEvent(new CustomEvent("sheet-close"));
});
// Body facts (Inspect ▾) shows the numbers in the Properties sheet, which at phone width stays shut unless asked (demo rehearsal 10-28).
// It says in the event's detail (Design's FactsReveal) whether this is a phone and whether the sheet opened for it, and pressed
// again it asks for the sheet it opened to shut (button toggles, Ben 2026-11-11).
$("workspace").addEventListener("properties-reveal", (e) => {
  const toggle = $("properties-toggle");
  const asked = e instanceof CustomEvent && typeof e.detail === "object" && e.detail !== null ? (e.detail as { opened?: boolean; phone?: boolean }) : null;
  const phone = window.matchMedia("(max-width: 640px)").matches;
  if (asked) asked.phone = phone;
  if (phone && toggle.getAttribute("aria-expanded") !== "true") {
    toggle.click();
    if (asked) asked.opened = true;
  }
});
$("workspace").addEventListener("properties-conceal", () => {
  if (window.matchMedia("(max-width: 640px)").matches) $("properties-toggle").dispatchEvent(new CustomEvent("sheet-close"));
});
// A press in the view outside a sheet puts the sheet away (a tap on the part beside it is the way out; the toggles still work).
{
  const phone = window.matchMedia("(max-width: 640px)");
  $("workspace").addEventListener("pointerdown", (e) => {
    if (!phone.matches || !(e.target instanceof Element) || !e.target.closest("#viewport") || e.target.closest("#phone-float") || e.target.closest("#undo-redo")) return; // the bar over the view ends a tool, which puts the sheet away itself; Undo and Redo leave it open, so the size is seen going back
    for (const slot of ["browser", "properties"]) {
      const toggle = $(`${slot}-toggle`);
      if (toggle.getAttribute("aria-expanded") === "true") toggle.click();
    }
    setAssistant(false);
  });
}
// Dragging a sheet down by its handle puts it away too (src/sheet-drag.ts).
sheetDrag(document, window.matchMedia("(max-width: 640px)"), (sheet) => {
  if (sheet.id === "assistant") setAssistant(false);
  else $(`${sheet.id}-toggle`).dispatchEvent(new CustomEvent("sheet-close"));
});
const pages: string[] = [...workspaces.map((w) => w.id), "community"];
const fromHash = (): Page => {
  const id = location.hash.slice(1);
  return pages.includes(id) ? (id as Page) : "design";
};
// Links (and back/forward) can name a workspace: #design, #slice, …
window.addEventListener("hashchange", () => show(fromHash()));
// Start on the project saved most recently in this browser, or a new one.
// One that can't be read is left stored as it is, and a new project starts
// with a message saying so; so does one the last visit started opening and
// never finished (it froze or crashed the tab), once: the visit after tries
// it again. A browser that can't keep projects at all still gets a working
// app (Save and Open use files). Never a blank app: storage that doesn't
// answer within STORAGE_ANSWER_MS is taken as failing (blind spots B2b: an
// IndexedDB that never answered left the app blank for good).
async function start() {
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const answered = <T>(asked: Promise<T>) =>
    Promise.race([asked, new Promise<never>((_, refuse) => setTimeout(() => refuse(new Error("browser storage didn't answer")), STORAGE_ANSWER_MS))]);
  let newest: string | undefined;
  let newestAt: Date | null = null;
  try {
    // Changes the last visit left with before they were stored go back first, so the project reopens with them.
    const unsaved = await answered(recoverUnsaved(store, local, workspaces, undefined, (id) => leftWithChange.add(id)));
    if (unsaved.length > 0) fileStatus(`${unsaved.join(". ")}.`.replace(/^./, (c) => c.toUpperCase()));
    const top = (await answered(store.list()))[0];
    newest = top?.id;
    newestAt = top && !top.problem ? top.modified : null; // a summary that can't be read gives no save time to expect
  } catch (e) {
    canKeep = false;
    // Said for as long as it is so: the words below go with the next message (#627 item 4).
    saveStatus({ state: "error", message: "nothing is kept in this browser. Use Save to keep your work as a file." });
    fileStatus(`Projects can't be kept in this browser (${why(e)}). Use Save to keep your work as a file.`);
    show(fromHash());
    return ctx.history.reset();
  }
  let opened: string | undefined;
  try {
    if (newest && (await guard.check(newest))) {
      keepOnFirstChange();
      fileStatus("The last project didn't finish opening on your last visit, so a new one was started. The old one is still kept in this browser: reload the page now, before changing anything, to try it again.");
    } else if (newest) {
      guard.opening(newest);
      // Its newest state, when the store had no room for it (storage full): kept in the journal, and what the user
      // last saw, so it is what opens and what Save writes (real-use hunt B1). Its autosave stores it once it can.
      const kept = keptEntry(local, newest);
      ctx.project = kept === null ? await answered(store.open(newest)) : projectFromJson(kept, workspaces);
      keep(newest, kept === null, newestAt, kept !== null);
      saveStatus(kept === null ? { state: "saved" } : { state: "error", message: "this browser's storage had no room for your latest changes. They're kept until it has, and Save keeps them as a file." });
      opened = newest;
    } else keep(newId());
  } catch (e) {
    guard.finished(); // refused with a message, which is not a freeze
    keepOnFirstChange(); // stored only once changed, so a reload tries the old one again (real-use hunt A1)
    fileStatus(`Couldn't open the last project (${why(e)}), so a new one was started. The old one is still kept in this browser.`);
  }
  show(fromHash());
  // Counted as reopened once it has shown: a tab that freezes building it leaves the mark.
  if (opened) whileOpening(OPENING_LAST, () => guard.shown(opened));
  ctx.history.reset(); // the project as it opened is the start
}
// Save, Open, a drop and a paste wait for this: until the last project is
// open, ctx.project is the empty one the app starts with.
const started = start();
if (tabs) void started.then(() => tabs.restore());
if (home) void started.then(() => home.show());
appLoaded(started.then(shownOnScreen), ctx.kernel); // index.html's skeleton goes once the project is shown and the kernel has answered
ctx.kernel.call("kernel_version").then((v) => {
  $("version").textContent = `kernel v${v}`;
  $("version").parentElement!.title = `SpindleLabs, kernel v${v}`; // where the version shows when the bar has no room for it
}, () => {}); // a kernel that didn't start says so where the part would be (Design's error line), not as an uncaught error

// Offline mode: the service worker keeps this build for use with no connection, and offers a new one when it ships.
startOffline();
