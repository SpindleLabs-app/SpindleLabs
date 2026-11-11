// Report a bug (Ben, 2026-11-04; made easier 2026-11-11): one optional box,
// the person's design attached (ticked by default), and the facts a person
// wouldn't think to type (version, browser, screen, workspace, the recent
// errors). With a report address (`endpoint`, the report service: a small
// server that files it privately, so no GitHub account is needed) Send posts
// it there; with none, or when sending fails, the form opens a filled-in
// issue on SpindleLabs' public GitHub page instead (it needs a free GitHub
// account) and downloads the design as a file to drag into it, since a link
// can't carry a file. Pure, but for the dialog (`bugReportDialog`).

/** The report service's address: "" until the server is set up (Ben's call), so reports go to GitHub. */
export const BUG_REPORT_SERVICE = "";
/** Where a new issue is opened. */
export const ISSUES_NEW = "https://github.com/SpindleLabs-app/SpindleLabs/issues/new";
/** The longest link opened: browsers and GitHub take about 8,000 characters; past this the longest part is cut. */
export const MAX_REPORT_URL = 7000;
/** Why the form won't send an empty report: nothing typed and no design. */
export const BUG_REPORT_EMPTY = "Say what happened, or include your design.";
/** The largest design sent or downloaded with a report, in bytes (UTF-8): 5 MiB, as a design kept in an account. */
export const MAX_DESIGN_BYTES = 5 * 1024 * 1024;
const CUT = "\n\n(cut to fit the link: paste the rest into the issue)";

export interface BugReport {
  /** What happened, as typed (may be empty): its first line is the title. */
  what: string;
  /** Filled in by the app. */
  version: string;
  browser: string;
  screen: string;
  workspace: string;
  /** The last few errors the page saw, newest last. */
  errors: string[];
  /** How the design comes with the report, in words (`bugDesignFile`'s note). */
  design: string;
}

/** The design as a file to send or download. */
export interface DesignFile {
  name: string;
  text: string;
}

/** "Bug: " and the first line of `what`, at most 80 characters of it; with nothing typed, where it came from. */
export function bugReportTitle(what: string, workspace: string): string {
  const first = what.trim().split("\n")[0].trim();
  if (first === "") return `Bug report from ${workspace}`;
  return `Bug: ${first.length > 80 ? `${first.slice(0, 79)}…` : first}`;
}

/** The issue's body: what happened, the app's facts, the design's line, then the recent errors when there are any. */
export function bugReportBody(r: BugReport): string {
  const parts = [
    `### What happened\n\n${r.what.trim() || "(not given)"}`,
    `### About\n\n- Version: ${r.version}\n- Browser: ${r.browser}\n- Screen: ${r.screen}\n- Workspace: ${r.workspace}`,
    `### Design\n\n${r.design}`,
  ];
  if (r.errors.length > 0) parts.push(`### Recent errors\n\n\`\`\`\n${r.errors.join("\n")}\n\`\`\``);
  parts.push("_Sent from SpindleLabs' Report a bug._");
  return parts.join("\n\n");
}

const MIB = 1024 * 1024;
const mb = (bytes: number) => `${Math.round((bytes / MIB) * 10) / 10} MB`;

/**
 * The design as the report's file, or why there is none: the person unticked
 * it, nothing is open, or it is over MAX_DESIGN_BYTES. `note` is the body's
 * Design line. A name with characters no file name can hold has them as "-".
 */
export function bugDesignFile(design: DesignFile | null, include: boolean): { file: DesignFile | null; note: string } {
  if (!include) return { file: null, note: "Not included (the person chose not to)." };
  if (design === null) return { file: null, note: "No design open." };
  const bytes = new TextEncoder().encode(design.text).length;
  if (bytes > MAX_DESIGN_BYTES) return { file: null, note: `Too big to send (${mb(bytes)}; the limit is ${mb(MAX_DESIGN_BYTES)}).` };
  const base = design.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "Untitled";
  const name = `${base}.spindle.json`;
  return { file: { name, text: design.text }, note: `Attached: ${name} (${Math.max(1, Math.ceil(bytes / 1024))} KB).` };
}

