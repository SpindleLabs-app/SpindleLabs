"""The nightly long monkey sessions (hunt 3f): turns apps/fission/e2e/monkey.mjs's
output into the night's report and one failure folder per failing seed.

  python3 monkey_night.py <monkey log> <monkey-results dir> <out dir> <first seed> <seeds> <steps> [combine]

The monkey prints one line per seed ("seed 7: pass (2000 actions)" or
"seed 7: FAIL at action 65: <check>: <message>"), then for a failure the
shrunk action list, saved as <monkey-results>/seed-7.json. This writes
<out>/report.txt (a first line counting the night, then each seed's line)
and, per failing seed, <out>/seed-monkey-<seed>/monkey-report.txt (the
same first line, then 'failure: <check>: <message> | <where>; replay: ...',
the line file_issues.py reads) next to the shrunk list as actions.json.
A seed the log never reports (the job ran out of time, or the tester
crashed) is a failure of its own; one the monkey itself stopped on its time
limit (MONKEY_MINUTES: "seed 7: cut off after 900 actions …", or "seed 7:
not started …") is not, but a run in which every seed was stopped so is
(folder seed-monkey-time): a night that tested nothing must not read
as clean. So is the monkey's own self-test failing ("self-test <name>: FAIL:
<message>", before the seeds; folder seed-monkey-self-test), and so is a
"monkey: N failed" summary counting more failures than the log has FAIL
lines (folder seed-monkey-unexplained): the monkey's count is the last word.

With "combine" (the nightly job, 35f1d) the night must also have tried a
Combine: the monkey ends with "monkey: N Combines made, M tried" (tried: OK
pressed with both bodies picked, so the kernel answered, made or refused in
words; curved bodies are refused until step 37), the report's first line
says both, and a night with none tried (or no such line) is a failure of
its own (folder seed-monkey-combine): the hidden Combine tool went
untested, as it would if ?combine were dropped from the monkey's address.

Exit code: 1 when any seed failed or went unreported, else 0."""

import json
import os
import re
import shutil
import sys

LINE = re.compile(r"^seed (\d+): (pass \((\d+) actions.*\)|FAIL at action (\d+): (.*))$")
# The monkey's own time limit (MONKEY_MINUTES, issues #476 and #477): a session it stopped, and a seed it never began.
CUT = re.compile(r"^seed (\d+): cut off after (\d+) actions\b")
NOT_STARTED = re.compile(r"^seed (\d+): not started\b")
SELF_TEST = re.compile(r"^(self-test .+?): FAIL: (.*)$")
SUMMARY = re.compile(r"^monkey: (\d+) failed$")
COMBINES = re.compile(r"^monkey: (\d+) Combines? made, (\d+) tried$")
# Every failure monkey.mjs counts prints one unindented "<name>: FAIL" line.
ANY_FAIL = re.compile(r"^\S.*?: FAIL\b")


def parse(log):
    """{seed: (passed, actions, failure text)} from the monkey's output; passed is
    "cut" for a session the time limit stopped (actions: how many it did) and
    "not started" for a seed it never began (0 actions), neither a failure."""
    seen = {}
    for line in log.splitlines():
        cut, waiting = CUT.match(line.strip()), NOT_STARTED.match(line.strip())
        if cut:
            seen[int(cut.group(1))] = ("cut", int(cut.group(2)), "")
        elif waiting:
            seen[int(waiting.group(1))] = ("not started", 0, "")
        m = LINE.match(line.strip())
        if not m:
            continue
        seed = int(m.group(1))
        if m.group(3) is not None:
            seen[seed] = (True, int(m.group(3)), "")
        else:
            seen[seed] = (False, int(m.group(4)), m.group(5))
    return seen


def others(log):
    """[(folder, report line, failure text, where)] for the failures that
    aren't a seed's: each failing self-test, then any the monkey counted but
    printed no FAIL line for."""
    lines = log.splitlines()
    found = [("self-test", m.group(0), f"{m.group(1)}: {m.group(2)}", "the self-test")
             for m in (SELF_TEST.match(line.strip()) for line in lines) if m]
    shown = sum(1 for line in lines if ANY_FAIL.match(line))
    counted = max([int(m.group(1)) for m in (SUMMARY.match(line.strip()) for line in lines) if m], default=0)
    if counted > shown:
        text = f"the monkey counted {counted} failed but its log shows {shown} FAIL line(s)"
        found.append(("unexplained", f"FAIL: {text}", text, "the monkey's summary"))
    return found


