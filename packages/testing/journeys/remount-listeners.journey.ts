// Design mounted afresh, as every Undo and Redo does (the shell's restore), leaves no listener behind on the shell's own
// elements (the properties slot, the page): each one left holds the old mount, its DOM, its design and its kernel
// caches, so a session of undos grew without end (found 2026-11-11 by the timeline hunt: the Body facts toggle's
// "properties-sheet" listener was added at each mount and never taken off, and three long journeys ran out of memory).
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, partDocument } from "@fission/design";
import { app } from "./design-app.ts";

const { EventTarget } = await import("happy-dom");

/**
 * Every listener added and not yet taken off, by type, on what outlives a mount: the page, its window, and elements
 * still in the page (a listener on an element the remount threw away goes with it).
 */
function counting() {
  const targets = new Map<object, Map<unknown, string>>(); // target -> listener -> type
  const proto = EventTarget.prototype as unknown as { addEventListener: Function; removeEventListener: Function };
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: object, type: string, fn: unknown, o?: { once?: boolean; signal?: unknown }) {
    if (!(typeof o === "object" && (o.once || o.signal))) {
      const mine = targets.get(this) ?? new Map();
      mine.set(fn, type); // a listener added twice to one target is one listener (the DOM's rule)
      targets.set(this, mine);
    }
    return add.call(this, type, fn, o);
  };
  proto.removeEventListener = function (this: object, type: string, fn: unknown, o?: unknown) {
    targets.get(this)?.delete(fn);
    return remove.call(this, type, fn, o);
  };
  const outlives = (t: object) => !("isConnected" in t) || (t as { isConnected: boolean }).isConnected;
  return {
    live() {
      const by = new Map<string, number>();
      for (const [t, mine] of targets) if (outlives(t)) for (const type of mine.values()) by.set(type, (by.get(type) ?? 0) + 1);
      return by;
    },
    stop: () => ((proto.addEventListener = add), (proto.removeEventListener = remove)),
  };
}

test("twenty Undo and Redo remounts leave no more listeners than one mount has", async () => {
  const listeners = counting();
  try {
    const a = await app(partDocument("box", 40, 30, 20), designWorkspace);
    await a.menu("feature-1", "suppress");
    assert.equal(a.history.undoLabel !== undefined, true);
    await a.undo();
    await a.redo();
    const after1 = listeners.live();
    for (let i = 0; i < 20; i++) {
      await a.undo();
      await a.redo();
    }
    const after21 = listeners.live();
    // Each type's live listeners after 21 remounts are those after 1: none piles up.
    const grown = [...after21].filter(([type, n]) => n > (after1.get(type) ?? 0)).map(([type, n]) => `${type}: ${after1.get(type) ?? 0} -> ${n}`);
    assert.deepEqual(grown, [], `listeners piled up over 20 remounts: ${grown.join(", ")}`);
  } finally {
    listeners.stop();
  }
});
