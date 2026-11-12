// The flat view (Laser's 2D sheet view): the bed seen straight from above,
// drawn as an outlined sheet at true scale with a ruler along two sides, and
// every part on it as its own outline with its name. Laser cutting is flat,
// so there is nothing to turn: the view only slides and zooms (view-box.ts).
//
// It is an SVG drawing laid over the shared viewport's empty 2D view (the
// page asks the viewport for that, so the body, the 3D grid and the view
// cube are away while Laser shows, and Design's camera comes back as it
// was). SVG keeps every outline sharp at any zoom, and the parts are drawn
// from the same path data the saved SVG file gets (sheet.ts `outlinePath`,
// core's writer), so what is on screen is what is cut: no second drawing of
// the arcs worked out here.
//
// The 3D view's row of buttons (Orbit, Top, Front, Right…) is hidden while
// this view is up (by the style sheet: it is a later sibling of this view), and a row of its own, in the same look, takes its place:
// Zoom out, Zoom in, Fit. Dragging slides the view (one finger on a touch
// screen), the wheel or a pinch zooms about the pointer, and with the
// keyboard: + and − zoom, 0 fits, the arrows slide.
//
// Styles: src/styles/laser-flat.css.

import { mmWords, type Bed, type OutlineBox } from "./sheet.ts";
import { fitView, marginsClearOf, marginsFor, marksBetween, markStep, nameFits, panBy, toBed, toScreen, wheelZoom, ZOOM_STEP, zoomAt, type Card, type ScreenPoint, type Size, type View } from "./view-box.ts";

/** A part as the view draws it: its path data in bed mm with y flipped (as the SVG file's), and its box on the bed (y up). */
export interface FlatPart {
  id: string;
  label: string;
  d: string;
  box: OutlineBox;
}

/** What the view shows: the bed, the parts on it, and words for the middle of an empty bed (one line each). */
export interface FlatScene {
  bed: Bed;
  parts: readonly FlatPart[];
  note?: readonly string[];
}

export interface FlatView {
  /** The view's own element (class `laser-flat`), in the page while attached. */
  readonly element: HTMLElement;
  /** Puts the view over `host` (the shared viewport's element) and hides the 3D view's buttons there. */
  attach(host: HTMLElement): void;
  /** Takes the view off the page and gives the host back as it was; the zoom is kept for the next attach. */
  detach(): void;
  /** Draws `scene`; `frame` fits the whole bed in the view first. */
  show(scene: FlatScene, frame: boolean): void;
  /** Fits the whole bed in the view. */
  fit(): void;
  /** The camera now (tests, the browser check). */
  view(): View;
}

const SVG = "http://www.w3.org/2000/svg";

/** 18 px line icons on a 24-unit grid, in the button's text colour (the 3D row's own style). */
const ICONS: Record<string, string> = {
  "zoom-out": '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21M7 10h6"/>',
  "zoom-in": '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21M7 10h6M10 7v6"/>',
  fit: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><rect x="8" y="8" width="8" height="8"/>',
};

const BUTTONS: readonly [string, string, string][] = [
  ["zoom-out", "Zoom out", "Zoom out: see more of the bed (scroll the wheel towards you any time)"],
  ["zoom-in", "Zoom in", "Zoom in: look closer (scroll the wheel away from you, or pinch, any time)"],
  ["fit", "Fit", "Fit: show the whole bed"],
];

/** The size used before the page has laid the view out (and in tests without a layout). */
const UNSIZED: Size = { width: 0, height: 0 };
/** How far an arrow key slides the view, px. */
const KEY_SLIDE = 48;
/** The room the row of buttons takes at the bottom, px: the ruler's numbers stay above it. */
const BAR_ROOM = 64;

/** What the page tells the view about its surroundings. */
export interface FlatViewOptions {
  /** The view's size in px (tests pass their own; left out, the element is measured). */
  size?: () => Size;
  /** The app's cards that may lie over the view (the parts list): the fitted bed keeps clear of them. */
  cards?: () => readonly Element[];
}

