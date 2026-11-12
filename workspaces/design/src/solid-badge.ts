// The export badge ("this is solid", Ben 2026-11-05): after Download STL the
// kernel checks the file's own bytes (`check_solid`), and this card in the
// 3D view says what it found. Solid: closed all round, no gaps, nothing
// facing the wrong way, nothing crossing or touching itself, so a slicer
// prints what was designed; the file says so in its header. Not solid: what
// is wrong in plain words, and where, marked on the model in red (an
// overlay of places); the file is still saved, never blocked. Unfinished:
// the check ran out of time, said as that, never as solid.
// `badgeFor`, `problemWords`, `solidOverlay` and `stampChecked` are pure and
// tested by hand; `solidBadge` is the card. Styles: src/styles/solid-badge.css.

import type { AnalysisOverlay, OverlayPlace, SolidProblem, SolidProblemKind, SolidReport } from "@fission/core";

/** The overlay that marks where a file is not solid (one at a time: the last export's). */
export const SOLID_OVERLAY = "design.solid-check";

/** Each kind of problem: one, many, and what it means for a beginner. */
const KIND_WORDS: Record<SolidProblemKind, { one: string; many: string; means: string }> = {
  empty: { one: "nothing in it", many: "nothing in it", means: "The file has no triangles at all." },
  gap: { one: "a gap", many: "gaps", means: "an edge with a face on one side only: a hole in the surface" },
  flipped: { one: "a flipped face", many: "flipped faces", means: "a face turned the wrong way round, inside facing out (counted at its edges)" },
  branching: { one: "an edge shared by 3+ faces", many: "edges shared by 3+ faces", means: "more than two faces on one edge, so inside and outside are unclear" },
  collapsed: { one: "a squashed triangle", many: "squashed triangles", means: "a triangle flattened to a line or a point, with no area" },
  pinched: { one: "a pinched corner", many: "pinched corners", means: "two pieces touching at a single point" },
  crossing: { one: "a crossing", many: "crossings", means: "the surface crosses or touches itself, or two pieces overlap or touch" },
  "inside-out": { one: "an inside-out piece", many: "inside-out pieces", means: "a closed piece facing inwards with nothing round it" },
  inside: { one: "a piece inside another", many: "pieces inside others", means: "a piece sitting inside another piece's material" },
};

/** "a gap", "3 gaps", "nothing in it". */
export function problemWords(p: SolidProblem): string {
  const w = KIND_WORDS[p.kind];
  if (p.kind === "empty") return w.one;
  return p.count === 1 ? w.one : `${p.count.toLocaleString("en")} ${w.many}`;
}

/** What one kind means, for the card's list. */
export function problemMeaning(kind: SolidProblemKind): string {
  return KIND_WORDS[kind].means;
}

export interface Badge {
  /** "touching": every body is solid alone and the file's problems lie between them; "missing": solid, but timeline items failed and are not in it. */
  state: "solid" | "problems" | "unfinished" | "touching" | "missing";
  /** The card's heading. */
  title: string;
  /** One or two plain sentences under it: why it matters. */
  detail: string;
  /** What was checked, in numbers ("12 triangles, 24 cm³."), when solid; else "". */
  facts: string;
  /** For the problems: each kind's words and what it means. */
  items: { words: string; means: string }[];
}

/** "1,284 triangles", "1 triangle". */
function triangleWords(n: number): string {
  return n === 1 ? "1 triangle" : `${n.toLocaleString("en")} triangles`;
}

/** cm³ for anything 1 cm³ or more, else mm³, to three significant figures. */
export function volumeWords(mm3: number): string {
  const v = Math.abs(mm3);
  if (v >= 1000) return `${Number((v / 1000).toPrecision(3)).toLocaleString("en")} cm³`;
  return `${Number(v.toPrecision(3)).toLocaleString("en")} mm³`;
}

/**
 * What an export knows beyond its file's own check (export hunt 2026-11-12 D). `missing`: the words naming the timeline
 * items that failed, so the file is not the whole design (`failedItemsNote`); a file checked solid then never reads as
 * "Checked solid", and a file with problems says them after it. `touching`: the file holds this many bodies, each
 * checked solid on its own, so every problem the file has lies between them (they touch or overlap): a milder card
 * that says so and offers Combine > Join, never "Not solid".
 */
export interface ExportNotes {
  missing?: string;
  touching?: number;
}

/** What the export says when its bodies are each solid but touch or overlap one another (`ExportNotes.touching`). */
export function touchingWords(bodies: number): { title: string; detail: string } {
  return {
    title: bodies === 2 ? "The 2 bodies touch or overlap" : `Some of the ${bodies} bodies touch or overlap`,
    detail: "Each body is solid on its own, but where they meet their surfaces cross, and some slicers refuse such a file (Slice for printing sends them one by one, which is safe). Combine > Join makes them one part.",
  };
}

/** What the card says for a report, with what the export knows beyond it (`notes`). */
export function badgeFor(report: SolidReport, notes: ExportNotes = {}): Badge {
  const b = checkedBadge(report, notes.touching);
  if (!notes.missing) return b;
  if (b.state === "solid") return { state: "missing", title: "Not the whole design", detail: `${notes.missing} What was built is solid.`, facts: b.facts, items: [] };
  return { ...b, detail: `${notes.missing} ${b.detail}` };
}

