// Step Q1: the job queue's rules (docs/progress/queue.md). Hand-worked sessions with the working shown, a refusal for
// every move that is not allowed, the 0.9× / 1.1× boundaries of every limit, the privacy of the student's view, and
// seeded random sessions against a plain table model written apart from the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apply,
  cleanText,
  newQueue,
  placeOf,
  QUEUE_LIMITS,
  refusalWords,
  STATE_WORDS,
  studentView,
  totals,
  withStudent,
  type Action,
  type Actor,
  type JobDraft,
  type JobState,
  type Queue,
  type RefusalKind,
} from "../src/queue.ts";

const TEACHER: Actor = { role: "teacher" };
const CHECK: Actor = { role: "check" };
const sam: Actor = { role: "student", id: "s1" };
const alex: Actor = { role: "student", id: "s2" };

function start(): Queue {
  const q = newQueue([
    { id: "p1s", name: "Printer", kind: "print" },
    { id: "laser", name: "Laser", kind: "laser" },
  ]);
  assert.ok(q);
  const a = withStudent(q, "s1", "Sam K.");
  assert.ok(a);
  const b = withStudent(a, "s2", "Alex M.");
  assert.ok(b);
  return b;
}

function draft(machine: string, minutes: number | null, amount: number | null, fileName = "part.3mf"): JobDraft {
  return { machine, fileName, fileBytes: 1000, material: "PLA", estimate: { minutes, amount } };
}

/** Applies an action that must be allowed; gives the new queue and the job's id. */
function ok(q: Queue, a: Action): { q: Queue; id: string } {
  const r = apply(q, a);
  if (!r.ok) assert.fail(`refused ${a.kind}: ${r.refusal.kind} ${r.refusal.detail}`);
  return { q: r.queue, id: r.id };
}

function refused(q: Queue, a: Action, kind: RefusalKind, detail?: string): void {
  const r = apply(q, a);
  assert.equal(r.ok, false, `${a.kind} should be refused`);
  if (!r.ok) {
    assert.equal(r.refusal.kind, kind);
    if (detail !== undefined) assert.equal(r.refusal.detail, detail);
  }
}

/** Sends, passes the check and approves a job; gives its id. */
function queued(q: Queue, who: Actor, d: JobDraft, at: number): { q: Queue; id: string } {
  const s = ok(q, { kind: "send", by: who, at, job: d });
  const c = ok(s.q, { kind: "check", by: CHECK, at: at + 1, id: s.id, passed: true });
  const a = ok(c.q, { kind: "approve", by: TEACHER, at: at + 2, id: s.id });
  return { q: a.q, id: s.id };
}

