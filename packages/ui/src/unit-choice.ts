// The unit lengths are shown and typed in (U2c2): millimetres or inches, a Settings choice kept with the other
// settings. The document always holds millimetres (@fission/core units.ts does every conversion); this only says
// which unit the screens use. The page wears it as `data-unit` on the root, and a `unitchange` event on the
// document tells the screens that show lengths to redraw.
import { readUnit, type Unit } from "@fission/core";
import type { SettingsStore } from "./settings.ts";

export const UNIT_SETTING = "unit";
export const UNIT_EVENT = "unitchange";
export const UNIT_CHOICES: readonly { id: Unit; label: string }[] = [
  { id: "mm", label: "Millimetres (mm)" },
  { id: "in", label: "Inches (in)" },
];

/** The stored unit: millimetres unless "in" is stored. */
export const readUnitChoice = (settings: SettingsStore): Unit => readUnit(settings.get(UNIT_SETTING, "mm"));

/** The unit the page wears now: millimetres on a page that has not started units. */
export const currentUnit = (doc: Document): Unit => readUnit(doc.documentElement.dataset.unit);

/** Put `unit` on the page and tell the screens. */
function apply(doc: Document, unit: Unit): void {
  doc.documentElement.dataset.unit = unit;
  const Event = (doc.defaultView as (Window & typeof globalThis) | null)?.CustomEvent ?? CustomEvent;
  doc.dispatchEvent(new Event(UNIT_EVENT, { detail: unit }));
}

/** Wear the stored unit now; returns `choose` (store and wear a new choice). */
export function startUnits(doc: Document, settings: SettingsStore): (unit: Unit) => void {
  apply(doc, readUnitChoice(settings));
  return (unit) => {
    settings.set(UNIT_SETTING, unit);
    apply(doc, unit);
  };
}
