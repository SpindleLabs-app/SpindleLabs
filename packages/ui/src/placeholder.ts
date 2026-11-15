// The page a workspace shows until it is built: what it will do, when work
// on it starts, and when it is expected (e.g. "Expected late 2027"). It shows plans, never fake results.

export interface PlaceholderInfo {
  title: string;
  /** Its rough window, e.g. "late 2027" (eta.ts). */
  eta: string;
  summary: string;
  /** What the workspace will do, one line each. */
  plans: string[];
  /** When work starts, e.g. "after CAD step 25 (the timeline)". */
  startsAfter: string;
  /** Extra sections, e.g. the marketplace inside Slice. */
  sections?: { title: string; summary: string; plans: string[] }[];
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const list = (items: string[]) => `<ul>${items.map((p) => `<li>${escape(p)}</li>`).join("")}</ul>`;

/** Fills `panel` with the placeholder page. */
export function showPlaceholder(panel: HTMLElement, info: PlaceholderInfo): void {
  const sections = (info.sections ?? [])
    .map((s) => `<section><h3>${escape(s.title)}</h3><p>${escape(s.summary)}</p>${list(s.plans)}</section>`)
    .join("");
  panel.innerHTML = `
    <div class="placeholder">
      <h2>${escape(info.title)}</h2>
      <p class="coming-soon">Expected ${escape(info.eta)}</p>
      <p>${escape(info.summary)}</p>
      <h3>What it will do</h3>
      ${list(info.plans)}
      ${sections}
      <p class="starts-after">Work starts ${escape(info.startsAfter)}.</p>
    </div>`;
}
