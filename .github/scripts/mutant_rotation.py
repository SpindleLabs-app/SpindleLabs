#!/usr/bin/env python3
"""The kernel's whole-kernel mutation testing, one slice a night
(kernel-mutants.yml; tested in test_mutant_rotation.py).

The kernel has grown past what cargo mutants can test in one night (7,435
mutants at about one a minute per runner on 2026-11-06), so each run tests
the next units of a cycle that covers every mutant once, and a new cycle
starts when the last one is done. A unit is one source file's mutants, or a
slice of a big file's (cargo mutants -f FILE --shard i/n --sharding slice),
about SIZE mutants each. The order: the files under the prefixes the kernel
lists in .cargo/mutants-first.txt (its newest and riskiest code), then every
other file, each in path order.

  mutant_rotation.py run --job J --jobs N --deadline EPOCH --state FILE --out DIR
      in kernel/: lists the mutants, works out the cycle's units still to
      test, runs the unmutated lib tests once, then tests units J, J+N,
      J+2N... of them until the deadline, each into DIR/units/<k>/. All its
      output names kernel files: run it through kernel_ci.sh run only.
  mutant_rotation.py record --dir DIR --in IN --commit C --branch B --run-url U
      in the test-results checkout DIR: folds the jobs' folders IN/mutants-*/
      into mutants/rotation.json, rewrites mutants/missed.txt (every survivor,
      from each unit's latest test), adds a line to mutants/rotation-log.csv
      and writes mutants/summary.txt; prints a JSON line saying what to file
      (the unmutated tests failing, new survivors).

The state, mutants/rotation.json on the private test-results branch:
  {"cycle": 3, "cycle_started": "2026-11-07 06:12",
   "cycles": [{"cycle": 2, "started": ..., "finished": ..., "runs": 7}],
   "runs_this_cycle": 2,
   "units": {"<file>#<i>/<n>": {"cycle": 3, "tested": ..., "commit": ...,
             "caught": 30, "missed": [...], "timeout": 0, "unviable": 4}}}
A unit counts as done in a cycle once a run got through it (cargo mutants
exit 0, 2 or 3); one cut off by the deadline is tried again next run.
"""

import argparse
import json
import math
import os
import re
import signal
import subprocess
import sys
import time

SIZE = 40  # mutants a unit, about 50 minutes of one runner
MARGIN = 600  # seconds: no unit starts with less than this left
TEST_TIMEOUT = 120  # seconds for one mutant's lib tests (the unmutated ones take about 12)
FINISHED = {0, 2, 3}  # cargo mutants got through its list (some missed / timed out)


def read(path):
    with open(path) as f:
        return f.read()


def strip(name):
    """A mutant's name without line:column, which move whenever code above
    it changes ("FILE:12:5: replace x" -> "FILE: replace x")."""
    return re.sub(r"^([^:]+):\d+:\d+:", r"\1:", name)


def counts_of(listing):
    """{file: mutants} from `cargo mutants --list --json`."""
    counts = {}
    for m in listing:
        counts[m["file"]] = counts.get(m["file"], 0) + 1
    return counts


def first_prefixes(text):
    """The path prefixes of .cargo/mutants-first.txt: one a line, # comments."""
    return [line.split("#", 1)[0].strip() for line in text.splitlines() if line.split("#", 1)[0].strip()]


def units_of(counts, first, size=SIZE):
    """Every unit of the cycle in test order: (file, i, n), a file of c
    mutants cut into n = ceil(c / size) slices; files under a `first` prefix
    lead, in the order the prefixes are listed, then the rest, by path."""
    def rank(path):
        for k, prefix in enumerate(first):
            if path.startswith(prefix):
                return (k, path)
        return (len(first), path)
    out = []
    for path in sorted(counts, key=rank):
        n = max(1, math.ceil(counts[path] / size))
        out += [(path, i, n) for i in range(n)]
    return out


def unit_id(unit):
    path, i, n = unit
    return f"{path}#{i}/{n}"


