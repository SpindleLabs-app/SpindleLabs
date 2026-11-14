// The question a Cut or Join that changes nothing asks before OK records
// it (Ben, 11 Nov: "give a popup and they can choose between deleting the
// body or cancelling the operation"; SL #506 item 5, #521). Which tools
// miss is the rebuild's (misses.ts, `FeatureResult.misses`), on the design
// OK would record; the words say what OK would really do:
// - a Combine's Cut with Keep tools off uses its tools up, so a tool that
//   reaches nothing would just be deleted: Delete Body 2, or Cancel;
// - with Keep tools on nothing goes and nothing changes: Record anyway;
// - a Join's tool that changes nothing stays a piece of its own, or is
//   swallowed: Join anyway;
// - an operation extrude that misses leaves no body of its own (Cut), or
//   a separate piece (Join), likely pointing the wrong way: Flip says so.
// Cancel goes back to the open panel with nothing recorded; it has the
// focus, so Enter alone records nothing. A later edit that makes a
// recorded one miss can't ask: its row says so (workspace.ts warningsOf).

import type { KernelCalls } from "@fission/core";
import { bodyNumbers, numberPieces, type DesignDocument } from "./document.ts";
import { BodyCache, builtPieceFaces, followedDoc, rebuildTimeline } from "./rebuild.ts";
import { listWords, type Miss } from "./misses.ts";

/** What OK's check found: the rebuild's refusal, else the tools that change nothing (none: record at once). */
export interface Checked {
  refused: string | null;
  misses: Miss[];
  /**
   * The design checked with the pieces its build made numbered (`numberPieces`, with their faces), for OK to record
   * in its own undo step: numbered only when the rebuild after OK landed, an Insert made before that took the next
   * number first, and Undo and Redo then showed one body under two numbers (SL #622 item 7). Left out when refused.
   * A Move takes the pieces its check build moved first (`followedDoc`, as the rebuild after OK does before it numbers):
   * numbered without that, the rebuild found the piece numbered already, the Move never took it, and one end of a body
   * cut through dropped back to where it was before the Move (app-wide hunt 2026-11-14, T-2).
   */
  numbered?: DesignDocument;
}

/** Item `id` built in design `next` on a body store of its own: refused in the rebuild's words, or what it misses. */
export async function checkedItem(kernel: KernelCalls, next: DesignDocument, id: string): Promise<Checked> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(next, cache, kernel);
    const r = build.results[id];
    if (r?.status === "failed") return { refused: r.message, misses: [] };
    return { refused: null, misses: r?.status === "built" ? (r.misses?.list ?? []) : [], numbered: numberPieces(followedDoc(next, build), Object.keys(build.bodies), builtPieceFaces(build)) };
  } finally {
    await cache.close();
  }
}

/** The question's heading, words and the button that records. */
export interface AskWords {
  heading: string;
  words: string;
  go: string;
}

/** What is asked about: a Combine (its Keep tools), or an operation extrude (its own body's id). */
export type Asking = { kind: "combine"; keepTools: boolean } | { kind: "extrude"; label: string; own: string };

/** Body ids in words, as the browser shows them ("Body 2"), else `fallback`'s. */
export function bodyNamer(doc: DesignDocument, fallback: (body: string) => string): (body: string) => string {
  const numbers = bodyNumbers(doc);
  return (b) => (numbers.has(b) ? `Body ${numbers.get(b)}` : fallback(b));
}

