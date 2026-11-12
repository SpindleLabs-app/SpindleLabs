// The TestLab page (step T1, behind `?testlab`, flag.ts): a static stress
// study set up on a Design body with no export. The bodies come from
// Design's lister, their faces and stable names from Design's face finder
// (core's registry, faces.ts), so nothing of Design's geometry is copied
// into the project: TestLab keeps only its choices (study.ts). Each time the
// page shows, the study's faces are looked up again on the body as it is
// now; a hold or load whose face an edit took away says so in words.
//
// The study is a node of the project's dependency graph (expensive: it
// waits for a click), read from every item its body is made from, so a
// design edit marks it out of date with a change note naming the edit.
// Run checks the set-up against the design as it is now and says plainly
// that solving comes with the solver (step T3 to T5): nothing pretends to
// work out a stress yet. Styles: src/styles/testlab-page.css.

import type { AnalysisOverlay, FaceReference, ListedObject, MountedWorkspace, OverlaySeverity, ViewportPick, WorkspaceContext } from "@fission/core";
import { studyNow, type StudyNow } from "./faces.ts";
import {
  addLoad,
  addStudy,
  chooseBody,
  DIRECTION_WORDS,
  DIRECTIONS,
  emptyTestLab,
  loadWords,
  readTestLab,
  readyProblems,
  removeLoad,
  setLoad,
  toggleHeld,
  togglePushed,
  UNIT_WORDS,
  UNITS,
  type Direction,
  type HeldFace,
  type Load,
  type LoadUnit,
  type Study,
  type TestLabData,
} from "./study.ts";

/** Design's lister for bodies (what Slice lists too). */
export const BODIES_LISTER = "design";

/** The words Run says while there is no solver, so nobody takes a check for a result. */
export const NO_SOLVER_YET = "Solving comes with TestLab's solver in a later step: no stress or bend is worked out yet.";

/** The overlay ids the page paints: the held faces, and one per load. */
export const HELD_OVERLAY = "testlab-held";
export const loadOverlay = (loadId: string) => `testlab-${loadId}`;

/** The graph node a study's result is. */
export const studyNode = (studyId: string) => `simulate.${studyId}`;

/** What a tap on a face does now: nothing, hold it, or push it with one load. */
export type Picking = null | { kind: "held"; fixture: string } | { kind: "load"; load: string };

/** The overlays for a study on the body as it is now: its held faces (info) and each load's (warning), only the faces found. Pure. */
export function studyOverlays(study: Study, now: StudyNow): AnalysisOverlay[] {
  const marks = (faces: readonly HeldFace[], severity: OverlaySeverity) =>
    faces.flatMap((f) => {
      const at = now.found.get(f.ref.id);
      return at?.status === "found" ? [{ target: { face: at.face }, severity }] : [];
    });
  const held: AnalysisOverlay = { id: HELD_OVERLAY, label: "Held here", detail: "These faces are held fixed in place.", marks: study.fixtures.flatMap((f) => marks(f.faces, "info")) };
  return [held, ...study.loads.map((l, i): AnalysisOverlay => ({ id: loadOverlay(l.id), label: `Load ${i + 1}`, detail: loadWords(l), marks: marks(l.faces, "warning") }))];
}

/** A tap on face `index` of the body shown: the face as a study holds it, or why it can't be held, in words. Pure. */
export function pickedFace(now: StudyNow, index: number | null): HeldFace | { refused: string } {
  if (index === null) return { refused: "Tap a face of the body." };
  const ref: FaceReference | null | undefined = now.faces.faces[index];
  if (ref === undefined) return { refused: "That is not a face of this body." };
  if (ref === null) return { refused: `${now.faces.labels[index]}: it has no name of its own after the last edit, so a load on it could not follow the design. Pick another face.` };
  return { ref, label: now.faces.labels[index] };
}

