// The print log (account features 5): a line for each print file saved from Slice for printing (the design's name
// then, the slicer's choices in words, the weight and time it worked out), and what the person later says about it:
// printed well, failed (with what went wrong from a short list) or not said yet, and a note. Kept in this browser's
// storage, so it works with no account and offline. With an account, `@fission/account` print-log.ts keeps the
// prints made while signed in (each carries its `owner`, the account id) in the account too, and tells a print
// deleted here from one new to this browser by the prints it last saw both sides hold.
//
// Every change reads the store again and changes only its own print, so another tab's changes survive. Entries this
// app can't read (a newer app's) are kept untouched when the log is written back.

/** What the person said about a print. */
export type PrintResult = "waiting" | "well" | "failed";

/** What went wrong, from a short list (the account's database holds the same list: supabase print_log.sql). */
export const PROBLEMS = [
  { id: "came-off", words: "Came off the plate" },
  { id: "warped", words: "Corners lifted or warped" },
  { id: "stringing", words: "Strings or blobs" },
  { id: "layer-shift", words: "Layers shifted" },
  { id: "spaghetti", words: "Turned into a tangle" },
  { id: "supports", words: "Supports failed or wouldn't come off" },
  { id: "gaps", words: "Gaps or thin layers" },
  { id: "wrong-size", words: "Wrong size or didn't fit" },
  { id: "stopped", words: "Stopped part way" },
  { id: "other", words: "Something else" },
] as const;
export type ProblemId = (typeof PROBLEMS)[number]["id"];

export interface PrintEntry {
  /** A random UUID, lower case: the same print on every device. */
  id: string;
  /** When the print file was saved (ISO 8601). */
  madeAt: string;
  /** The design's name then. */
  name: string;
  /** The slicer's choices in words (`settingsWords`). */
  settings: string;
  /** What the slicer worked out: grams of filament (to 0.1 g) and whole minutes of printing, or null. */
  grams: number | null;
  minutes: number | null;
  result: PrintResult;
  /** What went wrong: only when it failed, and only when one was picked. */
  problem: ProblemId | null;
  note: string;
  /** When it last changed here (ISO 8601): of two devices' changes, the later is kept. */
  updatedAt: string;
  /** The account it belongs to (made while signed in, or kept in the account by choice), or null: this browser's only. */
  owner: string | null;
}

/** Where the log is kept, and the account the prints made now belong to (set by the account's code while signed in
 * with the log kept in the account; nothing else writes it). */
export const PRINT_LOG_KEY = "spindlelabs.print-log";
export const PRINT_LOG_OWNER_KEY = "spindle.account.print-log-owner";
/** The event the page hears when a print goes into the log (`detail`: the print), so an open log and the account's sync see it at once. */
export const PRINT_LOGGED_EVENT = "spindlelabs-print-logged";
/** The stored shape's version: a store with a higher one was written by a newer app, which this one never overwrites. */
export const PRINT_LOG_VERSION = 1;

/** The limits, the same as the account's (supabase print_log.sql `print_log_limits`, checked by the tests). */
export const PRINT_LOG_LIMITS = { prints: 500, name: 100, settings: 200, note: 500 } as const;

/** The log as kept: the prints this app reads (newest made first), the entries it keeps without reading, and
 * whether it may write the store back. */
export interface PrintLog {
  prints: PrintEntry[];
  kept: unknown[];
  writable: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isTime = (t: unknown): t is string => typeof t === "string" && /^\d{4}-\d{2}-\d{2}T/.test(t) && Number.isFinite(Date.parse(t));
const isProblem = (p: unknown): p is ProblemId => PROBLEMS.some((x) => x.id === p);
const codePoints = (s: string) => [...s].length;
/** `s` cut to at most `n` characters (code points, as the database counts them). */
export const cut = (s: string, n: number) => (codePoints(s) <= n ? s : [...s].slice(0, n).join(""));

/** One print as stored or as the account gives it, or null when it isn't one this app can read. */
export function printFrom(raw: unknown): PrintEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID.test(r.id) || !isTime(r.madeAt) || !isTime(r.updatedAt)) return null;
  if (typeof r.name !== "string" || codePoints(r.name) < 1 || codePoints(r.name) > PRINT_LOG_LIMITS.name) return null;
  if (typeof r.settings !== "string" || codePoints(r.settings) > PRINT_LOG_LIMITS.settings) return null;
  if (typeof r.note !== "string" || codePoints(r.note) > PRINT_LOG_LIMITS.note) return null;
  const amount = (v: unknown, max: number) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);
  if (!amount(r.grams, 100000) || !amount(r.minutes, 100000) || (typeof r.minutes === "number" && !Number.isInteger(r.minutes))) return null;
  if (r.result !== "waiting" && r.result !== "well" && r.result !== "failed") return null;
  if (r.problem !== null && !(r.result === "failed" && isProblem(r.problem))) return null;
  if (r.owner !== null && typeof r.owner !== "string") return null;
  return { id: r.id, madeAt: r.madeAt, name: r.name, settings: r.settings, grams: r.grams as number | null, minutes: r.minutes as number | null, result: r.result, problem: r.problem as ProblemId | null, note: r.note, updatedAt: r.updatedAt, owner: r.owner as string | null };
}

