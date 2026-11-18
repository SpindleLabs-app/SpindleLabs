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
// Run (T5b) checks the set-up against the design as it is now, then has the
// kernel test the body Design builds now (core's `withBody`): the faces and
// the handle come from one rebuild, so a face index is the kernel's own. A
// progress line and Cancel show while it works; the answer is checked
// (run.ts `answerProblem`) before it is drawn, bent and coloured in the view
// with the numbers in the panel (results.ts), and a curved part or any other
// refusal is said in the kernel's words. Results stay in memory: a set-up
// change takes them away, a design edit marks them out of date.
// Styles: src/styles/testlab-page.css, src/styles/testlab-results.css, src/styles/testlab-view-hint.css.

import type { AnalysisOverlay, FaceReference, ListedObject, MountedWorkspace, OverlaySeverity, ViewportPick, WorkspaceContext } from "@fission/core";
import { KernelError, KERNEL_TEST_STOPPED, materialLibrary } from "@fission/core";
import { GEOMETRY_OWNER, studyNow, studyOn, type StudyNow } from "./faces.ts";
import { materialWords, sourceLines, testMaterials } from "./materials.ts";
import { RESULT_OVERLAY, resultColours, resultOf, resultOverlay, resultSection, type ColourBy, type Result } from "./results.ts";
import { answerProblem, STAGE_WORDS, stressTestOf } from "./run.ts";
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
  setMaterial,
  studyFaces,
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

/** What the panel says after Cancel. */
export const STOPPED = "Stopped: nothing was worked out.";

/** What the progress line says before the kernel's first stage. */
export const GETTING_READY = "Getting the part ready…";

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

/**
 * The short hint over the view while faces are picked (T5c5: on a phone the
 * Properties sheet is put away while picking, so its words can't be seen),
 * or null when nothing is being picked. Pure.
 */