def pending(units, state):
    """(cycle, the units still to test in it). A unit is done when the state
    has it tested in the current cycle; when every unit is, the next cycle
    starts with all of them."""
    cycle = state.get("cycle", 1)
    done = {k for k, v in state.get("units", {}).items() if v.get("cycle") == cycle}
    left = [u for u in units if unit_id(u) not in done]
    if not left:
        return cycle + 1, list(units)
    return cycle, left


def share(units, job, jobs):
    """Job `job` of `jobs` takes every jobs-th unit from its own index, so
    each job starts on the cycle's next units and all of them are busy."""
    return units[job::jobs]


def load_state(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def lines_of(path):
    try:
        with open(path) as f:
            return [line.rstrip("\n") for line in f if line.strip()]
    except OSError:
        return []


# ---------------------------------------------------------------- run

def sh(cmd, timeout=None):
    """Runs cmd, its output into this (private) log; its exit code, or 124
    when cut off at `timeout` seconds (SIGINT first, as cargo mutants wants,
    then kill)."""
    print("$", " ".join(cmd), flush=True)
    p = subprocess.Popen(cmd)
    try:
        return p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        p.send_signal(signal.SIGINT)
        try:
            p.wait(timeout=60)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
        return 124


def run(args):
    out = args.out
    os.makedirs(os.path.join(out, "units"), exist_ok=True)
    listing = json.loads(subprocess.run(["cargo", "mutants", "--list", "--json"], check=True, capture_output=True, text=True).stdout)
    first = first_prefixes(read(".cargo/mutants-first.txt")) if os.path.exists(".cargo/mutants-first.txt") else []
    units = units_of(counts_of(listing), first)
    cycle, left = pending(units, load_state(args.state))
    mine = share(left, args.job, args.jobs)
    with open(os.path.join(out, "plan.txt"), "w") as f:
        f.write(f"cycle {cycle}\nunits {len(units)}\nmutants {len(listing)}\nleft {len(left)}\n")
        f.writelines(unit_id(u) + "\n" for u in mine)
    with open(os.path.join(out, "units-all.txt"), "w") as f:
        f.writelines(unit_id(u) + "\n" for u in units)
    print(f"cycle {cycle}: {len(left)} of {len(units)} units left; this job's share: {len(mine)}", flush=True)
    # The unmutated lib tests, once: every unit then skips its own baseline.
    code = sh(["cargo", "test", "--lib"], timeout=max(60, args.deadline - time.time()))
    with open(os.path.join(out, "baseline.txt"), "w") as f:
        f.write(f"{code}\n")
    if code == 124:
        print("the deadline came before the unmutated lib tests finished: no unit tested", flush=True)
        return 0
    if code != 0:
        print("the unmutated lib tests failed: no unit tested", flush=True)
        return 4
    for k, (path, i, n) in enumerate(mine):
        left_s = args.deadline - time.time()
        if left_s < MARGIN:
            print(f"deadline: {len(mine) - k} unit(s) left for the next run", flush=True)
            break
        d = os.path.join(out, "units", str(k))
        os.makedirs(d)
        with open(os.path.join(d, "unit.txt"), "w") as f:
            f.write(unit_id((path, i, n)) + "\n")
        work = os.path.join(args.scratch, f"unit-{k}")
        os.makedirs(args.scratch, exist_ok=True)  # cargo mutants wants --output's parent to exist
        code = sh(["cargo", "mutants", "-f", path, "--shard", f"{i}/{n}", "--sharding", "slice", "--baseline", "skip",
                   "--timeout", str(TEST_TIMEOUT), "-j", str(args.parallel), "--output", work, "--", "--lib"], timeout=left_s)
        for name in ("caught", "missed", "timeout", "unviable"):
            src = os.path.join(work, "mutants.out", f"{name}.txt")
            with open(os.path.join(d, f"{name}.txt"), "w") as f:
                f.writelines(line + "\n" for line in lines_of(src))
        with open(os.path.join(d, "exit-code.txt"), "w") as f:
            f.write(f"{code}\n")
        with open(os.path.join(d, "cycle.txt"), "w") as f:
            f.write(f"{cycle}\n")
        if code not in FINISHED and code != 124:
            # cargo mutants itself failed (1: bad arguments, a crash): every
            # unit after would too, so stop here and go red.
            print(f"cargo mutants failed (exit code {code}): stopped", flush=True)
            return 1
    return 0


# ------------------------------------------------------------- record

def results_in(incoming):
    """Every unit the jobs reported, and whether any job's unmutated tests
    failed: ([{id, cycle, exit, caught, missed, timeout, unviable}], bool,
    the listing's figures from the first plan.txt)."""
    units, baseline_failed, plan = [], False, {"all": []}
    for job in sorted(os.listdir(incoming)) if os.path.isdir(incoming) else []:
        jd = os.path.join(incoming, job)
        if not job.startswith("mutants-") or not os.path.isdir(jd):
            continue
        base = lines_of(os.path.join(jd, "baseline.txt"))
        if base and base[0] not in ("0", "124"):  # 124: the deadline came first
            baseline_failed = True
        if not plan["all"]:
            plan["all"] = lines_of(os.path.join(jd, "units-all.txt"))
        for line in lines_of(os.path.join(jd, "plan.txt"))[:4]:
            key, _, value = line.partition(" ")
            plan.setdefault(key, int(value))
        ud = os.path.join(jd, "units")
        for k in sorted(os.listdir(ud), key=lambda s: int(s) if s.isdigit() else 0) if os.path.isdir(ud) else []:
            d = os.path.join(ud, k)
            uid = (lines_of(os.path.join(d, "unit.txt")) or [""])[0]
            code = (lines_of(os.path.join(d, "exit-code.txt")) or ["124"])[0]
            if not uid:
                continue
            units.append({
                "id": uid,
                "cycle": int((lines_of(os.path.join(d, "cycle.txt")) or ["0"])[0]),
                "exit": int(code) if code.lstrip("-").isdigit() else 124,
                "caught": len(lines_of(os.path.join(d, "caught.txt"))),
                "missed": sorted(lines_of(os.path.join(d, "missed.txt"))),
                "timeout": len(lines_of(os.path.join(d, "timeout.txt"))),
                "unviable": len(lines_of(os.path.join(d, "unviable.txt"))),
            })
    return units, baseline_failed, plan


def merge(state, results, plan, when, commit):
    """Folds one run's unit results into the state; returns (state, the new
    survivors, the figures for the log). A survivor is new when its file was
    tested before and none of that file's earlier survivors has its name
    (line:column aside): new code, or a test that got weaker."""
    state = json.loads(json.dumps(state)) if state else {}
    state.setdefault("cycle", 1)
    state.setdefault("units", {})
    state.setdefault("cycles", [])
    state.setdefault("cycle_started", when)
    state.setdefault("runs_this_cycle", 0)
    ran_cycle = max([r["cycle"] for r in results], default=state["cycle"])
    if ran_cycle > state["cycle"]:
        state["cycles"].append({"cycle": state["cycle"], "started": state["cycle_started"], "finished": state.get("last_done", when),
                                "runs": state["runs_this_cycle"]})
        state["cycle"], state["cycle_started"], state["runs_this_cycle"] = ran_cycle, when, 0
    state["runs_this_cycle"] += 1
    # Each file's survivors so far, before any unit is dropped below.
    before = {}
    for uid, u in state["units"].items():
        before.setdefault(uid.split("#", 1)[0], set()).update(strip(m) for m in u.get("missed", []))
    if plan.get("all"):
        # Units of files gone or cut differently since: their results no longer say anything.
        keep = set(plan["all"])
        state["units"] = {k: v for k, v in state["units"].items() if k in keep}
    new, figures = [], {"done": 0, "tried": len(results), "tested": 0, "caught": 0, "missed": 0, "timeout": 0, "unviable": 0}
    for r in results:
        if r["exit"] not in FINISHED:
            continue
        path = r["id"].split("#", 1)[0]
        if path in before:
            new += [m for m in r["missed"] if strip(m) not in before[path]]
        state["units"][r["id"]] = {"cycle": r["cycle"], "tested": when, "commit": commit, "caught": r["caught"],
                                   "missed": r["missed"], "timeout": r["timeout"], "unviable": r["unviable"]}
        figures["done"] += 1
        for key in ("caught", "timeout", "unviable"):
            figures[key] += r[key]
        figures["missed"] += len(r["missed"])
        figures["tested"] += r["caught"] + len(r["missed"]) + r["timeout"] + r["unviable"]
    if figures["done"]:
        state["last_done"] = when
    if plan.get("units"):
        state["units_total"], state["mutants_total"] = plan["units"], plan.get("mutants", 0)
    return state, sorted(new), figures


def cycle_line(state):
    """Where the cycle stands and how long a whole one takes, in words."""
    total = state.get("units_total") or 0
    done = sum(1 for u in state.get("units", {}).values() if u.get("cycle") == state.get("cycle"))
    words = f"cycle {state.get('cycle', 1)}: {done} of {total or '?'} units tested since {state.get('cycle_started', '?')} ({state.get('runs_this_cycle', 0)} run(s))"
    finished = state.get("cycles", [])
    if finished:
        last = finished[-1]
        words += f"; cycle {last['cycle']} took {last['runs']} run(s), {last['started']} to {last['finished']}"
    elif done and total:
        per_run = done / max(1, state.get("runs_this_cycle", 1))
        words += f"; at this pace a whole cycle takes about {math.ceil(total / per_run)} run(s)"
    return words


def record(args):
    mdir = os.path.join(args.dir, "mutants")
    os.makedirs(mdir, exist_ok=True)
    path = os.path.join(mdir, "rotation.json")
    when = args.when or time.strftime("%Y-%m-%d %H:%M", time.gmtime())
    results, baseline_failed, plan = results_in(args.incoming)
    state, new, fig = merge(load_state(path), results, plan, when, args.commit)
    with open(path, "w") as f:
        json.dump(state, f, indent=1, sort_keys=True)
        f.write("\n")
    missed = sorted({m for u in state["units"].values() for m in u.get("missed", [])})
    with open(os.path.join(mdir, "missed.txt"), "w") as f:
        f.writelines(m + "\n" for m in missed)
    log = os.path.join(mdir, "rotation-log.csv")
    if not os.path.exists(log):
        with open(log, "w") as f:
            f.write("finished,commit,branch,cycle,units_done,units_tried,mutants_tested,caught,missed,timeout,unviable,new_missed,run\n")
    with open(log, "a") as f:
        f.write(f"{when},{args.commit[:7]},{args.branch},{state['cycle']},{fig['done']},{fig['tried']},{fig['tested']},{fig['caught']},"
                f"{fig['missed']},{fig['timeout']},{fig['unviable']},{len(new)},{args.run_url}\n")
    with open(os.path.join(mdir, "summary.txt"), "w") as f:
        f.write(f"Mutation testing of the whole kernel, a slice a run (lib tests), {when} UTC, commit {args.commit[:7]}:\n")
        if baseline_failed:
            f.write("  the unmutated lib tests failed: nothing tested\n")
        f.write(f"  {cycle_line(state)}\n")
        f.write(f"  this run: {fig['done']} unit(s) done of {fig['tried']} started, {fig['tested']} mutants: caught {fig['caught']}, "
                f"missed {fig['missed']}, timed out {fig['timeout']}, unviable {fig['unviable']}; new survivors {len(new)}\n")
        f.write(f"  survivors in all: {len(missed)} (mutants/missed.txt); mutants/rotation-log.csv has one line a run\n")
    print(json.dumps({"baseline_failed": baseline_failed, "new": new, "units_done": fig["done"]}))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--job", type=int, required=True)
    r.add_argument("--jobs", type=int, required=True)
    r.add_argument("--deadline", type=float, required=True)
    r.add_argument("--state", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--scratch", default=os.environ.get("RUNNER_TEMP", "/tmp"))
    r.add_argument("--parallel", type=int, default=4)
    c = sub.add_parser("record")
    c.add_argument("--dir", required=True)
    c.add_argument("--in", dest="incoming", required=True)
    c.add_argument("--commit", required=True)
    c.add_argument("--branch", default="main")
    c.add_argument("--run-url", default="")
    c.add_argument("--when", default="")
    a = p.parse_args(argv)
    return run(a) if a.cmd == "run" else record(a)


if __name__ == "__main__":
    sys.exit(main())