test("hand-worked: a day on the printer, places, wait and totals", () => {
  let q = start();
  // Sam sends A (90 min, 40 g), Alex sends B (30 min, 12 g), Sam sends C (no time yet, 5 g); all approved in that order.
  const A = queued(q, sam, draft("p1s", 90, 40), 0);
  const B = queued(A.q, alex, draft("p1s", 30, 12), 10);
  const C = queued(B.q, sam, draft("p1s", null, 5), 20);
  q = C.q;
  assert.deepEqual(q.order.p1s, [A.id, B.id, C.id]);
  // C is third: two jobs ahead, A's 90 + B's 30 = 120 minutes known, none unknown.
  assert.deepEqual(placeOf(q, C.id), { place: 3, ahead: 2, minutesAhead: 120, unknownAhead: 0, machineBusy: false });
  // The teacher moves C to the front: order C, A, B, so B now waits behind C (unknown) and A (90).
  q = ok(q, { kind: "move", by: TEACHER, at: 30, id: C.id, to: 0 }).q;
  assert.deepEqual(q.order.p1s, [C.id, A.id, B.id]);
  assert.deepEqual(placeOf(q, B.id), { place: 3, ahead: 2, minutesAhead: 90, unknownAhead: 1, machineBusy: false });
  // C runs and fails (spaghetti) after 20 minutes and 3 g; it goes back to the front.
  q = ok(q, { kind: "start", by: TEACHER, at: 40, id: C.id }).q;
  // While C runs, A is first in line (place 1) and the machine is busy.
  assert.deepEqual(placeOf(q, A.id), { place: 1, ahead: 0, minutesAhead: 0, unknownAhead: 0, machineBusy: true });
  q = ok(q, { kind: "finish", by: TEACHER, at: 60, id: C.id, outcome: "failed", reason: "Came off the plate", used: { minutes: 20, amount: 3 } }).q;
  q = ok(q, { kind: "requeue", by: TEACHER, at: 61, id: C.id }).q;
  assert.deepEqual(q.order.p1s, [C.id, A.id, B.id]);
  // C reruns and is done, recorded as 50 min and 5 g. A is done with no record (its estimate counts). B is returned.
  q = ok(q, { kind: "start", by: TEACHER, at: 70, id: C.id }).q;
  q = ok(q, { kind: "finish", by: TEACHER, at: 120, id: C.id, outcome: "done", used: { minutes: 50, amount: 5 } }).q;
  q = ok(q, { kind: "start", by: TEACHER, at: 121, id: A.id }).q;
  q = ok(q, { kind: "finish", by: TEACHER, at: 211, id: A.id, outcome: "done" }).q;
  q = ok(q, { kind: "return", by: TEACHER, at: 212, id: B.id, reason: "Walls too thin, see the print check" }).q;
  assert.deepEqual(q.order.p1s, []);
  const t = totals(q);
  // Printer: runs C-failed (20 min, 3 g), C-done (50, 5), A-done (estimate 90, 40).
  // minutes 20 + 50 + 90 = 160; grams 3 + 5 + 40 = 48; one run (A) from the estimate; nothing unknown.
  assert.deepEqual(t.byMachine.p1s, { done: 2, failed: 1, minutes: 160, amount: 48, estimated: 1, unknown: 0 });
  // Sam owns A and C: the same three runs. Alex's B never ran, so Alex has no total at all.
  assert.deepEqual(t.byStudent.s1, { done: 2, failed: 1, minutes: 160, amount: 48, estimated: 1, unknown: 0 });
  assert.equal(t.byStudent.s2, undefined);
  assert.deepEqual(t.byMachine.laser, { done: 0, failed: 0, minutes: 0, amount: 0, estimated: 0, unknown: 0 });
  // History of C, by hand: checking, waiting, queued, running, failed, queued, running, done.
  const c = q.jobs.find((j) => j.id === C.id);
  assert.deepEqual(c?.history.map((h) => h.to), ["checking", "waiting", "queued", "running", "failed", "queued", "running", "done"]);
});

test("hand-worked: a laser job with no time yet counts as unknown, never as zero", () => {
  let q = start();
  // A 300 × 200 mm piece of sheet is 60,000 mm²; the laser's time is not known yet (Laser's L3a).
  const L = queued(q, alex, { machine: "laser", fileName: "box.svg", fileBytes: 5000, material: "3 mm plywood", estimate: { minutes: null, amount: 60000 } }, 0);
  q = ok(L.q, { kind: "start", by: TEACHER, at: 5, id: L.id }).q;
  q = ok(q, { kind: "finish", by: TEACHER, at: 25, id: L.id, outcome: "done" }).q;
  assert.equal(q.jobs[0]?.kind, "laser");
  // One done run: amount 60,000 from the estimate, minutes unknown so left out of the sum (0), counted as unknown.
  assert.deepEqual(totals(q).byMachine.laser, { done: 1, failed: 0, minutes: 0, amount: 60000, estimated: 1, unknown: 1 });
});