/** What the report service is sent. */
export interface BugPayload {
  title: string;
  body: string;
  design: DesignFile | null;
}

/** The report for the report service; refused when nothing is typed and no design comes along. */
export function bugReportPayload(r: BugReport, file: DesignFile | null): { payload: BugPayload } | { refused: string } {
  if (r.what.trim() === "" && file === null) return { refused: BUG_REPORT_EMPTY };
  return { payload: { title: bugReportTitle(r.what, r.workspace), body: bugReportBody(r), design: file } };
}

const linkOf = (r: BugReport) => `${ISSUES_NEW}?title=${encodeURIComponent(bugReportTitle(r.what, r.workspace))}&body=${encodeURIComponent(bugReportBody(r))}`;

/**
 * The new GitHub issue's link for `r`; refused when nothing is typed and no
 * design comes along (`withDesign`). A link past MAX_REPORT_URL has what
 * happened cut until it fits, the cut said in the body (`cut`).
 */
export function bugReportUrl(r: BugReport, withDesign = true): { url: string; cut: boolean } | { refused: string } {
  if (r.what.trim() === "" && !withDesign) return { refused: BUG_REPORT_EMPTY };
  let url = linkOf(r);
  if (url.length <= MAX_REPORT_URL) return { url, cut: false };
  const cut = { ...r, errors: [...r.errors] };
  for (let tries = 0; url.length > MAX_REPORT_URL && tries < 64; tries++) {
    // The errors go first (oldest first), then what happened is cut.
    if (cut.errors.length > 0) cut.errors.shift();
    else {
      const over = url.length - MAX_REPORT_URL;
      const text = cut.what.endsWith(CUT) ? cut.what.slice(0, -CUT.length) : cut.what;
      // Each character takes at least one in the link, so cutting `over` of them (and the note's room) brings it under.
      cut.what = text.slice(0, Math.max(0, text.length - over - CUT.length)) + CUT;
    }
    url = linkOf(cut);
  }
  return { url, cut: true };
}