export function pickHint(picking: Picking, study: Study | null): string | null {
  if (picking === null || study === null) return null;
  if (picking.kind === "held") return "Tap the faces to hold. Tap a held face to let it go.";
  const i = study.loads.findIndex((l) => l.id === picking.load);
  return i < 0 ? null : `Tap the faces Load ${i + 1} pushes. Tap a pushed face to let it go.`;
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
  /** Whether Run checked the study, as it is now, against the design on screen since this mount (a remount starts not run: nothing is saved). */
  let ran = false;
  /** A Run under way: what the progress line says. */
  let running: { stage: string; cancelled: boolean } | null = null;
  /** The last Run's result for the study as set up now, in memory only; null when there is none. */
  let result: Result | null = null;
  let colourBy: ColourBy = "stress";

  const data = (): TestLabData => {
    try {
      return readTestLab(ctx.project.workspaces.simulate);
    } catch {
      return emptyTestLab(); // the shell's readData refuses such a file when it opens, so this is never one on screen
    }
  };
  const store = (next: TestLabData, label: string) => {
    ctx.project.workspaces.simulate = next;
    ran = false; // the set-up changed, so what Run checked is not this one
    result = null; // and its result was for another set-up
    ctx.projectChanged(label);
  };
  const study = (): Study | null => data().studies[0] ?? null;

  // The picking hint over the view (T5c5), as Design's Measure has.
  const viewHint = doc.createElement("p");
  viewHint.id = "testlab-view-hint"; // read by the e2e test
  viewHint.className = "testlab-view-hint";
  viewHint.hidden = true;
  viewHint.setAttribute("role", "status");
  ctx.viewport.element.append(viewHint);
  const showViewHint = () => {
    const words = awake ? pickHint(picking, study()) : null;
    viewHint.hidden = words === null;
    viewHint.textContent = words ?? "";
    // On a phone the overlays' legend ("Held here") sits where the hint's pill would (theme.css, 112 px down), so the
    // hint goes just under it, however many lines it has; on a wide screen the hint is above it.
    const legend = ctx.viewport.element.querySelector<HTMLElement>(".overlay-legend");
    const phone = doc.defaultView?.matchMedia?.("(max-width: 640px)").matches ?? false;
    const under = words !== null && phone && legend !== null && !legend.hidden && legend.offsetHeight > 0;
    viewHint.style.top = under ? `${legend.offsetTop + legend.offsetHeight + 8}px` : "";
  };

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
        result = null; // faces are picked on the part as it is, not bent
        // A phone puts its Properties sheet away so the body can be tapped (main.ts). The page's own window's Event, so a
        // test's stand-in page takes it too (a Node Event threw there, skipping the redraw below).
        const PageEvent = (doc.defaultView as (Window & typeof globalThis) | null)?.Event ?? Event;
        panel.dispatchEvent(new PageEvent("properties-conceal", { bubbles: true }));
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

  /** What the part is made of: one choice from the materials library, with the numbers TestLab will use and where each came from. */
  const materialSection = (s: Study) => {
    const box = el("section", "testlab-page-material");
    box.append(el("h3", undefined, "Made of"));
    const choice = el("select");
    choice.name = "material";
    choice.setAttribute("aria-label", "Material");
    if (s.material === null) choice.append(option("Choose a material", "", true));
    const materials = testMaterials();
    for (const m of materials) choice.append(option(m.name, m.id, m.id === s.material));
    choice.value = s.material ?? ""; // said again once the options are in: a DOM may keep an older choice's index otherwise
    choice.addEventListener("change", () => {
      const m = materials.find((x) => x.id === choice.value);
      if (!m) return;
      store(setMaterial(data(), s.id, m.id), `Make it of ${m.name}`);
      draw();
    });
    box.append(choice);
    const m = materials.find((x) => x.id === s.material)?.mechanical;
    if (m) {
      box.append(el("p", "testlab-page-words", materialWords(m)));
      for (const n of m.notes) box.append(el("p", "testlab-page-words", n));
      const sources = el("details", "testlab-page-sources");
      sources.append(el("summary", undefined, "Where these numbers come from"));
      for (const line of sourceLines(m)) sources.append(el("p", undefined, line));
      box.append(sources);
    }
    return box;
  };

  /** Draws the panel, the list and the view from the data and the last look-up. */
  const draw = () => {
    const s = study();
    panel.replaceChildren();
    panel.append(el("h2", undefined, s === null ? "TestLab" : `${s.name}: static stress`));
    if (s === null || s.body === null) {
      panel.append(el("p", "testlab-page-words", "Pick a body to test from the list."));
    } else {
      panel.append(el("p", "testlab-page-body", `Testing ${s.body.label} from Design.`), materialSection(s));
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
    run.disabled = s === null || s.body === null || running !== null;
    panel.append(words, stateLine);
    if (running) {
      progress.textContent = running.stage;
      panel.append(
        progress,
        button("Cancel", "cancel", () => {
          if (!running) return;
          running.cancelled = true;
          ctx.kernel.stopTesting?.(); // the kernel let go if the test is under way; else it is never sent
        }),
      );
    } else panel.append(run);
    if (result && s !== null) panel.append(resultSection(doc, result, colourBy, stateLine.dataset.stale === "true", (by) => ((colourBy = by), draw())));
    else panel.append(el("p", "testlab-page-note", "A simulation: real prints are weaker across their layers."));
    drawBodies();
    paint();
    showViewHint(); // after the overlays: on a phone it goes under their legend
  };

  /** The progress line while a Run works. */
  const progress = el("p", "testlab-page-progress");
  progress.setAttribute("role", "status");

  /** Whether the study is out of date with the design (the graph's mark), redrawn alone when the graph changes so typing is never cut off. */
  const stateLine = el("p", "testlab-page-state");
  const staleNow = () => {
    const s = study();
    return s !== null && ctx.graph.has(studyNode(s.id)) && ctx.graph.isStale(studyNode(s.id));
  };
  const drawState = () => {
    const stale = staleNow();
    if (stale) ran = false;
    stateLine.textContent = stale ? "Out of date: the design changed since this study was last run. Run it again." : ran ? "Up to date with the design." : "Not run yet.";
    const shown = panel.querySelector<HTMLElement>(".testlab-results");
    if (shown && shown.dataset.stale !== String(stale)) void show(false); // looked up again and drawn: the result's heading says it is out of date, and the view shows the body now
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

  /** What the view shows: the result, bent and coloured; else the body as it is (`now`). */
  let viewShows: Result | StudyNow | null = null;
  const paint = () => {
    if (!awake) return;
    for (const id of shownOverlays) ctx.viewport.clearOverlay(id);
    shownOverlays = [];
    const s = study();
    // An out-of-date result stays in the panel, marked; the view shows the body as the design makes it now.
    if (result && s !== null && picking === null && !staleNow()) {
      if (viewShows !== result) ctx.viewport.showBody(result.mesh);
      viewShows = result;
      ctx.viewport.showColourMap?.(resultColours(result, colourBy));
      ctx.viewport.setOverlay(resultOverlay(result));
      shownOverlays.push(RESULT_OVERLAY);
      return;
    }
    if (s === null || now === null) return;
    if (viewShows !== now) ctx.viewport.showBody(now.faces.mesh);
    viewShows = now;
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
      if (awake && (result === null || picking !== null || staleNow())) {
        ctx.viewport.showBody(got.faces.mesh);
        viewShows = got;
        if (frame || framedBody !== s.body?.ref.id) ctx.viewport.fit();
        framedBody = s.body?.ref.id ?? null;
      }
    }
    if (awake) ctx.viewport.onPick = onPick;
    draw();
  };

  /**
   * Run (T5b): the set-up checked against the design now, then tested by the kernel on the body Design builds now,
   * with a progress line and Cancel. The answer is checked before it is shown; a refusal is said in words. A Run whose
   * set-up changed while it worked (an edit here) shows nothing: its answer was for the set-up before.
   */
  const runStudy = async () => {
    if (running) return;
    await show(false);
    const s = study();
    if (!live || s === null || s.body === null) return;
    const problems = refused !== null ? [refused] : readyProblems(s, now?.lost ?? []);
    if (problems.length > 0) {
      note = "Not run: fix what is said below first.";
      draw();
      return;
    }
    const material = materialLibrary().get(s.material!);
    const mechanical = material?.mechanical;
    if (!material || !mechanical) return; // readyProblems asks for a material; the library's materials all have numbers
    const asked = JSON.stringify(s);
    picking = null;
    result = null;
    note = "";
    const run = (running = { stage: GETTING_READY, cancelled: false });
    const stopListening = ctx.kernel.onTestProgress?.((stage) => {
      if (!running) return;
      running.stage = STAGE_WORDS[stage];
      progress.textContent = running.stage;
    });
    draw();
    let said: string;
    let got: Result | null = null;
    try {
      const out = await ctx.representations.withBody(GEOMETRY_OWNER, ctx.project, s.body.ref, studyFaces(s).map((f) => f.ref), async (lent) => {
        const on = studyOn(s, lent.faces);
        const left = readyProblems(s, on.lost);
        if (left.length > 0) return { refused: left.join(" ") };
        const test = stressTestOf(s, on, mechanical);
        if ("refused" in test) return test;
        if (run.cancelled) return { stopped: true as const };
        return { answer: await ctx.kernel.call("stress_test", lent.handle, test) };
      });
      if (run.cancelled || "stopped" in out) said = STOPPED;
      else if ("refused" in out) said = `Not run: ${out.refused}`;
      else {
        const wrong = answerProblem(out.answer);
        if (wrong !== null) said = wrong;
        else {
          got = resultOf(out.answer, { name: material.name, mechanical });
          said = "";
        }
      }
    } catch (e) {
      said = run.cancelled || (e instanceof KernelError && e.message === KERNEL_TEST_STOPPED) ? STOPPED : `Not run: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      stopListening?.();
      running = null;
    }
    if (!live) return;
    const same = study();
    if (same === null || JSON.stringify(same) !== asked) {
      note = "The set-up changed while it ran, so that run's answer is not shown: press Run again.";
      draw();
      return;
    }
    note = said;
    if (got) {
      result = got;
      if (ctx.graph.has(studyNode(same.id))) ctx.graph.markFresh(studyNode(same.id));
      ran = true;
    }
    draw();
    // The answer is below the set-up: brought into the panel's view (not in every DOM).
    if (got) ctx.properties.querySelector<HTMLElement>(".testlab-results")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
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
      showViewHint();
      ctx.viewport.onPick = null;
      for (const id of shownOverlays) ctx.viewport.clearOverlay(id);
      shownOverlays = [];
      ctx.viewport.showColourMap?.(null);
      viewShows = null; // the next workspace draws its own body
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
        ctx.viewport.showColourMap?.(null);
      }
      list.remove();
      panel.remove();
      viewHint.remove();
    },
  };
}