test("the check: a pass may give the estimate; a refusal keeps its reason and only the owner may withdraw", () => {
  let q = start();
  const s = ok(q, { kind: "send", by: sam, at: 0, job: draft("p1s", null, null) });
  q = ok(s.q, { kind: "check", by: CHECK, at: 1, id: s.id, passed: true, estimate: { minutes: 42, amount: 9 } }).q;
  assert.deepEqual(q.jobs[0]?.estimate, { minutes: 42, amount: 9 });
  assert.equal(q.jobs[0]?.state, "waiting");
  const t = ok(q, { kind: "send", by: sam, at: 2, job: draft("p1s", 1, 1) });
  refused(t.q, { kind: "check", by: CHECK, at: 3, id: t.id, passed: false }, "bad-input", "reason");
  q = ok(t.q, { kind: "check", by: CHECK, at: 3, id: t.id, passed: false, reason: "Bigger than the bed: 260 mm wide" }).q;
  assert.equal(q.jobs[1]?.state, "check-failed");
  assert.equal(q.jobs[1]?.reason, "Bigger than the bed: 260 mm wide");
  refused(q, { kind: "approve", by: TEACHER, at: 4, id: t.id }, "wrong-state", "check-failed");
  refused(q, { kind: "withdraw", by: alex, at: 4, id: t.id }, "not-allowed");
  q = ok(q, { kind: "withdraw", by: sam, at: 4, id: t.id }).q;
  assert.equal(q.jobs[1]?.state, "withdrawn");
});

test("every move not allowed is refused with its kind, and a refusal changes nothing", () => {
  let q = start();
  const s = ok(q, { kind: "send", by: sam, at: 0, job: draft("p1s", 10, 1) });
  q = s.q;
  const before = structuredClone(q);
  // Only students send; only the check checks; only the teacher approves, returns, moves, starts, finishes, requeues.
  refused(q, { kind: "send", by: TEACHER, at: 1, job: draft("p1s", 1, 1) }, "not-allowed");
  refused(q, { kind: "send", by: CHECK, at: 1, job: draft("p1s", 1, 1) }, "not-allowed");
  refused(q, { kind: "check", by: TEACHER, at: 1, id: s.id, passed: true }, "not-allowed");
  refused(q, { kind: "check", by: sam, at: 1, id: s.id, passed: true }, "not-allowed");
  refused(q, { kind: "approve", by: TEACHER, at: 1, id: s.id }, "wrong-state", "checking");
  q = ok(q, { kind: "check", by: CHECK, at: 1, id: s.id, passed: true }).q;
  for (const who of [sam, alex, CHECK]) {
    refused(q, { kind: "approve", by: who, at: 2, id: s.id }, "not-allowed");
    refused(q, { kind: "return", by: who, at: 2, id: s.id, reason: "x" }, "not-allowed");
  }
  refused(q, { kind: "check", by: CHECK, at: 2, id: s.id, passed: true }, "wrong-state", "waiting");
  refused(q, { kind: "start", by: TEACHER, at: 2, id: s.id }, "wrong-state", "waiting");
  refused(q, { kind: "move", by: TEACHER, at: 2, id: s.id, to: 0 }, "wrong-state", "waiting");
  refused(q, { kind: "approve", by: TEACHER, at: 2, id: "job-99" }, "not-found", "job-99");
  refused(q, { kind: "send", by: { role: "student", id: "nobody" }, at: 2, job: draft("p1s", 1, 1) }, "not-found", "nobody");
  refused(q, { kind: "send", by: sam, at: 2, job: draft("cnc", 1, 1) }, "not-found", "cnc");
  q = ok(q, { kind: "approve", by: TEACHER, at: 2, id: s.id }).q;
  for (const who of [sam, alex, CHECK]) {
    refused(q, { kind: "move", by: who, at: 3, id: s.id, to: 0 }, "not-allowed");
    refused(q, { kind: "start", by: who, at: 3, id: s.id }, "not-allowed");
  }
  refused(q, { kind: "move", by: TEACHER, at: 3, id: s.id, to: 1 }, "bad-input", "to");
  refused(q, { kind: "move", by: TEACHER, at: 3, id: s.id, to: -1 }, "bad-input", "to");
  refused(q, { kind: "move", by: TEACHER, at: 3, id: s.id, to: 0.5 }, "bad-input", "to");
  refused(q, { kind: "finish", by: TEACHER, at: 3, id: s.id, outcome: "done" }, "wrong-state", "queued");
  // A second job on the same printer can't start while the first runs; the laser is free.
  const t = queued(q, alex, draft("p1s", 5, 1), 4);
  const l = queued(t.q, alex, { ...draft("laser", 5, 100), fileName: "a.svg" }, 4);
  q = ok(l.q, { kind: "start", by: TEACHER, at: 8, id: s.id }).q;
  refused(q, { kind: "start", by: TEACHER, at: 9, id: t.id }, "machine-busy", "p1s");
  q = ok(q, { kind: "start", by: TEACHER, at: 9, id: l.id }).q;
  refused(q, { kind: "withdraw", by: sam, at: 9, id: s.id }, "wrong-state", "running");
  for (const who of [sam, CHECK]) refused(q, { kind: "finish", by: who, at: 9, id: s.id, outcome: "done" }, "not-allowed");
  refused(q, { kind: "finish", by: TEACHER, at: 9, id: s.id, outcome: "failed" }, "bad-input", "reason");
  refused(q, { kind: "finish", by: TEACHER, at: 9, id: s.id, outcome: "maybe" as "done" }, "bad-input", "outcome");
  refused(q, { kind: "requeue", by: TEACHER, at: 9, id: s.id }, "wrong-state", "running");
  q = ok(q, { kind: "finish", by: TEACHER, at: 10, id: s.id, outcome: "done" }).q;
  for (const a of ["return", "withdraw", "requeue", "start"] as const) {
    const by = a === "withdraw" ? sam : TEACHER;
    refused(q, { kind: a, by, at: 11, id: s.id, reason: "x" } as Action, "wrong-state", "done");
  }
  // A time that isn't a number, or is negative, is refused before anything else.
  refused(q, { kind: "approve", by: TEACHER, at: Number.NaN, id: s.id }, "bad-input", "at");
  refused(q, { kind: "approve", by: TEACHER, at: -1, id: s.id }, "bad-input", "at");
  // The queue given is never changed, refused or not.
  assert.equal(before.jobs[0]?.state, "checking");
  assert.equal(before.jobs.length, 1);
});