/** Makes the view. */
export function createFlatView(doc: Document, options: FlatViewOptions = {}): FlatView {
  const sizeOf = options.size;
  const element = doc.createElement("div");
  element.className = "laser-flat";
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "laser-flat-sheet");
  svg.setAttribute("role", "img");
  svg.setAttribute("tabindex", "0");
  const world = svg.appendChild(doc.createElementNS(SVG, "g"));
  world.setAttribute("class", "laser-flat-world");
  const bedRect = world.appendChild(doc.createElementNS(SVG, "rect"));
  bedRect.setAttribute("class", "laser-flat-bed");
  const grid = world.appendChild(doc.createElementNS(SVG, "path"));
  grid.setAttribute("class", "laser-flat-grid");
  const partsGroup = world.appendChild(doc.createElementNS(SVG, "g"));
  partsGroup.setAttribute("class", "laser-flat-parts");
  const marks = svg.appendChild(doc.createElementNS(SVG, "g"));
  marks.setAttribute("class", "laser-flat-marks");
  marks.setAttribute("aria-hidden", "true");
  element.append(svg);

  const bar = doc.createElement("div");
  bar.className = "view-controls laser-flat-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "View");
  const group = bar.appendChild(doc.createElement("span"));
  group.className = "nav-group";
  for (const [id, label, title] of BUTTONS) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "nav-button";
    b.title = title;
    b.setAttribute("aria-label", label);
    b.dataset.view = id;
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;
    b.addEventListener("click", () => {
      if (id === "fit") return fit();
      const size = measure();
      move(zoomAt(view, scene.bed, size, { x: size.width / 2, y: size.height / 2 }, id === "zoom-in" ? ZOOM_STEP : 1 / ZOOM_STEP));
    });
    group.append(b);
  }
  element.append(bar);

  let scene: FlatScene = { bed: { width: 1, height: 1 }, parts: [] };
  /** The page has said what the bed is. Until then nothing is drawn: the view never shows a bed of its own making. */
  let shown = false;
  let view: View = { cx: 0, cy: 0, scale: 1 };
  /** The view is as Fit left it: a change of the view's size fits again, where a view the person moved stays put. */
  let fitted = true;
  let host: HTMLElement | null = null;
  let hostLabel: string | null = null;
  let watch: ResizeObserver | null = null;
  let switched: MutationObserver | null = null;

  const measure = (): Size => {
    const size = sizeOf ? sizeOf() : { width: element.clientWidth, height: element.clientHeight };
    return size.width > 0 && size.height > 0 ? size : UNSIZED;
  };
  /** The app's window, whose width decides the phone layout (the app's own break is on the window, not on this view). */
  const windowSize = (size: Size): Size => {
    const w = doc.defaultView;
    return w && w.innerWidth > 0 ? { width: w.innerWidth, height: w.innerHeight } : size;
  };

  const text = (cls: string, words: string, at: ScreenPoint, anchor: "start" | "middle" | "end" = "start") => {
    const t = doc.createElementNS(SVG, "text");
    t.setAttribute("class", cls);
    t.setAttribute("x", at.x.toFixed(1));
    t.setAttribute("y", at.y.toFixed(1));
    if (anchor !== "start") t.setAttribute("text-anchor", anchor);
    t.textContent = words;
    return t;
  };

  /** Draws the camera's part: where the sheet sits, the ruler for this zoom, and the names. */
  const draw = () => {
    if (!shown) return;
    const size = measure();
    const { bed } = scene;
    const s = view.scale;
    // The sheet's own coordinates are the SVG file's: x in mm, y flipped. toScreen as one matrix.
    world.setAttribute("transform", `matrix(${s} 0 0 ${s} ${size.width / 2 - view.cx * s} ${size.height / 2 + view.cy * s})`);
    element.dataset.scale = String(s);
    element.dataset.centre = `${view.cx} ${view.cy}`;

    // The ruler: lines across the bed at each mark in sight, numbered below and to the left.
    const step = markStep(s);
    const low = toBed(view, size, { x: 0, y: size.height });
    const high = toBed(view, size, { x: size.width, y: 0 });
    const xs = marksBetween(low.x, high.x, bed.width, step);
    const ys = marksBetween(low.y, high.y, bed.height, step);
    grid.setAttribute("d", [...xs.map((x) => `M${x} 0V${-bed.height}`), ...ys.map((y) => `M0 ${-y}H${bed.width}`)].join(""));
    const origin = toScreen(view, size, 0, 0);
    const corner = toScreen(view, size, 0, bed.height); // the bed's top-left corner on screen
    const out: SVGElement[] = [];
    // The numbers sit just outside the bed's bottom and left sides; when those sides are out of sight they stay at the view's edge.
    const below = Math.max(14, Math.min(origin.y + 15, size.height - BAR_ROOM));
    const left = Math.max(30, origin.x - 6);
    for (const x of xs) out.push(text("laser-flat-mark", mmWords(x), { x: toScreen(view, size, x, 0).x, y: below }, "middle"));
    for (const y of ys) if (y !== 0) out.push(text("laser-flat-mark", mmWords(y), { x: left, y: toScreen(view, size, 0, y).y + 4 }, "end"));
    out.push(text("laser-flat-bed-name", `Bed ${mmWords(bed.width)} × ${mmWords(bed.height)} mm`, { x: Math.max(8, corner.x), y: Math.max(16, corner.y - 8) }));
    for (const p of scene.parts) {
      const w = (p.box.maxX - p.box.minX) * s;
      const h = (p.box.maxY - p.box.minY) * s;
      if (!nameFits(p.label, w, h)) continue; // too small to carry its name at this zoom: the list names it, and its tooltip
      const mid = toScreen(view, size, (p.box.minX + p.box.maxX) / 2, (p.box.minY + p.box.maxY) / 2);
      if (mid.x + w / 2 < 0 || mid.x - w / 2 > size.width || mid.y + h / 2 < 0 || mid.y - h / 2 > size.height) continue; // out of sight
      out.push(text("laser-flat-part-name", p.label, { x: mid.x, y: mid.y + 4 }, "middle"));
    }
    (scene.note ?? []).forEach((line, i, all) => {
      const mid = toScreen(view, size, bed.width / 2, bed.height / 2);
      out.push(text("laser-flat-note", line, { x: mid.x, y: mid.y + (i - (all.length - 1) / 2) * 18 + 4 }, "middle"));
    });
    marks.replaceChildren(...out);
  };

  /** Draws the scene's part: the bed and the parts, in mm (the camera places them). */
  const drawScene = () => {
    const { bed, parts } = scene;
    bedRect.setAttribute("x", "0");
    bedRect.setAttribute("y", String(-bed.height));
    bedRect.setAttribute("width", String(bed.width));
    bedRect.setAttribute("height", String(bed.height));
    partsGroup.replaceChildren(
      ...parts.map((p) => {
        const path = doc.createElementNS(SVG, "path");
        path.setAttribute("class", "laser-flat-part");
        path.setAttribute("d", p.d);
        path.dataset.part = p.id;
        const title = path.appendChild(doc.createElementNS(SVG, "title"));
        title.textContent = `${p.label}, ${mmWords(p.box.maxX - p.box.minX)} × ${mmWords(p.box.maxY - p.box.minY)} mm`;
        return path;
      }),
    );
    const n = parts.length;
    svg.setAttribute("aria-label", `The laser bed from above, ${mmWords(bed.width)} × ${mmWords(bed.height)} mm, with ${n === 0 ? "no parts" : n === 1 ? `1 part: ${parts[0].label}` : `${n} parts: ${parts.map((p) => p.label).join(", ")}`}.`);
    element.dataset.parts = String(n);
  };

  /** The cards' boxes in the view's own px. */
  const cardBoxes = (): Card[] => {
    const own = element.getBoundingClientRect();
    return (options.cards?.() ?? []).map((c) => {
      const r = c.getBoundingClientRect();
      return { left: r.left - own.left, top: r.top - own.top, right: r.right - own.left, bottom: r.bottom - own.top };
    });
  };
  const fit = () => {
    const size = measure();
    view = fitView(scene.bed, size, marginsClearOf(scene.bed, size, marginsFor(windowSize(size)), cardBoxes()));
    fitted = true;
    draw();
  };
  /** A move the person made: the view stays where they put it. A move that moved nothing (the wheel turned sideways, a slide at its limit) is none. */
  const move = (next: View) => {
    if (!shown || (next.cx === view.cx && next.cy === view.cy && next.scale === view.scale)) return;
    view = next;
    fitted = false;
    draw();
  };

  // Sliding and pinching. One pointer down slides the view; two zoom about the point midway between them and slide with it.
  const pointers = new Map<number, ScreenPoint>();
  const local = (e: { clientX: number; clientY: number }): ScreenPoint => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) delete element.dataset.dragging;
  };
  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    if (e.isPrimary) pointers.clear(); // the first pointer down: any other still held here is one whose release was never heard
    if (pointers.size >= 2) return;
    pointers.set(e.pointerId, local(e));
    element.dataset.dragging = "";
    svg.setPointerCapture?.(e.pointerId);
    if (e.button === 1) e.preventDefault(); // no auto-scroll marker under a middle-drag
  });
  svg.addEventListener("pointermove", (e) => {
    const before = pointers.get(e.pointerId);
    if (!before) return;
    // A mouse or pen moving with neither the left nor the middle button held is no drag: its release went missing (as the 3D view's `releaseLost`).
    if (e.pointerType !== "touch" && (e.buttons & 5) === 0) return release(e);
    const now = local(e);
    const size = measure();
    const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
    pointers.set(e.pointerId, now);
    if (!other) return move(panBy(view, scene.bed, size, now.x - before.x, now.y - before.y));
    const mid = (a: ScreenPoint, b: ScreenPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const [m0, m1] = [mid(before, other), mid(now, other)];
    const [d0, d1] = [Math.hypot(before.x - other.x, before.y - other.y), Math.hypot(now.x - other.x, now.y - other.y)];
    const slid = panBy(view, scene.bed, size, m1.x - m0.x, m1.y - m0.y);
    move(d0 > 0 && d1 > 0 ? zoomAt(slid, scene.bed, size, m1, d1 / d0) : slid);
  });
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  svg.addEventListener("lostpointercapture", release);
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault(); // the view zooms; the page never scrolls or zooms under it
      move(zoomAt(view, scene.bed, measure(), local(e), wheelZoom(e.deltaY, e.deltaMode, e.ctrlKey)));
    },
    { passive: false },
  );
  svg.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const size = measure();
    const middle = { x: size.width / 2, y: size.height / 2 };
    const slide: Record<string, [number, number]> = { ArrowLeft: [KEY_SLIDE, 0], ArrowRight: [-KEY_SLIDE, 0], ArrowUp: [0, KEY_SLIDE], ArrowDown: [0, -KEY_SLIDE] };
    if (e.key === "+" || e.key === "=") move(zoomAt(view, scene.bed, size, middle, ZOOM_STEP));
    else if (e.key === "-" || e.key === "_") move(zoomAt(view, scene.bed, size, middle, 1 / ZOOM_STEP));
    else if (e.key === "0" || e.key === "Home") fit();
    else if (e.key in slide) move(panBy(view, scene.bed, size, ...slide[e.key]));
    else return;
    e.preventDefault();
    e.stopPropagation(); // these keys are the view's while it has the focus
  });

  const detach = () => {
    if (!host) return;
    watch?.disconnect();
    watch = null;
    switched?.disconnect();
    switched = null;
    pointers.clear();
    delete element.dataset.dragging;
    element.remove();
    if (hostLabel === null) host.removeAttribute("aria-label");
    else host.setAttribute("aria-label", hostLabel);
    host = null;
  };

  return {
    element,
    attach(to) {
      if (host === to) return;
      detach();
      host = to;
      hostLabel = to.getAttribute("aria-label");
      to.setAttribute("aria-label", "Laser bed, flat view");
      // Straight over the 3D canvas and under everything else the app lays over the view (notes, phone buttons). Being
      // before the 3D view's row of buttons is also what hides that row (laser-flat.css: a later sibling of this view).
      const canvas = to.querySelector("canvas");
      if (canvas) canvas.after(element);
      else to.prepend(element);
      // A pane whose view the app has switched off (a workspace it shows as "Coming soon") shows no bed either.
      const onOff = () => {
        element.hidden = to.dataset.drawing === "off";
      };
      onOff();
      const Mutations = doc.defaultView?.MutationObserver;
      if (Mutations) {
        switched = new Mutations(onOff);
        switched.observe(to, { attributes: true, attributeFilter: ["data-drawing"] });
      }
      if (typeof ResizeObserver === "function") {
        // The view's own size, and the cards': a list that grows, or a sheet that opens or closes over a fitted bed, fits it again.
        watch = new ResizeObserver(() => (fitted ? fit() : draw()));
        watch.observe(element);
        for (const card of options.cards?.() ?? []) watch.observe(card);
      }
      if (fitted) fit();
      else draw();
    },
    detach,
    show(next, frame) {
      const resized = next.bed.width !== scene.bed.width || next.bed.height !== scene.bed.height;
      scene = next;
      shown = true;
      drawScene();
      if (frame || fitted) return fit(); // a view the person has not moved keeps the whole bed in sight, clear of the parts list as it grows
      if (resized) view = zoomAt(view, scene.bed, measure(), { x: 0, y: 0 }, 1); // the same view, kept within the new bed's limits
      draw();
    },
    fit,
    view: () => ({ ...view }),
  };
}