/** The page's mounting. */
export function mountTestLabPage(ctx: WorkspaceContext): MountedWorkspace {
  const doc = ctx.toolbar.ownerDocument;
  let live = true;
  let awake = true;
  let reading = 0;
  let now: StudyNow | null = null;
  let refused: string | null = null;
  let picking: Picking = null;
  let note = "";
  let shownOverlays: string[] = [];
  let framedBody: string | null = null;

  const data = (): TestLabData => {
    try {
      return readTestLab(ctx.project.workspaces.simulate);
    } catch {
      return emptyTestLab(); // the shell's readData refuses such a file when it opens, so this is never one on screen
    }
  };
  const store = (next: TestLabData, label: string) => {
    ctx.project.workspaces.simulate = next;
    ctx.projectChanged(label);
  };
  const study = (): Study | null => data().studies[0] ?? null;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // The bodies, in the browser.
  const list = el("section", "testlab-page");
  list.setAttribute("aria-label", "Body to test");
  const bodiesHeading = el("h2", undefined, "Body to test");
  const bodies = el("ul", "testlab-page-bodies");
  list.append(bodiesHeading, bodies);
  ctx.browser.append(list);

  // The study, in the properties.
  const panel = el("section", "testlab-page");
  panel.setAttribute("aria-label", "TestLab study");
  ctx.properties.append(panel);

  const button = (text: string, data: string, run: () => void) => {
    const b = el("button", undefined, text);
    b.type = "button";
    b.dataset.testlab = data;
    b.addEventListener("click", run);
    return b;
  };

  const option = (text: string, value: string, chosen: boolean) => {
    const o = el("option", undefined, text);
    o.value = value;
    o.selected = chosen;
    return o;
  };

  const faceList = (faces: readonly HeldFace[], remove: (f: HeldFace) => void) => {
    const ul = el("ul", "testlab-page-faces");
    if (faces.length === 0) ul.append(el("li", "testlab-page-none", "No face yet."));
    for (const f of faces) {
      const where = now?.found.get(f.ref.id);
      const li = el("li", where?.status === "found" ? undefined : "testlab-page-lost");
      li.append(el("span", undefined, where?.status === "found" ? f.label : `${f.label} (${where?.status === "shared" ? "matches more than one face" : "lost"})`));
      const x = button("✕", "unpick", () => remove(f));
      x.setAttribute("aria-label", `Take ${f.label} off`);
      li.append(x);
      ul.append(li);
    }
    return ul;
  };

  const pickButton = (on: boolean, text: string, data: string, set: () => void) => {
    const b = button(on ? "Done picking" : text, data, () => {
      if (on) picking = null;
      else {
        set();
        panel.dispatchEvent(new Event("properties-conceal", { bubbles: true })); // a phone puts its Properties sheet away so the body can be tapped (main.ts)
      }
      draw();
    });
    b.setAttribute("aria-pressed", String(on));
    return b;
  };

  const loadRow = (s: Study, l: Load, i: number) => {
    const row = el("fieldset", "testlab-page-load");
    row.dataset.load = l.id;
    row.append(el("legend", undefined, `Load ${i + 1}`));
    const amount = el("input");
    amount.type = "number";
    amount.name = "amount";
    amount.min = "0";
    amount.step = "any";
    amount.inputMode = "decimal";
    amount.value = String(l.amount);
    amount.setAttribute("aria-label", `Load ${i + 1} amount`);
    const unit = el("select");
    unit.name = "unit";
    unit.setAttribute("aria-label", `Load ${i + 1} unit`);
    for (const u of UNITS) unit.append(option(UNIT_WORDS[u], u, u === l.unit));
    const direction = el("select");
    direction.name = "direction";
    direction.setAttribute("aria-label", `Load ${i + 1} direction`);
    for (const d of DIRECTIONS) direction.append(option(DIRECTION_WORDS[d], d, d === l.direction));
    direction.disabled = l.unit === "kPa";
    const change = (c: Partial<Pick<Load, "amount" | "unit" | "direction">>) => {
      const r = setLoad(data(), s.id, l.id, c);
      if ("refused" in r) {
        note = r.refused;
        draw();
        return;
      }
      note = "";
      store(r.data, `Change Load ${i + 1}`);
      draw();
    };
    amount.addEventListener("change", () => change({ amount: amount.value.trim() === "" ? NaN : Number(amount.value) }));
    unit.addEventListener("change", () => change({ unit: unit.value as LoadUnit }));
    direction.addEventListener("change", () => change({ direction: direction.value as Direction }));
    const values = el("div", "testlab-page-values");
    values.append(amount, unit, direction);
    const on = picking?.kind === "load" && picking.load === l.id;
    row.append(
      values,
      el("p", "testlab-page-words", loadWords(l)),
      faceList(l.faces, (f) => {
        store(togglePushed(data(), s.id, l.id, f), `Take ${f.label} off Load ${i + 1}`);
        void show(false);
      }),
      pickButton(on, "Pick faces to push", "pick-load", () => (picking = { kind: "load", load: l.id })),
      button("Remove load", "remove-load", () => {
        if (picking?.kind === "load" && picking.load === l.id) picking = null;
        store(removeLoad(data(), s.id, l.id), `Remove Load ${i + 1}`);
        void show(false);
      }),
    );
    return row;
  };

  /** Draws the panel, the list and the view from the data and the last look-up. */
  const draw = () => {
    const s = study();
    panel.replaceChildren();
    panel.append(el("h2", undefined, s === null ? "TestLab" : `${s.name}: static stress`));
    if (s === null || s.body === null) {
      panel.append(el("p", "testlab-page-words", "Pick a body to test from the list."));
    } else {
      panel.append(el("p", "testlab-page-body", `Testing ${s.body.label} from Design.`));
      const fixture = s.fixtures[0];
      const held = el("section", "testlab-page-held");
      held.append(el("h3", undefined, "Held here"));
      if (fixture)
        held.append(
          faceList(fixture.faces, (f) => {
            store(toggleHeld(data(), s.id, fixture.id, f), `Let go of ${f.label}`);
            void show(false);
          }),
          pickButton(picking?.kind === "held", "Pick faces to hold", "pick-held", () => (picking = { kind: "held", fixture: fixture.id })),
        );
      const loads = el("section", "testlab-page-loads");
      loads.append(el("h3", undefined, "Pushed here"), ...s.loads.map((l, i) => loadRow(s, l, i)));
      loads.append(
        button("Add load", "add-load", () => {
          const r = addLoad(data(), s.id);
          picking = { kind: "load", load: r.load.id };
          store(r.data, "Add load");
          draw();
        }),
      );
      panel.append(held, loads);
    }
    const words = el("p", "testlab-page-status");
    words.setAttribute("role", "status");
    const problems = s === null ? [] : refused !== null ? [refused] : readyProblems(s, now?.lost ?? []);
    words.textContent = [note, picking ? "Tap faces of the body to pick them; tap a picked face to let it go." : "", ...problems].filter((x) => x !== "").join(" ");
    drawState();
    const run = button("Run", "run", () => void runStudy());
    run.disabled = s === null || s.body === null;
    panel.append(words, stateLine, run, el("p", "testlab-page-note", "A simulation: real prints are weaker across their layers."));
    drawBodies();
    paint();
  };

  /** Whether the study is out of date with the design (the graph's mark), redrawn alone when the graph changes so typing is never cut off. */
  const stateLine = el("p", "testlab-page-state");
  /** Whether Run checked the study against the design on screen since this mount (a remount starts not run: nothing is saved). */
  let ran = false;
  const drawState = () => {
    const s = study();
    const stale = s !== null && ctx.graph.has(studyNode(s.id)) && ctx.graph.isStale(studyNode(s.id));
    if (stale) ran = false;
    stateLine.textContent = stale ? "Out of date: the design changed since this study was last checked. Run checks it again." : ran ? "Up to date with the design: set up and checked." : "Not run yet.";
    stateLine.dataset.stale = String(stale);
  };

  let listed: ListedObject[] = [];
  const drawBodies = () => {
    const s = study();
    bodies.replaceChildren();
    if (listed.length === 0) bodies.append(el("li", "testlab-page-none", "Nothing to test yet: make a body in Design and it appears here."));
    for (const o of listed) {
      const li = el("li");
      const label = el("label");
      const radio = el("input");
      radio.type = "radio";
      radio.name = "testlab-body";
      radio.disabled = o.ref === undefined;
      radio.checked = s?.body?.ref.id === o.ref?.id;
      radio.addEventListener("change", () => {
        if (!o.ref) return;
        const body = { ref: o.ref, label: o.label };
        const d = data();
        const first = d.studies[0];
        picking = null;
        store(first ? chooseBody(d, first.id, body) : addStudy(d, body).data, `Test ${o.label}`);
        void show(true);
      });
      label.append(radio, ` ${o.label}`);
      li.append(label);
      bodies.append(li);
    }
  };

  const paint = () => {
    if (!awake) return;
    for (const id of shownOverlays) ctx.viewport.clearOverlay(id);
    shownOverlays = [];
    const s = study();
    if (s === null || now === null) return;
    for (const o of studyOverlays(s, now)) {
      ctx.viewport.setOverlay(o);
      shownOverlays.push(o.id);
    }
  };

  /** The study as a graph node reading its body's inputs (those the graph holds). */
  const keepNode = (s: Study, inputs: readonly string[]) => {
    // Setting a node again keeps its out-of-date mark; it stays in the graph after an unmount (an Undo remounts TestLab and
    // must find the mark still there), and a project opened brings a fresh graph.
    ctx.graph.set({ id: studyNode(s.id), label: s.name, workspace: "simulate", cost: "expensive" }, inputs.filter((x) => ctx.graph.has(x)));
  };

  const onPick = (pick: ViewportPick) => {
    const s = study();
    if (!picking || s === null || now === null) return;
    const face = pickedFace(now, pick.face);
    if ("refused" in face) {
      note = face.refused;
      draw();
      return;
    }
    note = "";
    const d = data();
    if (picking.kind === "held") {
      const fixture = s.fixtures.find((f) => f.id === (picking as { fixture: string }).fixture);
      const holding = fixture?.faces.some((f) => f.ref.id === face.ref.id) ?? false;
      store(toggleHeld(d, s.id, picking.fixture, face), holding ? `Let go of ${face.label}` : `Hold ${face.label}`);
    } else {
      const i = s.loads.findIndex((l) => l.id === (picking as { load: string }).load);
      const pushing = s.loads[i]?.faces.some((f) => f.ref.id === face.ref.id) ?? false;
      store(togglePushed(d, s.id, picking.load, face), pushing ? `Take ${face.label} off Load ${i + 1}` : `Push ${face.label} with Load ${i + 1}`);
    }
    void show(false);
  };

  /** Looks the study up on the design now and draws it; `frame` frames the body when it is a new one on screen. */
  const show = async (frame: boolean) => {
    const mine = ++reading;
    listed = ctx.representations.objectsOf(BODIES_LISTER, ctx.project);
    let s = study();
    // Already set up (integration rule): a project whose design has one body tests it without being asked.
    if (s === null && listed.length === 1 && listed[0].ref) {
      store(addStudy(data(), { ref: listed[0].ref, label: listed[0].label }).data, `Test ${listed[0].label}`);
      s = study();
    }
    if (s === null) {
      now = null;
      refused = null;
      draw();
      return;
    }
    const got = await studyNow(ctx.representations, ctx.project, s);
    if (!live || mine !== reading) return;
    if ("refused" in got) {
      now = null;
      refused = got.refused;
    } else {
      now = got;
      refused = null;
      keepNode(s, got.faces.inputs);
      if (awake) {
        ctx.viewport.showBody(got.faces.mesh);
        if (frame || framedBody !== s.body?.ref.id) ctx.viewport.fit();
        framedBody = s.body?.ref.id ?? null;
      }
    }
    if (awake) ctx.viewport.onPick = onPick;
    draw();
  };

  /** Run (T1): the set-up checked against the design now; ready, the study is up to date with it, and says solving is still to come. */
  const runStudy = async () => {
    await show(false);
    const s = study();
    if (!live || s === null) return;
    const problems = refused !== null ? [refused] : readyProblems(s, now?.lost ?? []);
    if (problems.length > 0) {
      note = "Not run: fix what is said below first.";
      draw();
      return;
    }
    if (ctx.graph.has(studyNode(s.id))) ctx.graph.markFresh(studyNode(s.id));
    ran = true;
    note = `Set up and checked against the design as it is now. ${NO_SOLVER_YET}`;
    draw();
  };

  const ready = show(true);
  const offGraph = ctx.graph.onChange(() => {
    if (live) drawState();
  });
  return {
    ready,
    sleep() {
      awake = false;
      picking = null; // picking ends when TestLab is left; it never waits for a tap on another workspace's view
      ctx.viewport.onPick = null;
      for (const id of shownOverlays) ctx.viewport.clearOverlay(id);
      shownOverlays = [];
    },
    wake() {
      awake = true;
      note = ""; // the last action's words (a Run's "checked") were about the design as it was
      void show(false); // the design may have changed while another workspace was on screen
    },
    unmount() {
      live = false;
      offGraph();
      if (awake) {
        ctx.viewport.onPick = null;
        for (const id of shownOverlays) ctx.viewport.clearOverlay(id);
      }
      list.remove();
      panel.remove();
    },
  };
}