/** The card for the file's own check; `touching`, the bodies in it when each was checked solid alone. */
function checkedBadge(report: SolidReport, touching: number | undefined): Badge {
  if (report.verdict === "solid") {
    const pieces = report.shells === 1 ? "" : `, ${report.shells} closed pieces`;
    return {
      state: "solid",
      title: "Checked solid",
      detail: "Closed all round, nothing facing the wrong way, nothing crossing itself: a slicer will print what you designed.",
      facts: `${triangleWords(report.triangles)}${pieces}, ${volumeWords(report.volume)}.`,
      items: [],
    };
  }
  if (report.verdict === "unfinished") {
    return {
      state: "unfinished",
      title: "Solid check not finished",
      detail: "The file has too many triangles close together to check in time, so it is not known to be solid. It was saved.",
      facts: "",
      items: report.problems.map((p) => ({ words: problemWords(p), means: problemMeaning(p.kind) })),
    };
  }
  if (report.verdict === "problems" && touching !== undefined && touching >= 2) return { state: "touching", ...touchingWords(touching), facts: "", items: [] };
  const words = report.problems.map(problemWords);
  const title = `Not solid: ${words.slice(0, 2).join(", ")}${words.length > 2 ? ` and ${words.length - 2} more` : ""}`;
  return {
    state: "problems",
    title,
    detail: "The file was saved, but a slicer may print it wrong or refuse it. The places are marked in red on the model.",
    facts: "",
    items: report.problems.map((p) => ({ words: problemWords(p), means: problemMeaning(p.kind) })),
  };
}

/** The overlay marking a report's places in red (amber where bodies each solid alone only touch, `touching`), or null when it has none (solid, or nothing placed). */
export function solidOverlay(report: SolidReport, touching = false): AnalysisOverlay | null {
  const severity = touching ? ("warning" as const) : ("error" as const);
  const places: OverlayPlace[] = report.problems.flatMap((p) => p.places.map((at) => ({ severity, ...at })));
  if (report.verdict === "solid" || places.length === 0) return null;
  return {
    id: SOLID_OVERLAY,
    label: touching ? "Bodies touch" : "Not solid",
    detail: report.problems.map((p) => `${problemWords(p)}: ${problemMeaning(p.kind)}`).join("\n"),
    marks: [],
    places,
  };
}

/** Header bytes before a binary STL's triangle count. */
const HEADER = 80;
/** What a checked file's header starts with (never "solid", which makes some readers take it for ASCII STL). */
export const CHECKED_HEADER = "SpindleLabs STL, checked solid: ";

/**
 * The file with its header saying it was checked solid, then `name`, cut
 * to the 80 bytes (whole characters, printable ASCII only: the format has
 * no encoding). Only the header changes, so the check still holds.
 */
export function stampChecked(bytes: Uint8Array<ArrayBuffer>, name: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes);
  if (out.length < HEADER) return out;
  const text = (CHECKED_HEADER + name.replace(/[^\x20-\x7e]/g, "?")).slice(0, HEADER).padEnd(HEADER, " ");
  for (let i = 0; i < HEADER; i++) out[i] = text.charCodeAt(i);
  return out;
}

export interface SolidBadge {
  readonly element: HTMLElement;
  /** Shows the card for a report (replacing the last one). */
  show(report: SolidReport, notes?: ExportNotes): void;
  hide(): void;
}

/** The card in `host` (the 3D view); `onClose` runs when ✕ puts it away (the workspace clears the overlay). */
export function solidBadge(host: HTMLElement, onClose: () => void): SolidBadge {
  const doc = host.ownerDocument;
  const el = doc.createElement("section");
  el.className = "solid-badge";
  el.id = "solid-badge"; // read by the e2e test
  el.hidden = true;
  el.setAttribute("role", "status");
  el.setAttribute("aria-labelledby", "solid-badge-title");
  const mark = doc.createElement("span");
  mark.className = "solid-badge-mark";
  mark.setAttribute("aria-hidden", "true");
  const title = doc.createElement("h2");
  title.id = "solid-badge-title";
  const detail = doc.createElement("p");
  detail.className = "solid-badge-detail";
  const why = doc.createElement("span");
  why.className = "solid-badge-why";
  const facts = doc.createElement("span");
  facts.className = "solid-badge-facts";
  detail.append(why, facts);
  const list = doc.createElement("ul");
  list.className = "solid-badge-list";
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "solid-badge-close";
  close.id = "solid-badge-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close");
  close.title = "Close";
  el.append(mark, title, close, detail, list);
  host.append(el);
  const api: SolidBadge = {
    element: el,
    show(report, notes) {
      const b = badgeFor(report, notes);
      el.dataset.state = b.state;
      mark.textContent = b.state === "solid" ? "✓" : b.state === "unfinished" ? "?" : "!";
      title.textContent = b.title;
      why.textContent = b.detail;
      facts.textContent = b.facts === "" ? "" : ` ${b.facts}`;
      list.replaceChildren(
        ...b.items.map((item) => {
          const li = doc.createElement("li");
          const words = doc.createElement("strong");
          words.textContent = item.words;
          li.append(words, `: ${item.means}`);
          return li;
        }),
      );
      list.hidden = b.items.length === 0;
      el.hidden = false;
    },
    // Hidden, it keeps nothing of the last report: the same few nodes whatever was saved (the soak counts them, #198).
    hide() {
      el.hidden = true;
      delete el.dataset.state;
      for (const part of [mark, title, why, facts]) part.textContent = "";
      list.replaceChildren();
      list.hidden = true;
    },
  };
  close.addEventListener("click", () => {
    api.hide();
    onClose();
  });
  return api;
}
