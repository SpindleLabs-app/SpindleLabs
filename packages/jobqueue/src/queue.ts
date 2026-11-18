// The job queue's rules (step Q1, docs/progress/queue.md): a student sends a print or laser job, the file check passes
// or refuses it, the teacher approves it or sends it back with a reason, approved jobs wait in a queue per machine, and
// the teacher starts and finishes them, recording the time and material used. Plain functions on plain data: no page,
// no network, no clock (every action carries its time). `apply` never throws; a move that is not allowed is refused
// with its kind and the queue is left as it was.
//
// Personal data (minors use this): a student is an id and the display name the teacher typed. Nothing else about a
// person is kept here, and `studentView` never shows one student another's name or file.

export type JobKind = "print" | "laser";

/** One machine in the makerspace. Jobs name it by id; its kind says which jobs it takes. */
export interface Machine {
  id: string;
  name: string;
  kind: JobKind;
}

/** What the material is counted in: grams of filament for a print, square millimetres of sheet for a laser. */
export type AmountUnit = "g" | "mm2";

export const UNIT_OF_KIND: Readonly<Record<JobKind, AmountUnit>> = { print: "g", laser: "mm2" };

export type JobState =
  | "checking" // sent; the file check (Q2) has not answered
  | "check-failed" // the file check refused it, with its reason
  | "waiting" // the check passed; waiting for the teacher
  | "returned" // the teacher sent it back with a reason (the student sends a new job)
  | "queued" // approved; waiting in its machine's queue
  | "running" // on the machine
  | "done"
  | "failed" // the run failed; the teacher may put it back at the front of the queue
  | "withdrawn"; // the student took it back before it ran

/** States a job never leaves. */
export const FINAL_STATES: readonly JobState[] = ["returned", "done", "withdrawn"];

/** An estimate or a record of use; null where it is not known ("not yet", never a made-up number). */
export interface Use {
  minutes: number | null;
  amount: number | null;
}

/** One run on the machine as the teacher finished it. Parts of `used` left null fall back to the estimate in totals. */
export interface Run {
  at: number;
  outcome: "done" | "failed";
  used: Use;
}

export interface HistoryLine {
  at: number;
  to: JobState;
  by: "student" | "teacher" | "check";
}

export interface Job {
  id: string;
  kind: JobKind;
  machine: string;
  student: string;
  fileName: string;
  fileBytes: number;
  material: string;
  estimate: Use;
  state: JobState;
  /** The check's or the teacher's reason, for check-failed, returned and failed. */
  reason: string | null;
  /** What the file check said beyond passed or refused (Q2): its facts and the things to look at, for the teacher. */
  notes: string[];
  /** Every finished run (a failed run put back in the queue keeps its run here), oldest first. */
  runs: Run[];
  sentAt: number;
  history: HistoryLine[];
}

export interface Queue {
  machines: Machine[];
  /** Display names the teacher typed, by student id. */
  students: Record<string, string>;
  jobs: Job[];
  /** The queued jobs of each machine, first to run first. */
  order: Record<string, string[]>;
  nextNumber: number;
}

export type Actor = { role: "teacher" } | { role: "student"; id: string } | { role: "check" };

export interface JobDraft {
  machine: string;
  fileName: string;
  fileBytes: number;
  material: string;
  estimate: Use;
}

export type Action =
  | { kind: "send"; by: Actor; at: number; job: JobDraft }
  | { kind: "check"; by: Actor; at: number; id: string; passed: boolean; reason?: string; estimate?: Use; notes?: string[] }
  | { kind: "approve"; by: Actor; at: number; id: string }
  | { kind: "return"; by: Actor; at: number; id: string; reason: string }
  | { kind: "withdraw"; by: Actor; at: number; id: string }
  | { kind: "move"; by: Actor; at: number; id: string; to: number }
  | { kind: "start"; by: Actor; at: number; id: string }
  | { kind: "finish"; by: Actor; at: number; id: string; outcome: "done" | "failed"; used?: Use; reason?: string }
  | { kind: "requeue"; by: Actor; at: number; id: string };

export type RefusalKind = "bad-input" | "not-found" | "not-allowed" | "wrong-state" | "machine-busy";

export interface Refusal {
  kind: RefusalKind;
  /** Which field or rule, for bad-input; the job's state for wrong-state. */
  detail: string;
}

export type Answer = { ok: true; queue: Queue; id: string } | { ok: false; refusal: Refusal };

