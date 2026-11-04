// The colour theme (U1b and U2a): the Settings choice (follow the device,
// light or dark), stored in the browser with the other settings, and the
// resolved theme the page wears as `data-theme` on the root, which theme.css
// answers with the dark or the light values of every colour token.
// `apps/fission/public/theme-init.js` does the same work before the first
// paint, so a light-mode user never sees a dark flash; `test/theme-choice.test.ts`
// runs both over the same table to prove they agree.
import { DEFAULT_CUSTOM, deriveCustom, readTokens, type CustomColours, type CustomResult } from "./custom-theme.ts";
import type { SettingsStore } from "./settings.ts";

export type ThemeChoice = "device" | "light" | "dark" | "custom";
export type Theme = "light" | "dark";
export const THEME_CHOICES: readonly { id: ThemeChoice; label: string }[] = [
  { id: "device", label: "Follow device" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "custom", label: "Custom" },
];
export const THEME_SETTING = "theme";
/** The browser's `theme-color` (the bar around the page on a phone): the page colour of each theme. */
export const THEME_COLOURS: Record<Theme, string> = { dark: "#0f141c", light: "#e6eaf1" };

export const isThemeChoice = (v: unknown): v is ThemeChoice => v === "device" || v === "light" || v === "dark" || v === "custom";

/** The theme a choice means: light and dark are themselves; "device" (and anything unknown) follows what the device prefers. */
export function resolveTheme(choice: unknown, deviceIsLight: boolean): Theme {
  if (choice === "light") return "light";
  if (choice === "dark") return "dark";
  return deviceIsLight ? "light" : "dark";
}

export const readThemeChoice = (settings: SettingsStore): ThemeChoice => {
  const v = settings.get(THEME_SETTING, "device");
  return isThemeChoice(v) ? v : "device";
};

/** The settings the Custom theme keeps: its three colours, and what they came to (so the pre-paint script can replay it with no maths). */
export const CUSTOM_KEYS = { primary: "custom-primary", secondary: "custom-secondary", highlight: "custom-highlight", base: "custom-base", vars: "custom-vars", secondaryUsed: "custom-secondary-used" } as const;

/** The three stored colours, the standard ones where none is stored. */
export const readCustom = (settings: SettingsStore): CustomColours => ({
  primary: settings.get(CUSTOM_KEYS.primary, DEFAULT_CUSTOM.primary),
  secondary: settings.get(CUSTOM_KEYS.secondary, DEFAULT_CUSTOM.secondary),
  highlight: settings.get(CUSTOM_KEYS.highlight, DEFAULT_CUSTOM.highlight),
});

/** Tell the page something changed, with the page's own event class (a test's page has its own). */
function emit(doc: Document, name: string, detail: unknown): void {
  const Event = (doc.defaultView as (Window & typeof globalThis) | null)?.CustomEvent ?? CustomEvent;
  doc.dispatchEvent(new Event(name, { detail }));
}

/** Take off every custom colour the page wears. */
function clearCustom(doc: Document): void {
  const root = doc.documentElement;
  for (const name of (root.dataset.customVars ?? "").split(",")) if (name) root.style.removeProperty(name);
  delete root.dataset.customVars;
  delete root.dataset.customSecondary;
}

/** Put `theme` on the page: the root's data-theme, and the browser bar's colour. Returns it. */
export function applyTheme(doc: Document, theme: Theme, bar: string = THEME_COLOURS[theme]): Theme {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", bar);
  emit(doc, "themechange", theme);
  return theme;
}

/** Wear the Custom theme made from `colours`: store the three colours and what they came to, set the tokens, tell the 3D view its sky. Returns the result, with its notes. */
export function applyCustom(doc: Document, settings: SettingsStore, colours: CustomColours): CustomResult {
  const result = deriveCustom(colours, readTokens(doc));
  const root = doc.documentElement;
  clearCustom(doc);
  for (const [name, value] of Object.entries(result.vars)) root.style.setProperty(name, value);
  root.dataset.customVars = Object.keys(result.vars).join(",");
  root.dataset.customSecondary = result.used.secondary;
  settings.set(CUSTOM_KEYS.primary, colours.primary);
  settings.set(CUSTOM_KEYS.secondary, colours.secondary);
  settings.set(CUSTOM_KEYS.highlight, colours.highlight);
  settings.set(CUSTOM_KEYS.base, result.base);
  settings.set(CUSTOM_KEYS.vars, JSON.stringify(result.vars));
  settings.set(CUSTOM_KEYS.secondaryUsed, result.used.secondary);
  emit(doc, "colourchange", { secondary: result.used.secondary });
  applyTheme(doc, result.base, result.used.primary);
  return result;
}

/** Apply the stored choice now and again whenever the choice or the device changes; returns `choose` (store + apply a new choice). */
export function startTheme(doc: Document, settings: SettingsStore, media: MediaQueryList | null): (choice: ThemeChoice) => void {
  const now = () => {
    const choice = readThemeChoice(settings);
    if (choice === "custom") return applyCustom(doc, settings, readCustom(settings)).base;
    if (doc.documentElement.dataset.customVars) {
      clearCustom(doc);
      emit(doc, "colourchange", { secondary: null });
    }
    return applyTheme(doc, resolveTheme(choice, media?.matches ?? false));
  };
  now();
  media?.addEventListener("change", now);
  return (choice) => {
    settings.set(THEME_SETTING, choice);
    now();
  };
}
