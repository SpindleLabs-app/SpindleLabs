import assert from "node:assert/strict";
import type { app } from "./design-app.ts";
export type App = Awaited<ReturnType<typeof app>>;
/** JSON with sorted keys: the same design gives the same text however its keys are ordered. */
export const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));
export const J = (a: App) => canon(a.doc());
export const type = (a: App, sel: string, value: string) => {
  const el = a.$(sel) as HTMLInputElement;
  assert.ok(el, `no ${sel}`);
  el.value = value;
  el.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
};
export const click = (a: App, sel: string) => {
  const el = a.$(sel) as HTMLButtonElement;
  assert.ok(el, `no ${sel}`);
  el.click();
};
export const value = (a: App, sel: string) => (a.$(sel) as HTMLInputElement).value;
export const rows = (a: App) => [...a.window.document.querySelectorAll(".tree-row")].map((r) => (r as unknown as HTMLElement).textContent!.trim().replace(/\s+/g, " ")).join(" | ");
export const steps = (a: App) => a.history.steps().map((s) => `${s.state === "current" ? "*" : ""}${s.label}`).join(" > ");
export const diff = (x: string, y: string) => {
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return `at ${i}: …${x.slice(Math.max(0, i - 60), i + 160)}…  VS  …${y.slice(Math.max(0, i - 60), i + 160)}…`;
};