test("a student withdrawing a queued job leaves the queue; a returned job leaves it too", () => {
  let q = start();
  const a = queued(q, sam, draft("p1s", 1, 1), 0);
  const b = queued(a.q, alex, draft("p1s", 1, 1), 5);
  const c = queued(b.q, sam, draft("p1s", 1, 1), 10);
  q = ok(c.q, { kind: "withdraw", by: sam, at: 20, id: a.id }).q;
  assert.deepEqual(q.order.p1s, [b.id, c.id]);
  q = ok(q, { kind: "return", by: TEACHER, at: 21, id: c.id, reason: "Please add a brim" }).q;
  assert.deepEqual(q.order.p1s, [b.id]);
  assert.equal(placeOf(q, b.id)?.place, 1);
  assert.equal(placeOf(q, c.id), null);
});

test("boundaries: every limit passes at 0.9× and is refused at 1.1×", () => {
  const q = start();
  const L = QUEUE_LIMITS;
  const send = (job: JobDraft) => apply(q, { kind: "send", by: sam, at: 0, job });
  const base = draft("p1s", 10, 10);
  // File size: 50 MiB = 52,428,800 bytes; 0.9× = 47,185,920 passes, 1.1× = 57,671,680 is refused.
  assert.equal(L.fileBytes, 52428800);
  assert.equal(send({ ...base, fileBytes: Math.floor(0.9 * L.fileBytes) }).ok, true);
  assert.equal(send({ ...base, fileBytes: L.fileBytes }).ok, true);
  refused(q, { kind: "send", by: sam, at: 0, job: { ...base, fileBytes: Math.ceil(1.1 * L.fileBytes) } }, "bad-input", "fileBytes");
  refused(q, { kind: "send", by: sam, at: 0, job: { ...base, fileBytes: 0 } }, "bad-input", "fileBytes");
  refused(q, { kind: "send", by: sam, at: 0, job: { ...base, fileBytes: 10.5 } }, "bad-input", "fileBytes");
  // Texts: 0.9× of each limit passes, 1.1× is refused.
  for (const [field, max] of [["fileName", L.fileNameChars], ["material", L.materialChars]] as const) {
    assert.equal(send({ ...base, [field]: "x".repeat(Math.floor(0.9 * max)) }).ok, true, field);
    assert.equal(send({ ...base, [field]: "x".repeat(max) }).ok, true, field);
    refused(q, { kind: "send", by: sam, at: 0, job: { ...base, [field]: "x".repeat(Math.ceil(1.1 * max)) } }, "bad-input", field);
    refused(q, { kind: "send", by: sam, at: 0, job: { ...base, [field]: "   " } }, "bad-input", field);
    refused(q, { kind: "send", by: sam, at: 0, job: { ...base, [field]: "a\u0007b" } }, "bad-input", field);
  }
  // Minutes: a week is 7 × 24 × 60 = 10,080; grams 5,000; sheet 5 × 1400 × 900 = 6,300,000 mm².
  assert.equal(L.minutes, 10080);
  assert.equal(L.amount.mm2, 6300000);
  assert.equal(send({ ...base, estimate: { minutes: 0.9 * L.minutes, amount: 0.9 * L.amount.g } }).ok, true);
  refused(q, { kind: "send", by: sam, at: 0, job: { ...base, estimate: { minutes: 1.1 * L.minutes, amount: 1 } } }, "bad-input", "minutes");
  refused(q, { kind: "send", by: sam, at: 0, job: { ...base, estimate: { minutes: 1, amount: 1.1 * L.amount.g } } }, "bad-input", "amount");
  // The sheet limit applies to a laser job; the gram limit would refuse 0.9× of it.
  const laser = { ...base, machine: "laser" };
  assert.equal(send({ ...laser, estimate: { minutes: 1, amount: 0.9 * L.amount.mm2 } }).ok, true);
  refused(q, { kind: "send", by: sam, at: 0, job: { ...laser, estimate: { minutes: 1, amount: 1.1 * L.amount.mm2 } } }, "bad-input", "amount");
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "5" as unknown as number]) {
    refused(q, { kind: "send", by: sam, at: 0, job: { ...base, estimate: { minutes: bad, amount: 1 } } }, "bad-input", "minutes");
  }
  refused(q, { kind: "send", by: sam, at: 0, job: { ...base, estimate: null as unknown as JobDraft["estimate"] } }, "bad-input", "estimate");
  // Reasons: 300 characters; 270 pass, 330 are refused.
  const w = queued(q, sam, base, 0);
  assert.equal(apply(w.q, { kind: "return", by: TEACHER, at: 5, id: w.id, reason: "r".repeat(270) }).ok, true);
  refused(w.q, { kind: "return", by: TEACHER, at: 5, id: w.id, reason: "r".repeat(330) }, "bad-input", "reason");
  refused(w.q, { kind: "return", by: TEACHER, at: 5, id: w.id, reason: "" }, "bad-input", "reason");
  // Display names: 40 characters; 36 pass, 44 are refused.
  assert.ok(withStudent(q, "s3", "n".repeat(36)));
  assert.equal(withStudent(q, "s3", "n".repeat(44)), null);
  assert.equal(withStudent(q, "s3", ""), null);
});

