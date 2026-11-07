// The mouse preset (U2d): which buttons turn, move and zoom the 3D view, a Settings choice kept with the other
// settings. The page wears it as `data-mouse` on the root, and a `mousechange` event on the document tells the
// viewports (the viewport reads the same attribute and event, so it needs nothing from here).
import { MOUSE_ATTRIBUTE, MOUSE_EVENT, readMousePreset, type MousePreset } from "@fission/core";
import type { SettingsStore } from "./settings.ts";

export const MOUSE_SETTING = "mouse";

/** The stored preset: SpindleLabs's own unless "fusion" is stored. */
export const readMouseChoice = (settings: SettingsStore): MousePreset => readMousePreset(settings.get(MOUSE_SETTING, "spindle"));

/** The preset the page wears now. */
export const currentMouse = (doc: Document): MousePreset => readMousePreset(doc.documentElement.dataset[MOUSE_ATTRIBUTE]);

/** Put `preset` on the page and tell the viewports. */
function apply(doc: Document, preset: MousePreset): void {
  doc.documentElement.dataset[MOUSE_ATTRIBUTE] = preset;
  const Event = (doc.defaultView as (Window & typeof globalThis) | null)?.CustomEvent ?? CustomEvent;
  doc.dispatchEvent(new Event(MOUSE_EVENT, { detail: preset }));
}

/** Wear the stored preset now; returns `choose` (store and wear a new choice). */
export function startMouse(doc: Document, settings: SettingsStore): (preset: MousePreset) => void {
  apply(doc, readMouseChoice(settings));
  return (preset) => {
    settings.set(MOUSE_SETTING, preset);
    apply(doc, preset);
  };
}