const newestFirst = (a: PrintEntry, b: PrintEntry) => Date.parse(b.madeAt) - Date.parse(a.madeAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The log kept in `storage`: empty when nothing is kept, the text is not ours, or storage is blocked. Never throws. */
export function readLog(storage: Pick<Storage, "getItem"> | null): PrintLog {
  let text: string | null = null;
  try {
    text = storage?.getItem(PRINT_LOG_KEY) ?? null;
  } catch {
    return { prints: [], kept: [], writable: false };
  }
  const empty = { prints: [], kept: [], writable: true };
  if (text === null) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty;
  }
  const d = data as { version?: unknown; prints?: unknown } | null;
  if (typeof d !== "object" || d === null || !Array.isArray(d.prints)) return empty;
  if (typeof d.version !== "number" || d.version > PRINT_LOG_VERSION) return { prints: [], kept: [], writable: false };
  const prints: PrintEntry[] = [];
  const kept: unknown[] = [];
  const ids = new Set<string>();
  for (const raw of d.prints) {
    const p = printFrom(raw);
    if (p && !ids.has(p.id)) {
      ids.add(p.id);
      prints.push(p);
    } else if (!p) kept.push(raw);
  }
  return { prints: prints.sort(newestFirst), kept, writable: true };
}

/** Writes `log` to `storage`; false when it can't (blocked, full, or written by a newer app). */
export function writeLog(storage: Store | null, log: PrintLog): boolean {
  if (!storage || !log.writable) return false;
  try {
    storage.setItem(PRINT_LOG_KEY, JSON.stringify({ version: PRINT_LOG_VERSION, prints: [...[...log.prints].sort(newestFirst), ...log.kept] }));
    return true;
  } catch {
    return false;
  }
}

/** The account prints made now belong to, or null (signed out, or the log not kept in the account). */
export function currentOwner(storage: Pick<Storage, "getItem"> | null): string | null {
  try {
    const o = storage?.getItem(PRINT_LOG_OWNER_KEY) ?? null;
    return o && o.length <= 100 ? o : null;
  } catch {
    return null;
  }
}

/** `log` without `p`. */
const without = (log: PrintLog, p: PrintEntry): PrintLog => ({ ...log, prints: log.prints.filter((x) => x.id !== p.id) });

/** What a saved print file was, as Slice for printing knows it. */
export interface PrintMade {
  name: string;
  settings: string;
  /** Grams and seconds as the slicer worked them out (any number: rounded and checked here). */
  grams?: number | null;
  seconds?: number | null;
}

/** A new random id (lower case UUID). */
export const newPrintId = (): string => globalThis.crypto.randomUUID().toLowerCase();

/** The print for `made` at `now`, belonging to `owner`. */
export function printOf(made: PrintMade, now: Date, owner: string | null, id = newPrintId()): PrintEntry {
  const name = cut(made.name.trim() || "Untitled", PRINT_LOG_LIMITS.name);
  const grams = typeof made.grams === "number" && Number.isFinite(made.grams) && made.grams >= 0 ? Math.min(100000, Math.round(made.grams * 10) / 10) : null;
  const minutes = typeof made.seconds === "number" && Number.isFinite(made.seconds) && made.seconds >= 0 ? Math.min(100000, Math.round(made.seconds / 60)) : null;
  const at = now.toISOString();
  return { id, madeAt: at, name, settings: cut(made.settings, PRINT_LOG_LIMITS.settings), grams, minutes, result: "waiting", problem: null, note: "", updatedAt: at, owner };
}

/** Adds a print for `made` to the log in `storage` (the oldest goes when 500 are kept); gives it, or null when the
 * log can't be written. */