test("cleanText trims, counts characters not code units, and refuses control characters", () => {
  assert.equal(cleanText("  Sam K.  ", 10), "Sam K.");
  // "🙂" is two UTF-16 code units but one character: 10 of them fit a limit of 10.
  assert.equal(cleanText("🙂".repeat(10), 10), "🙂".repeat(10));
  assert.equal(cleanText("🙂".repeat(11), 10), null);
  assert.equal(cleanText("a\nb", 10), null);
  assert.equal(cleanText(5, 10), null);
});

test("newQueue refuses two machines with one id, a bad kind or a bad id", () => {
  assert.equal(newQueue([{ id: "a", name: "A", kind: "print" }, { id: "a", name: "B", kind: "laser" }]), null);
  assert.equal(newQueue([{ id: "a", name: "A", kind: "cnc" as "print" }]), null);
  assert.equal(newQueue([{ id: " a", name: "A", kind: "print" }]), null);
  assert.equal(newQueue([{ id: "a", name: "", kind: "print" }]), null);
  assert.ok(newQueue([]));
});

test("privacy: a student's view never holds another student's name or file", () => {
  let q = start();
  const a = queued(q, sam, draft("p1s", 30, 1, "sams-secret-file.3mf"), 0);
  const b = queued(a.q, alex, draft("p1s", 30, 1, "alexs-bracket.3mf"), 5);
  q = b.q;
  const v = studentView(q, "s2");
  assert.ok(v);
  const text = JSON.stringify(v);
  assert.equal(v.name, "Alex M.");
  assert.ok(!text.includes("Sam"), "another student's name");
  assert.ok(!text.includes("sams-secret-file"), "another student's file");
  assert.ok(!text.includes('"s1"'), "another student's id");
  // Alex still learns their place: second, 30 minutes behind one job.
  assert.deepEqual(v.jobs[0]?.place, { place: 2, ahead: 1, minutesAhead: 30, unknownAhead: 0, machineBusy: false });
  assert.deepEqual(v.queueLengths, { p1s: 2, laser: 0 });
  assert.equal(studentView(q, "nobody"), null);
});

