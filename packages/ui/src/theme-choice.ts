// The colour theme (U1b and U2a): the Settings choice (follow the device,
// light or dark), stored in the browser with the other settings, and the
// resolved theme the page wears as `data-theme` on the root, which theme.css
// answers with the dark or the light values of every colour token.
// `apps/fission/public/theme-init.js` does the same work before the first
// paint, so a light-mode user never sees a dark flash; `test/theme-choice.test.ts`
// runs both over the same table to prove they agree.
import type { SettingsStore } from "./settings.ts";

export type ThemeChoice = "device" | "light" | "dark";
export type Theme = "light" | "dark";
export const THEME_CHOICES: readonly { id: ThemeChoice; label: string }[] = [
  { id: "device", label: "Follow device" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
export const THEME_SETTING = "theme";
/** The browser's `theme-color` (the bar around the page on a phone): the page colour of each theme. */
export const THEME_COLOURS: Record<Theme, string> = { dark: "#0f141c", light: "#e6eaf1" };

export const isThemeChoice = (v: unknown): v is ThemeChoice => v === "device" || v === "light" || v === "dark";

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

/** Put `theme` on the page: the root's data-theme, and the browser bar's colour. Returns it. */
export function applyTheme(doc: Document, theme: Theme): Theme {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOURS[theme]);
  doc.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
  return theme;
}

/** Apply the stored choice now and again whenever the choice or the device changes; returns `choose` (store + apply a new choice). */
export function startTheme(doc: Document, settings: SettingsStore, media: MediaQueryList | null): (choice: ThemeChoice) => void {
  const now = () => applyTheme(doc, resolveTheme(readThemeChoice(settings), media?.matches ?? false));
  now();
  media?.addEventListener("change", now);
  return (choice) => {
    settings.set(THEME_SETTING, choice);
    now();
  };
}