/** Posts `payload` as JSON to the report service: its answer is `{ issue: number }`. Never throws; a failure is said in words. */
export async function sendBugReport(endpoint: string, payload: BugPayload, fetchFn: typeof fetch = fetch): Promise<{ sent: number } | { failed: string }> {
  let res: Response;
  try {
    res = await fetchFn(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    return { failed: "Couldn't reach the report service." };
  }
  if (res.status === 429) return { failed: "Too many reports from here just now." };
  if (!res.ok) return { failed: `The report service had a problem (${res.status}).` };
  try {
    const answer: unknown = await res.json();
    const issue = (answer as { issue?: unknown } | null)?.issue;
    if (typeof issue === "number" && Number.isInteger(issue) && issue > 0) return { sent: issue };
  } catch {
    // falls through to the unreadable answer
  }
  return { failed: "The report service gave an answer we couldn't read." };
}

/** What the app fills in itself, read as a report is made. */
export type BugFacts = Pick<BugReport, "version" | "browser" | "screen" | "workspace" | "errors">;

export interface BugDialogHooks {
  facts(): BugFacts;
  /** The open design as project text and its name, or null when there is none. */
  design(): DesignFile | null;
  /** Opens a link in a new tab. */
  open(url: string): void;
  /** Downloads a file to the person's device. */
  download(name: string, text: string): void;
  /** The report service's address; "" until there is one, so reports go to GitHub. */
  endpoint: string;
  fetch?: typeof fetch;
}

const NOTE_SEND = "Your words, your design (when ticked), your version, browser, screen and any recent errors go privately to the SpindleLabs team. No account needed.";
const NOTE_GITHUB = "This opens a new issue on SpindleLabs' GitHub page, filled in, for you to check and submit (it needs a free GitHub account). Issues there are public: your design (when ticked) downloads as a file for you to drag into the issue, where anyone can see it. Your version, browser, screen and any recent errors are added.";

/**
 * The Report a bug dialog in `doc`: one optional box (what happened), the
 * Include my design tick (on), a note saying where it goes and who can see
 * it, and Send (to `hooks.endpoint`) or Open on GitHub. A failed send keeps
 * everything and turns the button into Open on GitHub, pressed again by the
 * person (a tab opened after a wait would be blocked). Cancel, Escape and a
 * tap outside leave it; the words typed stay until the page closes. Styled
 * as Settings (settings.css) with `styles/bug-report.css`.
 */
export function bugReportDialog(doc: Document, hooks: BugDialogHooks): { show(): void; send(): Promise<void>; dialog: HTMLDialogElement } {
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
  const field = el("label", "bug-report-field");
  field.append(el("span", undefined, "What happened? (optional)"));
  const what = el("textarea");
  what.id = "bug-report-what";
  what.rows = 3;
  what.placeholder = "Extruding a circle made nothing";
  field.append(what);
  const tick = el("label", "bug-report-tick");
  const include = el("input");
  include.type = "checkbox";
  include.id = "bug-report-design";
  include.checked = true;
  tick.append(include, el("span", undefined, "Include my design, so the problem can be seen"));
  const note = el("p", "bug-report-note");
  note.id = "bug-report-note";
  const status = el("p", "bug-report-status");
  status.id = "bug-report-status";
  status.setAttribute("role", "status");
  const actions = el("div", "bug-report-actions");
  const cancel = el("button", "close", "Cancel");
  cancel.type = "button";
  cancel.id = "bug-report-cancel";
  const go = el("button", "settings-action bug-report-go");
  go.type = "button";
  go.id = "bug-report-go";
  actions.append(cancel, go);
  body.append(field, tick, note, status);
  dialog.append(header, body, actions);
  doc.body.append(dialog);

  // What the button does next: send to the service, open on GitHub, or close after a sent report.
  let mode: "send" | "github" | "done" = "send";
  const setMode = (m: typeof mode) => {
    mode = m;
    go.textContent = m === "send" ? "Send" : m === "github" ? "Open on GitHub" : "Done";
    note.textContent = m === "github" ? NOTE_GITHUB : NOTE_SEND;
    status.classList.toggle("bug-report-good", m === "done");
  };
  const firstMode = () => (hooks.endpoint === "" ? "github" : "send");

  const make = () => {
    const { file, note: designNote } = bugDesignFile(include.checked ? hooks.design() : null, include.checked);
    return { file, r: { what: what.value, ...hooks.facts(), design: designNote } satisfies BugReport };
  };

  const toGithub = () => {
    const { file, r } = make();
    const shown = file === null ? r : { ...r, design: `${r.design.replace(/^Attached: /, "Your design was downloaded as ").replace(/\.$/, "")}: drag it into this issue to attach it (anyone can see it here).` };
    const made = bugReportUrl(shown, file !== null);
    if ("refused" in made) {
      status.textContent = made.refused;
      what.focus();
      return;
    }
    if (file !== null) hooks.download(file.name, file.text);
    hooks.open(made.url);
    status.textContent = "";
    dialog.close();
    setMode(firstMode());
  };

  let busy = false;
  const send = async () => {
    if (busy) return;
    if (mode === "done") {
      dialog.close();
      setMode(firstMode());
      return;
    }
    if (mode === "github") return toGithub();
    const { file, r } = make();
    const made = bugReportPayload(r, file);
    if ("refused" in made) {
      status.textContent = made.refused;
      what.focus();
      return;
    }
    busy = true;
    go.disabled = true;
    status.textContent = "Sending…";
    const answer = await sendBugReport(hooks.endpoint, made.payload, hooks.fetch);
    busy = false;
    go.disabled = false;
    if ("sent" in answer) {
      what.value = "";
      setMode("done");
      status.textContent = `Sent as report ${answer.sent}. Thank you!`;
    } else {
      setMode("github");
      status.textContent = `${answer.failed} You can open it on GitHub instead.`;
    }
  };

  setMode(firstMode());
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  // Its keys stay in it: a tool key can't act behind the form.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  go.addEventListener("click", () => void send());
  return {
    dialog,
    send,
    show() {
      status.textContent = "";
      // Each opening tries the service again, even after a failed send.
      setMode(firstMode());
      dialog.showModal();
      what.focus();
    },
  };
}