export const QUEUE_LIMITS = {
  /** Largest job file: 50 MiB. A school P1S job or a laser drawing is far smaller; bigger is a mistake or abuse. */
  fileBytes: 50 * 1024 * 1024,
  fileNameChars: 120,
  displayNameChars: 40,
  materialChars: 60,
  reasonChars: 300,
  /** Most notes the file check may leave on a job, each up to `reasonChars`. */
  notes: 20,
  /** Longest estimate or record a job may carry: one week of machine time. */
  minutes: 7 * 24 * 60,
  /** Most material one job may carry: 5 kg of filament, or a whole 1400 × 900 mm sheet five times over. */
  amount: { g: 5000, mm2: 5 * 1400 * 900 } as Record<AmountUnit, number>,
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** A short text a person typed: trimmed, 1 to `max` characters, no control characters. Null if it is not one. */
export function cleanText(text: unknown, max: number): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t.length === 0 || [...t].length > max || CONTROL.test(t)) return null;
  return t;
}

/** A new, empty queue for these machines. Null if a machine is malformed or two share an id. */
export function newQueue(machines: Machine[]): Queue | null {
  const seen = new Set<string>();
  for (const m of machines) {
    if (cleanText(m.id, 40) !== m.id || cleanText(m.name, 60) === null || (m.kind !== "print" && m.kind !== "laser")) return null;
    if (seen.has(m.id)) return null;
    seen.add(m.id);
  }
  const order: Record<string, string[]> = {};
  for (const m of machines) order[m.id] = [];
  return { machines: machines.map((m) => ({ ...m })), students: {}, jobs: [], order, nextNumber: 1 };
}

/** Adds or renames a student (the teacher's typing). Null if the id or name is not acceptable. */
export function withStudent(queue: Queue, id: string, displayName: string): Queue | null {
  const name = cleanText(displayName, QUEUE_LIMITS.displayNameChars);
  if (cleanText(id, 40) !== id || name === null) return null;
  const next = structuredClone(queue);
  next.students[id] = name;
  return next;
}