export function addPrint(storage: Store | null, made: PrintMade, now: Date, id?: string): { print: PrintEntry; dropped: PrintEntry | null } | null {
  let log = readLog(storage);
  const print = printOf(made, now, currentOwner(storage), id);
  let dropped: PrintEntry | null = null;
  while (log.prints.length >= PRINT_LOG_LIMITS.prints) {
    dropped = log.prints[log.prints.length - 1];
    log = without(log, dropped);
  }
  log = { ...log, prints: [print, ...log.prints] };
  return writeLog(storage, log) ? { print, dropped } : null;
}

/** What can change about a print: the result, the problem (dropped unless failed) and the note (cut to 500). */
export interface PrintChange {
  result?: PrintResult;
  problem?: ProblemId | null;
  note?: string;
}

/** The print `p` changed by `change` at `now`; `p` itself when nothing changes. */
export function changedPrint(p: PrintEntry, change: PrintChange, now: Date): PrintEntry {
  const result = change.result ?? p.result;
  const problem = result === "failed" ? (change.problem !== undefined ? (isProblem(change.problem) ? change.problem : null) : p.problem) : null;
  const note = change.note !== undefined ? cut(change.note, PRINT_LOG_LIMITS.note) : p.note;
  if (result === p.result && problem === p.problem && note === p.note) return p;
  // Never earlier than the last change, so a change made on a clock that went back still counts as the later.
  const at = new Date(Math.max(now.getTime(), Date.parse(p.updatedAt) + 1)).toISOString();
  return { ...p, result, problem, note, updatedAt: at };
}

/** Changes the print `id` in `storage`; gives it as changed, or null when it is gone or the log can't be written. */
export function changePrint(storage: Store | null, id: string, change: PrintChange, now: Date): PrintEntry | null {
  const log = readLog(storage);
  const p = log.prints.find((x) => x.id === id);
  if (!p) return null;
  const next = changedPrint(p, change, now);
  if (next === p) return p;
  return writeLog(storage, { ...log, prints: log.prints.map((x) => (x.id === id ? next : x)) }) ? next : null;
}

/** Deletes the print `id` from `storage`; false when it was gone or can't be written. */
export function removePrint(storage: Store | null, id: string): boolean {
  const log = readLog(storage);
  const p = log.prints.find((x) => x.id === id);
  return p ? writeLog(storage, without(log, p)) : false;
}

/** Makes every print kept only in this browser `owner`'s (Keep these in my account); gives how many. */
export function claimPrints(storage: Store | null, owner: string, now: Date): number {
  const log = readLog(storage);
  const mine = log.prints.filter((p) => p.owner === null);
  if (mine.length === 0) return 0;
  const at = now.toISOString();
  return writeLog(storage, { ...log, prints: log.prints.map((p) => (p.owner === null ? { ...p, owner, updatedAt: at > p.updatedAt ? at : p.updatedAt } : p)) }) ? mine.length : 0;
}

/** The slicer's choices in words, as the log keeps them: "0.2 mm layers, 2 walls, 15% infill, no supports, standard nozzle". */
export function settingsWords(choices: { layerHeight: number; walls: number; infill: number; supports: string }, nozzle: string): string {
  const supports = choices.supports === "off" ? "no supports" : `${choices.supports} supports`;
  const walls = `${choices.walls} wall${choices.walls === 1 ? "" : "s"}`;
  return cut(`${choices.layerHeight} mm layers, ${walls}, ${choices.infill}% infill, ${supports}, ${nozzle === "high-flow" ? "high flow" : "standard"} nozzle`, PRINT_LOG_LIMITS.settings);
}

/** The log's counts in words: "12 prints: 9 printed well, 2 failed, 1 not said yet". */
export function summaryWords(prints: readonly PrintEntry[]): string {
  if (prints.length === 0) return "No prints yet.";
  const n = (r: PrintResult) => prints.filter((p) => p.result === r).length;
  const parts = [n("well") ? `${n("well")} printed well` : "", n("failed") ? `${n("failed")} failed` : "", n("waiting") ? `${n("waiting")} not said yet` : ""].filter(Boolean);
  return `${prints.length} print${prints.length === 1 ? "" : "s"}: ${parts.join(", ")}.`;
}

/** The words for a problem id. */
export const problemWords = (id: ProblemId | null): string => PROBLEMS.find((p) => p.id === id)?.words ?? "";
