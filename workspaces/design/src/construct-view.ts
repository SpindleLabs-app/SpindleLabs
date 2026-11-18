// Construct ▾ on the page (step 59a2): the panel (construct-panel.ts), the
// view's clicks while it is open, the kernel's answer for what is picked
// (asked as the picks and the number change, drawn as the preview before OK)
// and the recording. A slot is filled by a click on a flat face, an edge or
// a corner of a body shown (the name it keeps and the kernel's pick, made
// at once), or by its list: the origin's planes, axes and point, and the
// constructions made earlier. The row pressed, else the first empty one, is
// the one the next click fills. A rebuild lets the picks on bodies go (the
// bodies may have changed); the origin's and earlier constructions' stay.
// The workspace makes one and hands it the view's picks.

import { kernelFailure, type BodyHandle, type ConstructGiven, type ConstructMade, type ConstructMake, type ViewportPick } from "@fission/core";
import { CONSTRUCT_KINDS, cornerRef, type ConstructAnswer, type ConstructKind } from "./construct-data.ts";
import { constructPanel, type ConstructPanel } from "./construct-panel.ts";
import { answerWords, choiceLabel, choicesFor, constructHint, KIND_GROUPS, NO_NAME, readNumber, slotLegend, slotRole, targetRefusal, type Target } from "./construct-tool.ts";
import { CONSTRUCT_STEP, insertConstruct } from "./construct.ts";
import { constructOf, type DesignDocument } from "./document.ts";
import { sceneHit, shownReference, type Scene } from "./scene.ts";
import { sceneCorners } from "./measure-view.ts";
import { givenOf, ORIGIN_GIVEN } from "./rebuild.ts";
import type { Checked } from "./cut-ask.ts";

export interface ConstructDeps {
  /** Where the panel goes: the properties. */
  slot: HTMLElement;
  /** Where the hint over the view goes (the view itself). */
  over: HTMLElement;
  doc(): DesignDocument;
  /** The scene on screen (null before the first build). */
  scene(): Scene | null;
  /** A shown body's handle in the kernel's store, by its place in the scene. */
  handle(body: number): BodyHandle | null;
  /** The held design-wide names of edges (chamfer-tool.ts `heldNamesOf`): null for an edge with no name of its own. */
  heldNames(edges: readonly { body: string; edge: number }[]): Promise<(string | null)[]>;
  /** The kernel's `body_construct`. */
  ask(make: ConstructMake): Promise<ConstructMade>;
  /** The design with the item built on the kernel, as an OK checks it. */
  check(next: DesignDocument, id: string): Promise<Checked>;
  /** Records the design as one undo step. */
  record(step: string, next: DesignDocument): void;
  /** Notes a kernel check as an OK's (`okCheck`) and holds Undo while it runs (`holdAsked`). */
  okCheck<T>(work: Promise<T>): Promise<T>;
  hold<T>(work: Promise<T>): Promise<T>;
  /** The preview's answer for the workspace to draw (null: none). */
  preview(answer: ConstructAnswer | null): void;
  /** Offers these corners to the view to pick (Viewport.showCorners), null for none. */
  offerCorners(corners: readonly (readonly [number, number, number])[] | null): void;
  /** Called after the panel opens or closes. */
  changed(): void;
}

/** What fills a slot: the name the item keeps, the kernel's version of it now, and its words. */
interface Filled {
  ref: string;
  given: ConstructGiven;
  words: string;
  /** Picked on a body (lost at a rebuild), else chosen from the list. */
  onBody: boolean;
}

export interface ConstructView {
  /** Opens (or changes the open panel to) `kind`. */
  open(kind: ConstructKind): void;
  close(): void;
  readonly shown: boolean;
  /** A click on the view while open. */
  pick(pick: ViewportPick): void;
  /** A new build on screen: the picks on bodies go. */
  rebuilt(): void;
  /** The unit changed: the preview's words in it. */
  dispose(): void;
  /** For tests. */
  readonly filled: Readonly<Record<string, string>>;
  readonly settled: Promise<void>;
}

const WHAT = { face: "Face", edge: "Edge", vertex: "Corner" } as const;

/** The view's hint on a phone-width or touch screen says "tap". */
const touchScreen = (el: HTMLElement) => el.ownerDocument.defaultView?.matchMedia?.("(pointer: coarse)").matches === true;