test("every refusal and every state has words", () => {
  for (const kind of ["bad-input", "not-found", "not-allowed", "wrong-state", "machine-busy"] as const) {
    assert.ok(refusalWords({ kind, detail: "reason" }).length > 10);
  }
  assert.match(refusalWords({ kind: "wrong-state", detail: "running" }), /on the machine/);
  assert.match(refusalWords({ kind: "bad-input", detail: "reason" }), /reason/);
  assert.equal(Object.keys(STATE_WORDS).length, 9);
});

// ---- Seeded random sessions against a plain table model ----

/** mulberry32: a small seeded random source. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The model: a table of (action, who may do it, from which states, to which state), and a list per machine.
type Who = "student-owner" | "teacher" | "check";
const TABLE: Record<string, { who: Who; from: JobState[]; to: JobState | "same" }> = {
  pass: { who: "check", from: ["checking"], to: "waiting" },
  fail: { who: "check", from: ["checking"], to: "check-failed" },
  approve: { who: "teacher", from: ["waiting"], to: "queued" },
  return: { who: "teacher", from: ["waiting", "queued"], to: "returned" },
  withdraw: { who: "student-owner", from: ["checking", "check-failed", "waiting", "queued"], to: "withdrawn" },
  move: { who: "teacher", from: ["queued"], to: "same" },
  start: { who: "teacher", from: ["queued"], to: "running" },
  done: { who: "teacher", from: ["running"], to: "done" },
  failed: { who: "teacher", from: ["running"], to: "failed" },
  requeue: { who: "teacher", from: ["failed"], to: "queued" },
};

interface ModelJob {
  state: JobState;
  machine: string;
  student: string;
  est: number;
  runs: { minutes: number }[];
}

test("seeded random sessions: the queue agrees with the table model, step by step", () => {
  const machines = ["p1s", "laser"];
  const students = ["s1", "s2", "s3"];
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = mulberry(seed);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    let q = newQueue([
      { id: "p1s", name: "Printer", kind: "print" },
      { id: "laser", name: "Laser", kind: "laser" },
    ]) as Queue;
    for (const s of students) q = withStudent(q, s, `Student ${s}`) as Queue;
    const model = new Map<string, ModelJob>();
    const lists: Record<string, string[]> = { p1s: [], laser: [] };
    for (let step = 0; step < 120; step += 1) {
      const at = step;
      const ids = [...model.keys()];
      if (ids.length === 0 || rand() < 0.2) {
        const machine = pick(machines);
        const student = pick(students);
        const est = Math.floor(rand() * 100);
        const r = apply(q, { kind: "send", by: { role: "student", id: student }, at, job: { ...draft(machine, est, 1), fileName: `f${step}` } });
        assert.ok(r.ok, `seed ${seed} step ${step}: send`);
        if (!r.ok) return;
        assert.equal(r.id, `job-${model.size + 1}`);
        model.set(r.id, { state: "checking", machine, student, est, runs: [] });
        q = r.queue;
        continue;
      }
      const id = pick(ids);
      const m = model.get(id) as ModelJob;
      const name = pick(Object.keys(TABLE));
      const row = TABLE[name] as (typeof TABLE)[string];
      const actorKind = pick(["teacher", "check", "owner", "other"] as const);
      const by: Actor =
        actorKind === "teacher" ? TEACHER : actorKind === "check" ? CHECK : { role: "student", id: actorKind === "owner" ? m.student : students.find((s) => s !== m.student) as string };
      const list = lists[m.machine] as string[];
      const to = Math.floor(rand() * (list.length + 1)) - (rand() < 0.1 ? 1 : 0);
      const runMinutes = Math.floor(rand() * 50);
      const action: Action =
        name === "pass" ? { kind: "check", by, at, id, passed: true }
        : name === "fail" ? { kind: "check", by, at, id, passed: false, reason: "too big" }
        : name === "done" || name === "failed" ? { kind: "finish", by, at, id, outcome: name, reason: "x", used: { minutes: runMinutes, amount: 1 } }
        : name === "move" ? { kind: "move", by, at, id, to }
        : name === "return" ? { kind: "return", by, at, id, reason: "fix it" }
        : ({ kind: name, by, at, id } as Action);
      // What the model says.
      const whoOk = row.who === "teacher" ? actorKind === "teacher" : row.who === "check" ? actorKind === "check" : actorKind === "owner";
      const stateOk = row.from.includes(m.state);
      const busy = name === "start" && [...model.values()].some((o) => o.machine === m.machine && o.state === "running");
      const moveOk = name !== "move" || (to >= 0 && to < list.length);
      let expect: RefusalKind | "ok" = "ok";
      if (!whoOk) expect = "not-allowed";
      else if (!stateOk) expect = "wrong-state";
      else if (busy) expect = "machine-busy";
      else if (!moveOk) expect = "bad-input";
      const r = apply(q, action);
      assert.equal(r.ok ? "ok" : r.refusal.kind, expect, `seed ${seed} step ${step}: ${name} by ${actorKind} on ${m.state}`);
      if (!r.ok) continue;
      q = r.queue;
      // The model's own moves.
      if (name === "approve") list.push(id);
      // (A job leaving that was never queued, say withdrawn while checking, leaves the list alone.)
      if ((name === "return" || name === "withdraw" || name === "start") && list.includes(id)) list.splice(list.indexOf(id), 1);
      if (name === "move") {
        list.splice(list.indexOf(id), 1);
        list.splice(to, 0, id);
      }
      if (name === "requeue") list.unshift(id);
      if (name === "done" || name === "failed") m.runs.push({ minutes: runMinutes });
      if (row.to !== "same") m.state = row.to;
      // Compare everything after each allowed step.
      for (const [jid, mj] of model) assert.equal(q.jobs.find((j) => j.id === jid)?.state, mj.state, `seed ${seed} step ${step} ${jid}`);
      assert.deepEqual(q.order, lists, `seed ${seed} step ${step}: order`);
      for (const machine of machines) {
        const running = [...model.values()].filter((o) => o.machine === machine && o.state === "running").length;
        assert.ok(running <= 1, `seed ${seed}: two jobs running on ${machine}`);
        const want = [...model.values()].filter((o) => o.machine === machine).flatMap((o) => o.runs).reduce((s, x) => s + x.minutes, 0);
        assert.equal(totals(q).byMachine[machine]?.minutes, want, `seed ${seed} step ${step}: minutes on ${machine}`);
      }
      // Every queued job is in exactly its machine's list, and nothing else is.
      for (const [jid, mj] of model) {
        const inLists = machines.filter((mc) => (q.order[mc] as string[]).includes(jid));
        assert.deepEqual(inLists, mj.state === "queued" ? [mj.machine] : [], `seed ${seed} ${jid}`);
      }
    }
  }
});