/** The question for these misses of a Cut or Join (never empty: OK records at once without misses). */
export function askWords(op: "cut" | "join", misses: readonly Miss[], name: (body: string) => string, asking: Asking): AskWords {
  const targets = [...new Set(misses.map((m) => m.target))].map(name);
  const or = targets.length <= 1 ? (targets[0] ?? "") : `${targets.slice(0, -1).join(", ")} or ${targets.at(-1)}`;
  if (asking.kind === "extrude" && misses.every((m) => m.tools.length === 1 && m.tools[0] === asking.own)) {
    const turn = "It may point the wrong way: Flip turns it round.";
    // SL #583 item 3: none of its faces left, it lies wholly inside, so it neither reaches nothing nor stays apart.
    if (op === "join" && misses.every((m) => m.inside?.includes(asking.own))) {
      return { heading: "The join adds nothing", words: `${asking.label} lies wholly inside ${or}, so joining it adds nothing. ${turn} Join anyway, or cancel and change it?`, go: "Join anyway" };
    }
    return op === "cut"
      ? { heading: "The cut removes nothing", words: `${asking.label} doesn't reach ${or}, so it cuts nothing and leaves no body of its own. ${turn} Cut anyway, or cancel and change it?`, go: "Cut anyway" }
      : { heading: "The join adds nothing", words: `${asking.label} doesn't reach ${or}, so it stays a separate piece. ${turn} Join anyway, or cancel and change it?`, go: "Join anyway" };
  }
  const tools = [...new Set(misses.flatMap((m) => m.tools))].map((b) => (asking.kind === "extrude" && b === asking.own ? asking.label : name(b)));
  const one = tools.length === 1;
  const list = listWords(tools);
  if (op === "join") {
    return {
      heading: "The join adds nothing",
      words: `${list} ${one ? "doesn't" : "don't"} change ${or}: ${one ? "it doesn't reach it or lies" : "they don't reach it or lie"} wholly inside it, so joining adds nothing. Join anyway, or cancel and change the picks?`,
      go: "Join anyway",
    };
  }
  const reach = `${list} ${one ? "doesn't" : "don't"} reach ${or}, so cutting ${one ? "it" : "them"} removes nothing.`;
  if (asking.kind === "combine" && !asking.keepTools) {
    return { heading: "The cut removes nothing", words: `${reach} The Combine uses its tools up, so ${list} would only be deleted. Delete ${list} anyway, or cancel and change the picks?`, go: `Delete ${list}` };
  }
  return { heading: "The cut removes nothing", words: `${reach} Record it anyway, or cancel and change it?`, go: "Record anyway" };
}

/** The question box: `ask` resolves true on its record button, false on Cancel, Escape, a click outside or another ask. */
export interface CutAsk {
  ask(words: AskWords): Promise<boolean>;
  /** Closes it as a Cancel (a tool closing, the design changing). */
  close(): void;
  readonly open: boolean;
}

/**
 * The box, a native modal <dialog> in `slot`'s page as Start fresh's
 * (styles/cut-ask.css): keys pressed in it never reach the app's
 * shortcuts; Cancel has the focus.
 */
export function cutAsk(slot: HTMLElement): CutAsk {
  const document = slot.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.id = "cut-ask";
  dialog.className = "cut-ask";
  dialog.setAttribute("aria-labelledby", "cut-ask-heading");
  dialog.setAttribute("aria-describedby", "cut-ask-words");
  const heading = document.createElement("h2");
  heading.id = "cut-ask-heading";
  const words = document.createElement("p");
  words.id = "cut-ask-words";
  const actions = document.createElement("div");
  actions.className = "cut-ask-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.id = "cut-ask-cancel";
  cancel.textContent = "Cancel";
  const go = document.createElement("button");
  go.type = "button";
  go.id = "cut-ask-go";
  actions.append(cancel, go);
  dialog.append(heading, words, actions);
  slot.append(dialog);

  let answer: ((yes: boolean) => void) | null = null;
  const end = (yes: boolean) => {
    // Taken first: closing fires "close" (at once in some pages), which must not answer it again as a Cancel.
    const a = answer;
    answer = null;
    if (dialog.open) dialog.close();
    a?.(yes);
  };
  cancel.addEventListener("click", () => end(false));
  go.addEventListener("click", () => end(true));
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const { clientX: x, clientY: y } = e as MouseEvent;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) end(false);
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      end(false);
    }
    e.stopPropagation();
  });
  // Closed some other way (the browser's own Escape handling): a Cancel.
  dialog.addEventListener("close", () => end(false));

  return {
    ask(w) {
      end(false);
      heading.textContent = w.heading;
      words.textContent = w.words;
      go.textContent = w.go;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      cancel.focus();
      return new Promise<boolean>((resolve) => (answer = resolve));
    },
    close: () => end(false),
    get open() {
      return dialog.open;
    },
  };
}