export function constructView(d: ConstructDeps): ConstructView {
  let kind: ConstructKind = "offset_plane";
  let filled: Record<string, Filled> = {};
  let active = "";
  let asked = 0;
  let settled: Promise<void> = Promise.resolve();
  let answer: { key: string; made: ConstructAnswer } | null = null;
  const panel: ConstructPanel = constructPanel(d.slot, {
    kind(k) {
      kind = k;
      filled = {};
      active = slots()[0] ?? "";
      refresh();
    },
    activate(slot) {
      active = slot;
      refresh(false);
    },
    choose(slot, ref) {
      if (ref === "") delete filled[slot];
      else {
        const given = ref.startsWith("construct:") ? givenOfItem(ref.slice("construct:".length)) : ORIGIN_GIVEN[ref];
        const label = choiceLabel(choicesFor(d.doc(), slotRole(kind, slot)), ref);
        if (given === undefined || label === null) return;
        filled[slot] = { ref, given, words: label, onBody: false };
        active = nextEmpty(slot);
      }
      if (ref === "") active = slot;
      refresh();
    },
    changed() {
      panel.showError("");
      ask();
    },
    ok: () => void d.hold(finish()),
    cancel: () => view.close(),
  });
  const hint = d.over.ownerDocument.createElement("p");
  hint.id = "construct-hint"; // read by the e2e test
  hint.className = "move-panel-hint";
  hint.setAttribute("role", "status");
  hint.hidden = true;
  d.over.append(hint);

  const slots = (): string[] => [...CONSTRUCT_KINDS[kind].slots];
  const nextEmpty = (after = ""): string => {
    const all = slots();
    const from = all.indexOf(after);
    const order = [...all.slice(from + 1), ...all.slice(0, from + 1)];
    return order.find((s) => filled[s] === undefined) ?? "";
  };
  /** An earlier construction's answer as the kernel takes it, from the design's own copy. */
  function givenOfItem(id: string): ConstructGiven | undefined {
    const f = d.doc().timeline.features.find((x) => x.id === id);
    return f === undefined ? undefined : givenOf(constructOf(f).answer);
  }
  const complete = () => slots().every((s) => filled[s] !== undefined);

  /** The rows, the hint, the corners offered and the answer for what is picked now. */
  function refresh(askAgain = true) {
    const doc = d.doc();
    panel.setRows(slots().map((slot) => {
      const role = slotRole(kind, slot);
      const f = filled[slot];
      return { slot, legend: slotLegend(kind, slot), words: f?.words ?? null, choices: choicesFor(doc, role), chosen: f !== undefined && !f.onBody ? f.ref : "", active: slot === active };
    }));
    panel.setReady(false);
    const role = active === "" ? null : slotRole(kind, active);
    const bodies = d.scene()?.bodies.length ?? 0;
    hint.textContent = constructHint(kind, active === "" ? null : active, bodies, touchScreen(hint));
    hint.hidden = !panel.shown;
    const corners = role === "point" ? sceneCorners(d.scene()) : [];
    d.offerCorners(corners.length > 0 ? corners.map((c) => c.at) : null);
    if (askAgain) ask();
  }

  /** The kernel's `ConstructMake` for the picks and the number now, or why not yet (null: not all picked). */
  function makeNow(): { make: ConstructMake; number: number | undefined } | { why: string } | null {
    if (!complete()) return null;
    const read = readNumber(kind, panel.typed);
    if ("why" in read) return { why: read.why };
    const make: Record<string, unknown> = { kind };
    for (const slot of slots()) make[slot] = filled[slot].given;
    const need = CONSTRUCT_KINDS[kind] as { number?: "distance" | "angle" };
    if ("value" in read && need.number !== undefined) make[need.number] = read.value;
    return { make: make as unknown as ConstructMake, number: "value" in read ? read.value : undefined };
  }
  /** Asks the kernel for the answer now (the newest ask only) and draws it as the preview. */
  function ask() {
    const run = ++asked;
    answer = null;
    d.preview(null);
    panel.showPreview("");
    panel.setReady(false);
    const made = makeNow();
    if (made === null) return;
    if ("why" in made) return void panel.showPreview(made.why, true);
    const key = JSON.stringify(made.make);
    settled = d
      .ask(made.make)
      .then((a) => {
        if (run !== asked || !panel.shown) return;
        answer = { key, made: a as ConstructAnswer };
        panel.showPreview(answerWords(a as ConstructAnswer));
        panel.setReady(true);
        d.preview(a as ConstructAnswer);
      })
      .catch((e: unknown) => {
        if (run !== asked || !panel.shown) return;
        panel.showPreview(kernelFailure(e).message, true);
      });
  }

  /** What a click in the view picked, as a slot's filling, or why it doesn't fit. */
  async function target(p: ViewportPick, role: ReturnType<typeof slotRole>): Promise<Filled | string | null> {
    const scene = d.scene();
    if (scene === null) return null;
    const place = (body: number) => `Body ${scene.bodies[body]?.place ?? body + 1}`;
    if (p.vertex !== undefined) {
      const c = sceneCorners(scene)[p.vertex];
      if (c === undefined) return null;
      const why = targetRefusal(role, { kind: "corner" });
      if (why !== null) return why;
      const body = scene.bodies[c.body];
      const handle = d.handle(c.body);
      if (handle === null) return null;
      const edges = body.view.edge_vertices.flatMap((ends, e) => (ends.includes(c.index) ? [e] : []));
      const names = await d.heldNames(edges.map((edge) => ({ body: body.body, edge })));
      if (edges.length === 0 || names.some((n) => n === null)) return NO_NAME;
      return { ref: cornerRef(names as string[]), given: { pick: { body: handle, vertex: c.index } }, words: `${WHAT.vertex} of ${place(c.body)}`, onBody: true };
    }
    const edge = p.edge ?? null;
    const hit = edge !== null ? sceneHit(scene, "edge", edge) : p.face !== null ? sceneHit(scene, "face", p.face) : null;
    if (hit === null) return null;
    const body = scene.bodies[hit.body];
    const handle = d.handle(hit.body);
    if (handle === null) return null;
    if (edge !== null) {
      const t: Target = { kind: "edge", straight: body.view.edge_types[hit.index] === "line" };
      const why = targetRefusal(role, t);
      if (why !== null) return why;
      const [name] = await d.heldNames([{ body: body.body, edge: hit.index }]);
      if (name === null || name === undefined) return NO_NAME;
      return { ref: name, given: { pick: { body: handle, edge: hit.index } }, words: `${WHAT.edge} of ${place(hit.body)}`, onBody: true };
    }
    const why = targetRefusal(role, { kind: "face", flat: body.view.face_types[hit.index] === "plane" });
    if (why !== null) return why;
    const ref = shownReference(scene, hit.body, "face", hit.index);
    if (ref === null || !String(ref.id).startsWith("face:")) return NO_NAME;
    return { ref: String(ref.id), given: { pick: { body: handle, face: hit.index } }, words: `${WHAT.face} of ${place(hit.body)}`, onBody: true };
  }

  async function finish() {
    if (!panel.shown || !panel.ready) return;
    const opened = openings;
    const made = makeNow();
    if (made === null) return;
    if ("why" in made) return panel.showError(made.why);
    const before = d.doc();
    panel.busy(true);
    let refused: string | null = null;
    let next: DesignDocument | null = null;
    let record: DesignDocument | null = null;
    try {
      const key = JSON.stringify(made.make);
      // The answer asked for just these picks, else asked again now.
      const got = answer !== null && answer.key === key ? answer.made : ((await d.okCheck(d.ask(made.make))) as ConstructAnswer);
      if (openings !== opened) return;
      const inputs = Object.fromEntries(slots().map((s) => [s, filled[s].ref]));
      const inserted = insertConstruct(before, kind, inputs, made.number, got);
      next = inserted.doc;
      const checked = await d.okCheck(d.check(next, inserted.id));
      refused = checked.refused;
      record = checked.numbered ?? next;
    } catch (e) {
      refused = kernelFailure(e).message;
    }
    if (openings !== opened) return;
    panel.busy(false);
    if (d.doc() !== before) return panel.showError("The design changed while the kernel checked this: press OK again.");
    if (refused !== null || record === null) return panel.showError(refused ?? "The construction could not be made.");
    view.close();
    d.record(CONSTRUCT_STEP, record);
  }

  /** Each opening and closing counted: an OK whose check lands after it changed is out of date. */
  let openings = 0;
  const view: ConstructView = {
    open(k) {
      openings++;
      kind = k;
      filled = {};
      answer = null;
      panel.show(k);
      active = slots()[0] ?? "";
      refresh();
      d.changed();
    },
    close() {
      if (!panel.shown) return;
      openings++;
      asked++;
      panel.hide();
      filled = {};
      answer = null;
      hint.hidden = true;
      d.offerCorners(null);
      d.preview(null);
      d.changed();
    },
    get shown() {
      return panel.shown;
    },
    pick(p) {
      if (!panel.shown) return;
      const slot = active !== "" ? active : slots()[slots().length - 1];
      const at = openings;
      const was = asked;
      void target(p, slotRole(kind, slot)).then((got) => {
        if (got === null || openings !== at || asked !== was) return; // empty space keeps what is picked
        if (typeof got === "string") return void panel.showError(got);
        panel.showError("");
        filled[slot] = got;
        active = nextEmpty(slot);
        refresh();
      });
    },
    rebuilt() {
      if (!panel.shown) return;
      for (const s of Object.keys(filled)) if (filled[s].onBody) delete filled[s]; // the bodies they were on may have changed
      if (active === "" || filled[active] !== undefined) active = nextEmpty();
      refresh();
    },
    dispose() {
      hint.remove();
    },
    get filled() {
      return Object.fromEntries(Object.entries(filled).map(([k, v]) => [k, v.ref]));
    },
    get settled() {
      return settled;
    },
  };
  return view;
}

/** The kinds the panel can open, for a test. */
export const OPENABLE: readonly ConstructKind[] = KIND_GROUPS.flatMap((g) => g.kinds);
