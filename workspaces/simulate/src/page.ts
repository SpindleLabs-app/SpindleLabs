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
// Styles: src/styles/testlab-page.css, src/styles/testlab-results.css, src/styles/testlab-view-hint.css, src/styles/testlab-join.css.

import type { AnalysisOverlay, FaceReference, LentBody, ListedObject, MountedWorkspace, OverlaySeverity, StressTest, ViewportPick, WorkspaceContext } from "@fission/core";
import { KernelError, KERNEL_TEST_STOPPED, materialLibrary, NO_HIGHLIGHT } from "@fission/core";
import { GEOMETRY_OWNER, studyNow, studyOn, type StudyNow } from "./faces.ts";
import { joinedNow, joinGroup, joinWords, listWords, withJoined, type JoinGroup } from "./join.ts";
import { materialWords, sourceLines, testMaterials } from "./materials.ts";
import { resultColours, resultOf, resultOverlays, resultSection, setUpOf, type ColourBy, type FaceButtons, type Result } from "./results.ts";
import { answerProblem, STAGE_WORDS, stressTestOf } from "./run.ts";
import { fileFaces, keptProject, type RunRecord } from "./test-file.ts";
import {
  addLoad,
  addStudy,
  chooseBody,
  joinBodies,
  unjoin,
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
  type JoinedBody,
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

/** How long a face shown from the results card stays lit, in ms. */
export const FACE_FLASH_MS = 2000;

/**
 * Why a face the results card names can't be shown in the view now, in words, or null when it can: one an edit took away
 * or gave its name to more than one face, or the part not shown. Pure.
 */
export function faceWhyNot(now: StudyNow | null, face: HeldFace): string | null {
  if (now === null) return `${face.label} can't be shown: the part isn't shown now.`;
  const at = now.found.get(face.ref.id);
  if (at === undefined) return `${face.label} isn't in the set-up now: run again to show it.`;
  if (at.status === "shared") return `${face.label} matches ${at.count} faces after the last edit, so it isn't shown on any of them.`;
  if (at.status !== "found") return `${face.label} isn't on the part after the last edit: ${at.why}.`;
  return null;
}

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
  /** The light on a face shown from the results card: its timer, until it goes out. */
  let flash: ReturnType<typeof setTimeout> | null = null;
  const flashOff = () => {
    if (flash === null) return;
    clearTimeout(flash);
    flash = null;
    ctx.viewport.showSelection(NO_HIGHLIGHT);
  };
  /** The bodies the study tests now (join.ts), from the last look-up; its body alone when it joins nothing. */
  let group: JoinGroup = { bodies: [], missing: [] };
  /** The body each face of the view is on (by place in `group`), when bodies are joined. */
  let owners: number[] | null = null;
  /** The Join chooser while open: whether All is ticked and the bodies ticked (by stable id). */
  let choosing: { all: boolean; ids: Set<string> } | null = null;
  /** The last check that the joined bodies make one part, for the design, bodies and faces it was made with (`key`). */
  let joinCheck: { key: string; done: boolean; problems: string[]; notes: string[] } | null = null;

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

  /** A phone puts its Properties sheet away so the body can be tapped (main.ts). The page's own window's Event, so a
   * test's stand-in page takes it too (a Node Event threw there, skipping the redraw after it). */
  const conceal = () => {
    const PageEvent = (doc.defaultView as (Window & typeof globalThis) | null)?.Event ?? Event;
    panel.dispatchEvent(new PageEvent("properties-conceal", { bubbles: true }));
  };

  /**
   * The results card's face names (Ben, 19 Nov): a tap turns the view square onto that face, framed round it (the shared
   * viewport's lookAtFace, gliding there), and lights it for FACE_FLASH_MS; a phone's Properties sheet goes away so the
   * face can be seen. A face the design no longer has says why instead (faceWhyNot).
   */
  const faceButtons: FaceButtons = {
    whyNot: (f) => faceWhyNot(now, f),
    show: (f) => {
      const at = now?.found.get(f.ref.id);
      if (!awake || at?.status !== "found") return;
      conceal();
      if (flash !== null) clearTimeout(flash);
      ctx.viewport.showSelection({ body: false, faces: [at.face], edges: [] });
      if (!ctx.viewport.lookAtFace?.(at.face)) ctx.viewport.fitSelection();
      flash = setTimeout(() => {
        flash = null;
        if (awake) ctx.viewport.showSelection(NO_HIGHLIGHT);
      }, FACE_FLASH_MS);
    },
  };

  const pickButton = (on: boolean, text: string, data: string, set: () => void) => {
    const b = button(on ? "Done picking" : text, data, () => {
      if (on) picking = null;
      else {
        set();
        result = null; // faces are picked on the part as it is, not bent
        conceal();
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
      panel.append(el("p", "testlab-page-body", group.bodies.length > 1 ? joinWords(group, s.joined === "all") : `Testing ${s.body.label} from Design.`), materialSection(s));
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
          conceal(); // and its faces are tapped next, so a phone's sheet goes as for Pick faces
          store(r.data, "Add load");
          draw();
        }),
      );
      panel.append(held, loads);
    }
    const words = el("div", "testlab-page-status");
    words.setAttribute("role", "status");
    const problems = s === null ? [] : refused !== null ? [refused] : readyProblems(s, [...group.missing, ...joinProblems(s), ...(now?.lost ?? [])]);
    // What happened on its own line, then each thing to fix on a line of its own below it (SL #820 D-6); the spaces
    // between keep the words apart for a screen reader and for anything reading the whole status.
    const joinNotes = s !== null && joinCheck !== null && joinCheck.key === joinKey(s) ? joinCheck.notes : [];
    const first = [note, picking ? "Tap faces of the body to pick them; tap a picked face to let it go." : "", ...joinNotes].filter((x) => x !== "").join(" ");
    if (first !== "") words.append(el("p", undefined, first));
    if (problems.length > 0) {
      if (first !== "") words.append(" ");
      const list = el("ul", "testlab-page-problems");
      problems.forEach((p, i) => list.append(...(i > 0 ? [" "] : []), el("li", undefined, p)));
      words.append(list);
    }
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
    if (result && s !== null) panel.append(resultSection(doc, result, colourBy, stateLine.dataset.stale === "true", (by) => ((colourBy = by), draw()), faceButtons));
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
  /** The bodies Design shows now that a study can test (each with its stable reference). */
  const testable = (): JoinedBody[] => listed.flatMap((o) => (o.ref ? [{ ref: o.ref, label: o.label }] : []));

  /** Stable ids of the study's picked faces found on a body outside `keep` now (taken off when the join changes). */
  const facesOff = (s: Study, keep: ReadonlySet<string>): { ids: Set<string>; words: string[] } => {
    const ids = new Set<string>();
    const words: string[] = [];
    if (now === null) return { ids, words };
    for (const f of studyFaces(s)) {
      const at = now.found.get(f.ref.id);
      if (at?.status !== "found") continue;
      const body = owners === null ? s.body : group.bodies[owners[at.face]];
      if (body && !keep.has(body.ref.id)) {
        ids.add(f.ref.id);
        words.push(f.label);
      }
    }
    return { ids, words };
  };
  const offWords = (words: readonly string[]) => (words.length === 0 ? "" : `Took ${listWords(words)} off: ${words.length === 1 ? "it is" : "they are"} on a body no longer tested.`);

  /** The Join chooser's OK: the bodies ticked (in the order Design lists them, the study's own body first) joined for the test. */
  const finishJoin = () => {
    const s = study();
    if (!choosing || s === null || s.body === null) return;
    const all = choosing.all;
    const ticked = testable().filter((b) => all || choosing!.ids.has(b.ref.id));
    const own = ticked.findIndex((b) => b.ref.id === s.body!.ref.id);
    const bodies = own > 0 ? [ticked[own], ...ticked.slice(0, own), ...ticked.slice(own + 1)] : ticked;
    if (!all && bodies.length < 2) return; // the button is off then
    const off = facesOff(s, new Set(bodies.map((b) => b.ref.id)));
    choosing = null;
    picking = null;
    note = offWords(off.words);
    store(joinBodies(data(), s.id, bodies, all, off.ids), all ? "Join all bodies for the test" : `Join ${listWords(bodies.map((b) => b.label))} for the test`);
    void show(true);
  };

  /** The join taken away: the study's own body tested alone, picks on the other bodies taken off. */
  const finishUnjoin = (keep: JoinedBody) => {
    const s = study();
    if (s === null) return;
    const off = facesOff(s, new Set([keep.ref.id]));
    choosing = null;
    picking = null;
    note = offWords(off.words);
    store(unjoin(data(), s.id, keep, off.ids), `Test ${keep.label} alone`);
    void show(true);
  };

  const joinBox = el("div", "testlab-join");
  list.append(joinBox);
  /** Join (Ben, 2026-11-19): several bodies tested as one part, joined only for the test; the chooser, or what is joined now. */
  const drawJoin = (s: Study | null) => {
    joinBox.replaceChildren();
    const can = testable();
    joinBox.hidden = s === null || s.body === null || (can.length < 2 && !s.joined);
    if (joinBox.hidden || s === null) return;
    if (choosing === null) {
      if (s.joined) {
        joinBox.append(
          el("p", "testlab-page-words", group.bodies.length > 1 ? joinWords(group, s.joined === "all") : `${s.body!.label} is the only body to join now.`),
          button("Change join", "join-change", () => {
            choosing = { all: s.joined === "all", ids: new Set(group.bodies.map((b) => b.ref.id)) };
            draw();
          }),
          button("Unjoin", "unjoin", () => finishUnjoin(group.bodies[0] ?? s.body!)),
        );
      } else {
        const b = button("Join bodies…", "join", () => {
          choosing = { all: false, ids: new Set([s.body!.ref.id]) };
          draw();
        });
        b.title = "Test several bodies as one part. Only for the test: the design isn't changed.";
        joinBox.append(b);
      }
      return;
    }
    const pick = choosing;
    const box = el("fieldset", "testlab-join-pick");
    box.append(el("legend", undefined, "Join for this test"));
    const tick = (text: string, name: string, value: string, on: boolean, off: boolean, change: (on: boolean) => void) => {
      const label = el("label");
      const c = el("input");
      c.type = "checkbox";
      c.name = name;
      c.value = value;
      c.checked = on;
      c.disabled = off;
      c.addEventListener("change", () => change(c.checked));
      label.append(c, ` ${text}`);
      return label;
    };
    box.append(tick(`All bodies (${can.length}), and any made later`, "join-all", "all", pick.all, false, (on) => ((pick.all = on), draw())));
    for (const b of can)
      box.append(
        tick(b.label, "join-body", b.ref.id, pick.all || pick.ids.has(b.ref.id), pick.all, (on) => {
          if (on) pick.ids.add(b.ref.id);
          else pick.ids.delete(b.ref.id);
          draw();
        }),
      );
    box.append(el("p", "testlab-page-words", "Joined only while testing: the design keeps its bodies as they are. Bodies must touch or overlap to make one part."));
    const ok = button("Join", "join-ok", finishJoin);
    ok.disabled = !pick.all && can.filter((b) => pick.ids.has(b.ref.id)).length < 2;
    const cancel = button("Cancel", "join-cancel", () => {
      choosing = null;
      draw();
    });
    box.append(ok, cancel);
    joinBox.append(box);
  };

  const drawBodies = () => {
    const s = study();
    bodies.replaceChildren();
    if (listed.length === 0) bodies.append(el("li", "testlab-page-none", "Nothing to test yet: make a body in Design and it appears here."));
    const joined = new Set(group.bodies.length > 1 ? group.bodies.map((b) => b.ref.id) : []);
    for (const o of listed) {
      const li = el("li");
      const label = el("label");
      const radio = el("input");
      radio.type = "radio";
      radio.name = "testlab-body";
      radio.disabled = o.ref === undefined;
      radio.checked = joined.size === 0 && s?.body?.ref.id === o.ref?.id;
      radio.addEventListener("change", () => {
        if (!o.ref) return;
        const body = { ref: o.ref, label: o.label };
        // A body already in the join is kept with its picks; any other starts a fresh set-up, as before.
        if (joined.has(o.ref.id)) return finishUnjoin(body);
        const d = data();
        const first = d.studies[0];
        picking = null;
        choosing = null;
        store(first ? chooseBody(d, first.id, body) : addStudy(d, body).data, `Test ${o.label}`);
        void show(true);
      });
      label.append(radio, ` ${o.label}`);
      li.append(label);
      if (o.ref !== undefined && joined.has(o.ref.id)) {
        li.dataset.joined = "true";
        li.append(el("span", "testlab-join-tag", " joined"));
      }
      bodies.append(li);
    }
    drawJoin(s);
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
      for (const o of resultOverlays(result)) {
        ctx.viewport.setOverlay(o);
        shownOverlays.push(o.id);
      }
      return;
    }
    if (s === null || now === null) return;
    if (viewShows !== now) ctx.viewport.showBody(now.faces.mesh);
    viewShows = now;
    for (const o of studyOverlays(s, now)) {
      if (o.marks.length === 0) continue; // a tag over the body with nothing held or pushed there misleads (SL #820 D-6)
      ctx.viewport.setOverlay(o);
      shownOverlays.push(o.id);
    }
  };

  /** What a join check depends on: the design as saved, the bodies tested and the faces picked. */
  const joinKey = (s: Study) => JSON.stringify([ctx.project.workspaces.design ?? null, group.bodies.map((b) => b.ref.id), s.fixtures, s.loads]);
  /** What the last join check found wrong for the study as it is now (bodies apart, a face swallowed by the join), else nothing. */
  const joinProblems = (s: Study): string[] => (group.bodies.length > 1 && joinCheck !== null && joinCheck.done && joinCheck.key === joinKey(s) ? joinCheck.problems : []);
  /**
   * Checks once per design, bodies and picks that the joined bodies make one part and where each picked face goes on
   * it (join.ts `withJoined`, nothing tested), so "they don't touch" or a face lost inside the join is said while
   * setting up, before Run. Run checks again on the part it tests.
   */
  const checkJoin = (s: Study) => {
    if (group.bodies.length < 2) return;
    const key = joinKey(s);
    if (joinCheck?.key === key) return;
    const mine: { key: string; done: boolean; problems: string[]; notes: string[] } = { key, done: false, problems: [], notes: [] };
    joinCheck = mine;
    void withJoined(ctx.representations, ctx.kernel, ctx.project, s, group.bodies, async (_lent, on) => ({ lost: on.lost, notes: on.notes }))
      .then((r) => {
        if ("refused" in r) mine.problems = [r.refused];
        else {
          mine.problems = r.lost;
          mine.notes = r.notes;
        }
      })
      .catch((e: unknown) => (mine.problems = [`The bodies can't be joined now: ${e instanceof Error ? e.message : String(e)}`]))
      .finally(() => {
        mine.done = true;
        if (live && joinCheck === mine) draw();
      });
  };

  /** The study as a graph node reading its body's inputs (those the graph holds). */
  const keepNode = (s: Study, inputs: readonly string[]) => {
    // Setting a node again keeps its out-of-date mark; it stays in the graph after an unmount (an Undo remounts TestLab and
    // must find the mark still there), and a project opened brings a fresh graph.
    ctx.graph.set({ id: studyNode(s.id), label: s.name, workspace: "simulate", cost: "expensive" }, inputs.filter((x) => ctx.graph.has(x)));
  };

  const pickWants = () => "faces" as const;
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
    const g = joinGroup(s, listed);
    const got = g.bodies.length > 1 ? await joinedNow(ctx.representations, ctx.project, s, g.bodies) : await studyNow(ctx.representations, ctx.project, s);
    if (!live || mine !== reading) return;
    group = g;
    owners = g.bodies.length > 1 && !("refused" in got) && "owner" in got ? (got.owner as number[]) : null;
    if ("refused" in got) {
      now = null;
      refused = got.refused;
    } else {
      now = got;
      refused = null;
      keepNode(s, got.faces.inputs);
      const framing = g.bodies.map((b) => b.ref.id).join(" ");
      if (awake && (result === null || picking !== null || staleNow())) {
        ctx.viewport.showBody(got.faces.mesh);
        viewShows = got;
        if (frame || framedBody !== framing) ctx.viewport.fit();
        framedBody = framing;
      }
      checkJoin(s);
    }
    if (awake) {
      ctx.viewport.onPick = onPick;
      ctx.viewport.pickWants = pickWants; // holds and loads go on faces: no edge or corner takes a click on a thin one
    }
    draw();
  };

  /**
   * Run (T5b): the set-up checked against the design now, then tested by the kernel on the body Design builds now,
   * with a progress line and Cancel. The answer is checked before it is shown; a refusal is said in words. A Run whose
   * set-up changed while it worked (an edit here) shows nothing: its answer was for the set-up before.
   */
  /**
   * What the test file keeps of a Run (test-file.ts), gathered on the lent body before the test: the project as saved
   * (design and TestLab only), the kernel's version, the part's exact boundary as STEP and its faces, the test as sent.
   * A STEP the kernel won't write is kept as why not, never stops the Run; a project that can't be saved gives no file.
   */
  const runRecord = async (s: Study, lent: LentBody, sent: StressTest, material: RunRecord["material"]): Promise<RunRecord | null> => {
    let project: unknown;
    try {
      project = keptProject(ctx.project);
    } catch {
      return null;
    }
    const said = (e: unknown) => (e instanceof Error ? e.message : String(e));
    let version: string;
    try {
      version = await ctx.kernel.call("kernel_version");
    } catch (e) {
      version = `unknown (${said(e)})`;
    }
    let step: string | null = null;
    let stepRefused: string | null = null;
    try {
      step = await ctx.kernel.call("body_step", lent.handle);
    } catch (e) {
      stepRefused = said(e);
    }
    return { kernel: { version }, project, studyId: s.id, material, part: { step, stepRefused, faces: fileFaces(lent.faces) }, sent: structuredClone(sent) };
  };

  const runStudy = async () => {
    if (running) return;
    await show(false);
    const s = study();
    if (!live || s === null || s.body === null) return;
    const problems = refused !== null ? [refused] : readyProblems(s, [...group.missing, ...(now?.lost ?? [])]);
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
    const tested = group.bodies.length > 1 ? group.bodies : null;
    try {
      const test = async (lent: LentBody, on: StudyNow) => {
        const left = readyProblems(s, on.lost);
        if (left.length > 0) return { refused: left.join(" ") };
        const test = stressTestOf(s, on, mechanical);
        if ("refused" in test) return test;
        if (run.cancelled) return { stopped: true as const };
        // A joined part's record is the union's: its STEP and faces, which the test's face numbers are on.
        const record = await runRecord(s, lent, test, { id: material.id, name: material.name, mechanical });
        if (run.cancelled) return { stopped: true as const };
        return { answer: await ctx.kernel.call("stress_test", lent.handle, test), strength: test.strength, record };
      };
      const out = tested
        ? await withJoined(ctx.representations, ctx.kernel, ctx.project, s, tested, test)
        : await ctx.representations.withBody(GEOMETRY_OWNER, ctx.project, s.body.ref, studyFaces(s).map((f) => f.ref), (lent) => test(lent, studyOn(s, lent.faces)));
      if (run.cancelled || "stopped" in out) said = STOPPED;
      else if ("refused" in out) said = `Not run: ${out.refused}`;
      else {
        const wrong = answerProblem(out.answer, out.strength);
        if (wrong !== null) said = wrong;
        else {
          const part = tested ? { ...s, body: { ref: s.body.ref, label: `${listWords(tested.map((b) => b.label))}, joined` } } : s;
          got = resultOf(out.answer, { name: material.name, mechanical }, setUpOf(part), out.record);
          said = ""; // a join's notes (faces made one) are said by its check, beside the status, while the set-up stands
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
      flashOff(); // before the next workspace draws its own selection
      awake = false;
      picking = null; // picking ends when TestLab is left; it never waits for a tap on another workspace's view
      showViewHint();
      ctx.viewport.onPick = null;
      ctx.viewport.pickWants = null;
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
      if (awake) flashOff();
      else if (flash !== null) clearTimeout(flash);
      live = false;
      offGraph();
      if (awake) {
        ctx.viewport.onPick = null;
        ctx.viewport.pickWants = null;
        for (const id of shownOverlays) ctx.viewport.clearOverlay(id);
        ctx.viewport.showColourMap?.(null);
      }
      list.remove();
      panel.remove();
      viewHint.remove();
    },
  };
}
