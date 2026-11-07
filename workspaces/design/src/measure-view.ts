// Inspect ▾ Measure on the page (step 35e2l2): the panel (measure-panel.ts),
// the view's clicks while it is open, the kernel's measurement and the line
// it draws. Clicks on the view go to Measure while it is open and select
// nothing; a rebuild lets the picks go (the bodies they were on may have
// changed); a change of unit shows the same numbers again in the new one.
// The workspace makes one and hands it the view's picks.

import { kernelFailure, type AnalysisOverlay, type BodyHandle, type MeasurePick, type Measured, type Unit, type ViewportPick } from "@fission/core";
import { measurePanel, type MeasurePanel } from "./measure-panel.ts";
import { MEASURE_OVERLAY, measureHint, measureOverlay, measureRows, NO_PICKS, pickWords, picked, type MeasurePicks, type MeasureTarget } from "./measure-tool.ts";
import { sceneHit, type Scene } from "./scene.ts";

export interface MeasureDeps {
  /** Where the panel goes: the properties. */
  slot: HTMLElement;
  /** The scene on screen (null before the first build). */
  scene(): Scene | null;
  /** A shown body's handle in the kernel's store, by its place in the scene. */
  handle(body: number): BodyHandle | null;
  measure(first: MeasurePick, second: MeasurePick | null): Promise<Measured>;
  unit(): Unit;
  showOverlay(o: AnalysisOverlay): void;
  clearOverlay(id: string): void;
  /** Called after the panel opens or closes. */
  changed(): void;
  /** Where the short hint over the view goes (the view itself): it says what to click while fewer than two are picked. */
  over: HTMLElement;
  /** A distance has landed: a phone's Properties sheet opens on it (not before, so the view stays clear for the picks). */
  reveal(): void;
}

export interface MeasureView {
  open(): void;
  close(): void;
  readonly shown: boolean;
  /** A click on the view while open. */
  pick(pick: ViewportPick): void;
  /** A new build on screen: the picks go. */
  rebuilt(): void;
  /** The unit changed: the same numbers in the new one. */
  unitChanged(): void;
  /** Takes the hint off the view (the workspace unmounting). */
  dispose(): void;
  /** For tests: the picks and the last answer. */
  readonly picks: MeasurePicks;
  readonly measured: Measured | null;
  /** Settles once the measurement asked for last has landed (or failed). */
  readonly settled: Promise<void>;
}

/** The hint over the view while picking (short, for a phone's narrow view): nothing picked yet, then one. */
export const VIEW_HINTS = ["Measure: click or tap a face, edge or body", "Now click or tap a second thing"] as const;

/** What Measure says when the kernel can't measure a pick. */
export const MEASURE_FAILED = "These can't be measured";

/** The thing a click picks: a face or edge, or with a double-click the whole body under it; null for empty space. */
export function targetOf(pick: ViewportPick, scene: Scene | null): MeasureTarget | null {
  if (!scene) return null;
  const edge = pick.edge ?? null;
  const hit = edge !== null ? sceneHit(scene, "edge", edge) : pick.face !== null ? sceneHit(scene, "face", pick.face) : null;
  if (hit === null) return null;
  if (pick.double) return { body: hit.body, kind: "body" };
  return { body: hit.body, kind: edge !== null ? "edge" : "face", index: hit.index };
}

/** The kernel's pick for a target, or null when its body has no handle. */
function kernelPick(t: MeasureTarget, handle: (b: number) => BodyHandle | null): MeasurePick | null {
  const h = handle(t.body);
  if (h === null) return null;
  if (t.kind === "body") return { body: h };
  return t.kind === "face" ? { body: h, face: t.index } : t.kind === "edge" ? { body: h, edge: t.index } : { body: h, vertex: t.index };
}

export function measureView(d: MeasureDeps): MeasureView {
  let picks: MeasurePicks = NO_PICKS;
  let measured: Measured | null = null;
  let asked = 0;
  let settled: Promise<void> = Promise.resolve();
  const panel: MeasurePanel = measurePanel(d.slot, {
    drop(which) {
      picks = which === "first" ? { first: picks.second, second: null } : { first: picks.first, second: null };
      run();
    },
    close: () => view.close(),
  });
  const hint = d.over.ownerDocument.createElement("p");
  hint.id = "measure-view-hint"; // read by the e2e test
  hint.className = "move-panel-hint";
  hint.hidden = true;
  d.over.append(hint);
  const showHint = () => {
    const n = picks.first === null ? 0 : picks.second === null ? 1 : 2;
    hint.hidden = !panel.shown || n === 2;
    if (n !== 2) hint.textContent = VIEW_HINTS[n];
  };
  const name = (t: MeasureTarget | null) => {
    const b = t === null ? undefined : d.scene()?.bodies[t.body];
    return b ? `Body ${b.place}` : "";
  };
  function show() {
    const unit = d.unit();
    const words = (t: MeasureTarget | null, f: Measured["first"] | undefined) => (t === null ? null : f ? pickWords(f, name(t)) : name(t));
    panel.setPicks(words(picks.first, measured?.first), words(picks.second, measured?.second), measureHint(picks));
    panel.setRows(measured ? measureRows(measured, unit) : []);
    showHint();
    const o = measureOverlay(measured, unit);
    // The picked faces tinted too, so what was measured shows on the part.
    const scene = d.scene();
    const faces = [picks.first, picks.second].flatMap((t) => (t && t.kind === "face" && scene ? [{ target: { face: scene.faceStart[t.body] + t.index }, severity: "info" as const }] : []));
    if (o || faces.length > 0) d.showOverlay({ ...(o ?? { id: MEASURE_OVERLAY, label: "Measure", places: [] }), marks: faces });
    else d.clearOverlay(MEASURE_OVERLAY);
  }
  function run() {
    const run = ++asked;
    measured = null;
    panel.showError("");
    show();
    const first = picks.first && kernelPick(picks.first, d.handle);
    const second = picks.second && kernelPick(picks.second, d.handle);
    if (!first) return;
    settled = d
      .measure(first, second ?? null)
      .then((m) => {
        if (run !== asked) return;
        measured = m;
        show();
        if (m.distance) d.reveal();
      })
      .catch((e: unknown) => {
        if (run !== asked) return;
        panel.showError(`${MEASURE_FAILED}: ${kernelFailure(e).message}`);
      });
  }
  const view: MeasureView = {
    open() {
      picks = NO_PICKS;
      measured = null;
      panel.show();
      run();
      d.changed();
    },
    close() {
      if (!panel.shown) return;
      asked++;
      picks = NO_PICKS;
      measured = null;
      panel.hide();
      showHint();
      d.clearOverlay(MEASURE_OVERLAY);
      d.changed();
    },
    get shown() {
      return panel.shown;
    },
    pick(p) {
      const t = targetOf(p, d.scene());
      if (t === null) return; // empty space keeps what is picked
      picks = picked(picks, t);
      run();
    },
    rebuilt() {
      if (!panel.shown) return;
      picks = NO_PICKS;
      run();
    },
    unitChanged() {
      if (panel.shown) show();
    },
    dispose() {
      hint.remove();
    },
    get picks() {
      return picks;
    },
    get measured() {
      return measured;
    },
    get settled() {
      return settled;
    },
  };
  return view;
}
