// Report a bug (Ben, 2026-11-04): a small form whose words become a new
// issue on SpindleLabs' public GitHub repo, filled in and opened in a new
// tab for the person to check and send (they need a free GitHub account).
// No server and no key: nothing is sent until they press Submit on GitHub.
// Public for now (Ben, 2026-11-05): reports may move somewhere private
// later (a private repo behind a small server); only `ISSUES_NEW` and how
// the link is opened would change, the form stays.
// The app adds what a person wouldn't think to type (version, browser,
// screen, workspace) and nothing from their project. Pure, but for the
// dialog (`bugReportDialog`).

/** Where a new issue is opened. */
export const ISSUES_NEW = "https://github.com/SpindleLabs-app/SpindleLabs/issues/new";
/** The longest link opened: browsers and GitHub take about 8,000 characters; past this the longest part is cut. */
export const MAX_REPORT_URL = 7000;
/** Why the form won't open an empty report. */
export const BUG_REPORT_EMPTY = "Say what went wrong first.";
const CUT = "\n\n(cut to fit the link: paste the rest into the issue)";

export interface BugReport {
  /** What went wrong: its first line is the title. */
  what: string;
  steps: string;
  expected: string;
  /** Filled in by the app. */
  version: string;
  browser: string;
  screen: string;
  workspace: string;
}

/** "Bug: " and the first line of `what`, at most 80 characters of it. */
export function bugReportTitle(what: string): string {
  const first = what.trim().split("\n")[0].trim();
  return `Bug: ${first.length > 80 ? `${first.slice(0, 79)}…` : first}`;
}

const part = (text: string) => text.trim() || "(not given)";

/** The issue's body: the three parts under headings, then the app's facts. */
export function bugReportBody(r: BugReport): string {
  return [
    `### What went wrong\n\n${part(r.what)}`,
    `### Steps\n\n${part(r.steps)}`,
    `### What should have happened\n\n${part(r.expected)}`,
    `### About\n\n- Version: ${r.version}\n- Browser: ${r.browser}\n- Screen: ${r.screen}\n- Workspace: ${r.workspace}\n\n_Sent from SpindleLabs' Report a bug._`,
  ].join("\n\n");
}

const linkOf = (r: BugReport) => `${ISSUES_NEW}?title=${encodeURIComponent(bugReportTitle(r.what))}&body=${encodeURIComponent(bugReportBody(r))}`;

/**
 * The new issue's link for `r`; refused when nothing says what went wrong.
 * A link past MAX_REPORT_URL has its longest part cut until it fits, the
 * cut said in the body (`cut`).
 */
export function bugReportUrl(r: BugReport): { url: string; cut: boolean } | { refused: string } {
  if (r.what.trim() === "") return { refused: BUG_REPORT_EMPTY };
  let url = linkOf(r);
  if (url.length <= MAX_REPORT_URL) return { url, cut: false };
  const cut = { ...r };
  const keys = ["what", "steps", "expected"] as const;
  for (let tries = 0; url.length > MAX_REPORT_URL && tries < 64; tries++) {
    const longest = keys.reduce((a, b) => (cut[b].length > cut[a].length ? b : a));
    const over = url.length - MAX_REPORT_URL;
    const text = cut[longest].endsWith(CUT) ? cut[longest].slice(0, -CUT.length) : cut[longest];
    // Each character takes at least one in the link, so cutting `over` of them (and the note's room) brings it under.
    const keep = Math.max(0, text.length - over - CUT.length);
    cut[longest] = text.slice(0, keep) + CUT;
    url = linkOf(cut);
  }
  return { url, cut: true };
}

/** What the app fills in itself, read as the form opens. */
export type BugFacts = Pick<BugReport, "version" | "browser" | "screen" | "workspace">;

/**
 * The Report a bug dialog in `doc`: three boxes (what went wrong, the
 * steps, what should have happened), a note that the issue is public, and
 * Open on GitHub, which hands the link to `open` (a new tab) and closes it.
 * Cancel, Escape and a tap outside leave it; the words typed stay for next
 * time until the page closes. Styled as Settings (settings.css) with
 * `styles/bug-report.css` for its boxes.
 */
export function bugReportDialog(doc: Document, facts: () => BugFacts, open: (url: string) => void): { show(): void; dialog: HTMLDialogElement } {
  const dialog = Object.assign(doc.createElement("dialog"), { id: "bug-report", className: "settings bug-report" });
  dialog.setAttribute("aria-labelledby", "bug-report-title");
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const header = el("header", "settings-head");
  const h2 = el("h2", undefined, "Report a bug");
  h2.id = "bug-report-title";
  header.append(h2);
  const body = el("div", "settings-body bug-report-body");
  const box = (id: string, label: string, hint: string, rows: number) => {
    const wrap = el("label", "bug-report-field");
    wrap.append(el("span", undefined, label));
    const t = el("textarea");
    t.id = id;
    t.rows = rows;
    t.placeholder = hint;
    wrap.append(t);
    body.append(wrap);
    return t;
  };
  const what = box("bug-report-what", "What went wrong", "Extruding a circle made nothing", 3);
  const steps = box("bug-report-steps", "Steps to make it happen", "1. Draw a circle  2. Extrude 10 mm", 3);
  const expected = box("bug-report-expected", "What should have happened", "A cylinder 10 mm tall", 2);
  const note = el("p", "bug-report-note", "This opens a new issue on SpindleLabs' GitHub page, filled in, for you to check and submit (it needs a free GitHub account). Issues there are public, so leave out anything private. Your version, browser and screen size are added.");
  const status = el("p", "bug-report-status");
  status.id = "bug-report-status";
  status.setAttribute("role", "status");
  const actions = el("div", "bug-report-actions");
  const cancel = el("button", "close", "Cancel");
  cancel.type = "button";
  cancel.id = "bug-report-cancel";
  const go = el("button", "settings-action bug-report-go", "Open on GitHub");
  go.type = "button";
  go.id = "bug-report-go";
  actions.append(cancel, go);
  body.append(note, status);
  dialog.append(header, body, actions);
  doc.body.append(dialog);
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  // Its keys stay in it: a tool key can't act behind the form.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  go.addEventListener("click", () => {
    const made = bugReportUrl({ what: what.value, steps: steps.value, expected: expected.value, ...facts() });
    if ("refused" in made) {
      status.textContent = made.refused;
      what.focus();
      return;
    }
    open(made.url);
    status.textContent = "";
    dialog.close();
  });
  return {
    dialog,
    show() {
      status.textContent = "";
      dialog.showModal();
      what.focus();
    },
  };
}