def how_kept(saved):
    """A line on how the monkey kept a failed session's actions (issue #248), or "" when it shrank them in full."""
    try:
        with open(saved) as f:
            kept = json.load(f)
    except (OSError, ValueError):
        return ""
    if not isinstance(kept, dict):
        return ""
    if kept.get("replayed") is False:
        return "actions.json: the whole session; its actions did not fail again when replayed, so it is a timing failure (a slow runner or a race)"
    if kept.get("outOfTime") and kept.get("shrunk") is False:
        return "actions.json: the whole session; the run's time limit came before it was replayed"
    if kept.get("outOfTime"):
        return "actions.json: the shortest list found before shrinking ran out of time, not the shortest there is"
    if kept.get("shrunk") is False:
        return "actions.json: the whole session; the job ended before it was replayed"
    return ""


def combines(log):
    """The Combines the monkey says it made and tried ("monkey: N Combines made, M tried"), or None when it never said."""
    said = [(int(m.group(1)), int(m.group(2))) for m in (COMBINES.match(line.strip()) for line in log.splitlines()) if m]
    return said[-1] if said else None


def stopped(seeds, seen):
    """"; 1 cut off and 1 not started by the time limit" for the head line, or "" when every session ran to its end."""
    cut = sum(1 for s in seeds if s in seen and seen[s][0] == "cut")
    waiting = sum(1 for s in seeds if s in seen and seen[s][0] == "not started")
    said = [f"{cut} cut off"] * bool(cut) + [f"{waiting} not started"] * bool(waiting)
    return f"; {' and '.join(said)} by the time limit" if said else ""


def write(log, results, out, first, count, steps, combine=False):
    """Writes the report and failure folders; returns the number of failed seeds."""
    seeds = list(range(first, first + count))
    seen = parse(log)
    failed = [s for s in seeds if s not in seen or seen[s][0] is False]
    extra = others(log)
    # Stopping on time is no failure, but a run in which no session reached its end (passed or failed) tested
    # too little to say anything, and must not read as clean.
    if seeds and all(s in seen and seen[s][0] in ("cut", "not started") for s in seeds):
        text = "no session finished in the run's time limit (each was cut off or never started), so the run tested too little"
        extra.append(("time", f"FAIL: {text}", text, "the run's sessions"))
    said = combines(log)
    made, tried = said if said else (0, 0)
    if combine and not tried:
        text = ("the monkey tried no Combine in the night's sessions, so the hidden Combine tool went untested (is ?combine still in its address?)"
                if said else "the monkey never said how many Combines it made (no \"monkey: N Combines made, M tried\" line)")
        extra.append(("combine", f"FAIL: {text}", text, "the night's sessions"))
    total = len(failed) + len(extra)
    made_words = f"; {made} Combine{'' if made == 1 else 's'} made of {tried} tried" if combine else ""
    head = (f"Monkey, seeds {first}-{first + count - 1}: {count} session(s) of {steps} actions in Chromium{made_words}; "
            + (f"{total} FAILED" if total else "every check passed after every action") + stopped(seeds, seen))
    replay = "cd apps/fission && npm run build && FISSION_SEED={seed} MONKEY_STEPS={steps} node e2e/monkey.mjs"
    lines = [head]
    os.makedirs(out, exist_ok=True)
    for name, line, text, where in extra:
        # The self-test runs before any seed: one short session replays it.
        lines.append(line)
        folder = os.path.join(out, f"seed-monkey-{name}")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "monkey-report.txt"), "w") as f:
            f.write(f"{head}\nfailure: {text} | {where}; replay: {replay.format(seed=first, steps=1)}\n")
    for seed in seeds:
        if seed not in seen:
            text = "no result: the session never finished (job out of time, or the tester crashed)"
            where = f"seed {seed}"
        else:
            passed, actions, text = seen[seed]
            if passed == "cut":
                lines.append(f"seed {seed}: cut off after {actions} actions by the time limit (every check passed until then)")
                continue
            if passed == "not started":
                lines.append(f"seed {seed}: not started (the time limit came first)")
                continue
            if passed:
                lines.append(f"seed {seed}: pass ({actions} actions)")
                continue
            where = f"seed {seed} at action {actions}"
        lines.append(f"seed {seed}: FAIL: {text}")
        folder = os.path.join(out, f"seed-monkey-{seed}")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "monkey-report.txt"), "w") as f:
            f.write(f"{head}\nfailure: {text} | {where}; replay: {replay.format(seed=seed, steps=steps)}\n")
        saved = os.path.join(results, f"seed-{seed}.json")
        if os.path.isfile(saved):
            shutil.copy(saved, os.path.join(folder, "actions.json"))
            note = how_kept(saved)
            if note:
                with open(os.path.join(folder, "monkey-report.txt"), "a") as f:
                    f.write(note + "\n")
    with open(os.path.join(out, "report.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    return total


def main(argv):
    log_path, results, out, first, count, steps = argv[:6]
    log = open(log_path, errors="replace").read() if os.path.isfile(log_path) else ""
    failed = write(log, results, out, int(first), int(count), int(steps), combine=argv[6:7] == ["combine"])
    print(open(os.path.join(out, "report.txt")).read(), end="")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