function useProblem(use: unknown, unit: AmountUnit): string | null {
  if (typeof use !== "object" || use === null) return "estimate";
  const u = use as Use;
  for (const [field, value, max] of [
    ["minutes", u.minutes, QUEUE_LIMITS.minutes],
    ["amount", u.amount, QUEUE_LIMITS.amount[unit]],
  ] as const) {
    if (value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return field;
  }
  return null;
}

function refuse(kind: RefusalKind, detail: string): Answer {
  return { ok: false, refusal: { kind, detail } };
}

/** Applies one action. The queue given is never changed; a refusal leaves it as it was. */
export function apply(queue: Queue, action: Action): Answer {
  if (typeof action.at !== "number" || !Number.isFinite(action.at) || action.at < 0) return refuse("bad-input", "at");
  if (action.kind === "send") return send(queue, action);
  const found = queue.jobs.find((j) => j.id === action.id);
  if (!found) return refuse("not-found", action.id);
  const by = action.by;
  const isTeacher = by.role === "teacher";
  const isOwner = by.role === "student" && by.id === found.student;
  const next = structuredClone(queue);
  const job = next.jobs.find((j) => j.id === found.id) as Job;
  const order = next.order[job.machine] as string[];
  const moveTo = (to: JobState, who: HistoryLine["by"]) => {
    job.state = to;
    job.history.push({ at: action.at, to, by: who });
  };
  const leaveOrder = () => {
    const i = order.indexOf(job.id);
    if (i >= 0) order.splice(i, 1);
  };
  const done: Answer = { ok: true, queue: next, id: job.id };

  switch (action.kind) {
    case "check": {
      if (by.role !== "check") return refuse("not-allowed", "check");
      if (job.state !== "checking") return refuse("wrong-state", job.state);
      const notes = action.notes ?? [];
      if (!Array.isArray(notes) || notes.length > QUEUE_LIMITS.notes) return refuse("bad-input", "notes");
      const clean = notes.map((n) => cleanText(n, QUEUE_LIMITS.reasonChars));
      if (clean.some((n) => n === null)) return refuse("bad-input", "notes");
      job.notes = clean as string[];
      if (action.passed) {
        if (action.estimate !== undefined) {
          const problem = useProblem(action.estimate, UNIT_OF_KIND[job.kind]);
          if (problem) return refuse("bad-input", problem);
          job.estimate = { ...action.estimate };
        }
        moveTo("waiting", "check");
      } else {
        const reason = cleanText(action.reason, QUEUE_LIMITS.reasonChars);
        if (reason === null) return refuse("bad-input", "reason");
        job.reason = reason;
        moveTo("check-failed", "check");
      }
      return done;
    }
    case "approve": {
      if (!isTeacher) return refuse("not-allowed", "approve");
      if (job.state !== "waiting") return refuse("wrong-state", job.state);
      order.push(job.id);
      moveTo("queued", "teacher");
      return done;
    }
    case "return": {
      if (!isTeacher) return refuse("not-allowed", "return");
      if (job.state !== "waiting" && job.state !== "queued") return refuse("wrong-state", job.state);
      const reason = cleanText(action.reason, QUEUE_LIMITS.reasonChars);
      if (reason === null) return refuse("bad-input", "reason");
      job.reason = reason;
      leaveOrder();
      moveTo("returned", "teacher");
      return done;
    }
    case "withdraw": {
      if (!isOwner) return refuse("not-allowed", "withdraw");
      if (!["checking", "check-failed", "waiting", "queued"].includes(job.state)) return refuse("wrong-state", job.state);
      leaveOrder();
      moveTo("withdrawn", "student");
      return done;
    }
    case "move": {
      if (!isTeacher) return refuse("not-allowed", "move");
      if (job.state !== "queued") return refuse("wrong-state", job.state);
      if (!Number.isInteger(action.to) || action.to < 0 || action.to >= order.length) return refuse("bad-input", "to");
      leaveOrder();
      order.splice(action.to, 0, job.id);
      return done;
    }
    case "start": {
      if (!isTeacher) return refuse("not-allowed", "start");
      if (job.state !== "queued") return refuse("wrong-state", job.state);
      if (next.jobs.some((j) => j.machine === job.machine && j.state === "running")) return refuse("machine-busy", job.machine);
      leaveOrder();
      moveTo("running", "teacher");
      return done;
    }
    case "finish": {
      if (!isTeacher) return refuse("not-allowed", "finish");
      if (job.state !== "running") return refuse("wrong-state", job.state);
      if (action.outcome !== "done" && action.outcome !== "failed") return refuse("bad-input", "outcome");
      const used: Use = action.used === undefined ? { minutes: null, amount: null } : action.used;
      const problem = useProblem(used, UNIT_OF_KIND[job.kind]);
      if (problem) return refuse("bad-input", problem);
      if (action.outcome === "failed") {
        const reason = cleanText(action.reason, QUEUE_LIMITS.reasonChars);
        if (reason === null) return refuse("bad-input", "reason");
        job.reason = reason;
      }
      job.runs.push({ at: action.at, outcome: action.outcome, used: { minutes: used.minutes, amount: used.amount } });
      moveTo(action.outcome, "teacher");
      return done;
    }
    case "requeue": {
      if (!isTeacher) return refuse("not-allowed", "requeue");
      if (job.state !== "failed") return refuse("wrong-state", job.state);
      // The failed run stays in `runs` (its time and material were really used); the next run is recorded apart.
      job.reason = null;
      order.unshift(job.id);
      moveTo("queued", "teacher");
      return done;
    }
    default:
      return refuse("bad-input", "kind");
  }
}

function send(queue: Queue, action: Extract<Action, { kind: "send" }>): Answer {
  const by = action.by;
  if (by.role !== "student") return refuse("not-allowed", "send");
  if (!(by.id in queue.students)) return refuse("not-found", by.id);
  const draft = action.job;
  if (typeof draft !== "object" || draft === null) return refuse("bad-input", "job");
  const machine = queue.machines.find((m) => m.id === draft.machine);
  if (!machine) return refuse("not-found", String(draft.machine));
  const fileName = cleanText(draft.fileName, QUEUE_LIMITS.fileNameChars);
  if (fileName === null) return refuse("bad-input", "fileName");
  if (!Number.isInteger(draft.fileBytes) || draft.fileBytes < 1 || draft.fileBytes > QUEUE_LIMITS.fileBytes) {
    return refuse("bad-input", "fileBytes");
  }
  const material = cleanText(draft.material, QUEUE_LIMITS.materialChars);
  if (material === null) return refuse("bad-input", "material");
  const problem = useProblem(draft.estimate, UNIT_OF_KIND[machine.kind]);
  if (problem) return refuse("bad-input", problem);
  const next = structuredClone(queue);
  const id = `job-${next.nextNumber}`;
  next.nextNumber += 1;
  next.jobs.push({
    id,
    kind: machine.kind,
    machine: machine.id,
    student: by.id,
    fileName,
    fileBytes: draft.fileBytes,
    material,
    estimate: { minutes: draft.estimate.minutes, amount: draft.estimate.amount },
    state: "checking",
    reason: null,
    notes: [],
    runs: [],
    sentAt: action.at,
    history: [{ at: action.at, to: "checking", by: "student" }],
  });
  return { ok: true, queue: next, id };
}

/** A queued job's place: 1 is next. How many jobs are ahead and their estimated minutes (unknown ones counted apart). */
export interface Place {
  place: number;
  ahead: number;
  minutesAhead: number;
  unknownAhead: number;
  /** A job is running on the machine now (its time is not counted in minutesAhead). */
  machineBusy: boolean;
}

export function placeOf(queue: Queue, id: string): Place | null {
  const job = queue.jobs.find((j) => j.id === id);
  if (!job || job.state !== "queued") return null;
  const order = queue.order[job.machine] ?? [];
  const i = order.indexOf(id);
  if (i < 0) return null;
  let minutesAhead = 0;
  let unknownAhead = 0;
  for (const otherId of order.slice(0, i)) {
    const m = queue.jobs.find((j) => j.id === otherId)?.estimate.minutes ?? null;
    if (m === null) unknownAhead += 1;
    else minutesAhead += m;
  }
  const machineBusy = queue.jobs.some((j) => j.machine === job.machine && j.state === "running");
  return { place: i + 1, ahead: i, minutesAhead, unknownAhead, machineBusy };
}

/** What one student may see: their own jobs (with their places), and how long each machine's queue is. Never another's name or file. */
export interface StudentView {
  name: string;
  jobs: { job: Job; place: Place | null }[];
  queueLengths: Record<string, number>;
}

export function studentView(queue: Queue, studentId: string): StudentView | null {
  const name = queue.students[studentId];
  if (name === undefined) return null;
  const jobs = queue.jobs.filter((j) => j.student === studentId).map((j) => ({ job: structuredClone(j), place: placeOf(queue, j.id) }));
  const queueLengths: Record<string, number> = {};
  for (const m of queue.machines) queueLengths[m.id] = (queue.order[m.id] ?? []).length;
  return { name, jobs, queueLengths };
}

/** Time and material used by every finished run (done or failed, including failed runs put back in the queue): the recorded use where the teacher gave it, else the job's estimate. */
export interface Total {
  done: number;
  failed: number;
  minutes: number;
  amount: number;
  /** Finished runs whose minutes or amount came from the estimate, not a record. */
  estimated: number;
  /** Finished runs with no number at all for minutes or amount (left out of the sums). */
  unknown: number;
}

function emptyTotal(): Total {
  return { done: 0, failed: 0, minutes: 0, amount: 0, estimated: 0, unknown: 0 };
}

function addRun(total: Total, job: Job, run: Run): void {
  if (run.outcome === "done") total.done += 1;
  else total.failed += 1;
  let estimated = false;
  let unknown = false;
  for (const field of ["minutes", "amount"] as const) {
    const recorded = run.used[field];
    const value = recorded ?? job.estimate[field];
    if (recorded === null && value !== null) estimated = true;
    if (value === null) unknown = true;
    else total[field] += value;
  }
  if (estimated) total.estimated += 1;
  if (unknown) total.unknown += 1;
}

export function totals(queue: Queue): { byMachine: Record<string, Total>; byStudent: Record<string, Total> } {
  const byMachine: Record<string, Total> = {};
  const byStudent: Record<string, Total> = {};
  for (const m of queue.machines) byMachine[m.id] = emptyTotal();
  for (const job of queue.jobs) {
    for (const run of job.runs) {
      addRun(byMachine[job.machine] as Total, job, run);
      byStudent[job.student] ??= emptyTotal();
      addRun(byStudent[job.student] as Total, job, run);
    }
  }
  return { byMachine, byStudent };
}

/** A plain sentence for every refusal, for the page (Q3). */
export function refusalWords(r: Refusal): string {
  switch (r.kind) {
    case "not-found":
      return "That job, machine or student isn't in this queue.";
    case "not-allowed":
      return "Only the teacher can do that, or a student with their own job.";
    case "wrong-state":
      return `That can't be done to a job that is ${STATE_WORDS[r.detail as JobState] ?? "in this state"}.`;
    case "machine-busy":
      return "That machine is already running a job. Finish it first.";
    case "bad-input":
      return `Check the ${FIELD_WORDS[r.detail] ?? "details"} and try again.`;
  }
}

export const STATE_WORDS: Readonly<Record<JobState, string>> = {
  checking: "being checked",
  "check-failed": "refused by the file check",
  waiting: "waiting for the teacher",
  returned: "sent back by the teacher",
  queued: "in the queue",
  running: "on the machine",
  done: "done",
  failed: "failed on the machine",
  withdrawn: "withdrawn",
};

const FIELD_WORDS: Record<string, string> = {
  at: "time",
  job: "job",
  fileName: "file name (up to 120 characters)",
  fileBytes: "file size (up to 50 MB)",
  material: "material (up to 60 characters)",
  estimate: "estimate",
  minutes: "time (up to a week)",
  amount: "amount of material",
  reason: "reason (1 to 300 characters)",
  notes: "check's notes (up to 20, each 1 to 300 characters)",
  to: "place in the queue",
  outcome: "outcome",
  kind: "action",
};
