"""Starting the kernel's night of random testing (kernel-nightly.yml) on time,
without GitHub's schedule; tested in test_nightly_gate.py.

GitHub starts this repo's scheduled runs hours late or not at all (11-06:
5.5 h late, 11-07: 4 h, 11-08: none of twelve hourly runs, and the
half-hourly auto-merge schedule about one run in eight). A run started by
workflow_dispatch starts within seconds, so a clock does it instead
(kernel-night-clock.yml): one run at a time sleeps on a runner until the next
night (at most 5.5 hours, a job's limit is 6), then starts the next clock
run; one that finds the night's window open and the night not yet taken
starts tonight's run (kernel-nightly.yml with night=true). The clock's
hourly schedule only restarts a clock that stopped.

The night's window, on the UTC day:
  - from 15:00 UTC (Perth's 11pm; the day's CI comes first);
  - until 30 minutes before the 22:35 UTC cut-off (as the plan job's
    "started too late"), so a night starts by 22:05 UTC.

  nightly_gate.py gate <workflow file>
      kernel-nightly.yml's `idle` job: a night run goes only inside the
      window and if no earlier night run today planned a night (its `plan`
      job succeeded); a branch's run always goes. Prints why and writes
      go=true|false to $GITHUB_OUTPUT. Needs NIGHT, GH_TOKEN,
      GITHUB_REPOSITORY, GITHUB_RUN_ID.
  nightly_gate.py clock <night workflow> <clock workflow>
      kernel-night-clock.yml: starts tonight's run if it is owed (inside the
      window, and no night run today is waiting, running or planned a
      night), sleeps, then starts the next clock run. Needs GH_TOKEN,
      GITHUB_REPOSITORY.

A failed lookup counts as "not taken": only a second night could follow,
and that is the better mistake (the night runs share one concurrency group,
so the second one waits and then finds the first).
"""

import datetime
import json
import os
import subprocess
import sys
import time

START_HOUR = 15  # UTC: 11pm Perth
CUT_OFF = (22, 35)  # UTC: 6:35am Perth, as the plan job's deadline
MIN_LEFT = 1800  # seconds: as the plan job's "started too late"
NIGHT_TITLE = "Kernel random testing, nightly"  # kernel-nightly.yml's run-name for a night
HOP = 19800  # seconds a clock run sleeps at most: 5.5 hours, inside the job's 360 minutes
RETRY = 600  # seconds before trying again when tonight's run could not be started


def window(now):
    """(start, last start) of the night window on now's UTC day."""
    day = now.astimezone(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start = day.replace(hour=START_HOUR)
    last = day.replace(hour=CUT_OFF[0], minute=CUT_OFF[1]) - datetime.timedelta(seconds=MIN_LEFT)
    return start, last


def decide(now, own_id, planned_ids):
    """(go, why) for a night run. planned_ids: ids of today's night runs whose
    plan job succeeded (from 14:00 UTC on)."""
    start, last = window(now)
    if now < start:
        return False, f"too early ({now:%H:%M} UTC; the night starts at {start:%H:%M} UTC)"
    if now > last:
        return False, f"too late ({now:%H:%M} UTC; a night must start by {last:%H:%M} UTC)"
    others = [i for i in planned_ids if i != own_id]
    if others:
        return False, f"tonight's testing already started (run {others[0]})"
    return True, f"starting tonight's testing ({now:%H:%M} UTC)"


def owed(now, taken_ids):
    """Whether the clock should start tonight's run now. taken_ids: today's
    night runs that are waiting, running, or planned a night."""
    start, last = window(now)
    return start <= now <= last and not taken_ids


def sleep_for(now, still_owed):
    """Seconds the clock sleeps before starting the next clock run: until the
    next night's start, at most HOP; RETRY while tonight's run is owed."""
    if still_owed:
        return RETRY
    start, _ = window(now)
    if now >= start:
        start += datetime.timedelta(days=1)
    return max(0, min(HOP, int((start - now).total_seconds())))


def gh(*args):
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True, timeout=60).stdout
    return json.loads(out) if out.strip() else None


def nights_today(repo, workflow, now):
    """Today's night runs (by their title) created from 14:00 UTC on, each as
    (id, finished, planned): planned when its plan job succeeded."""
    since = now.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT14:00:00Z")
    runs = gh("api", f"repos/{repo}/actions/workflows/{workflow}/runs?created=%3E%3D{since}&per_page=100")["workflow_runs"]
    out = []
    for run in runs:
        if run.get("display_title") != NIGHT_TITLE:
            continue
        jobs = gh("api", f"repos/{repo}/actions/runs/{run['id']}/jobs?per_page=100")["jobs"]
        planned = any(j["name"] == "plan" and j.get("conclusion") == "success" for j in jobs)
        out.append((run["id"], run.get("status") == "completed", planned))
    return out


def lookup(repo, workflow, now):
    try:
        return nights_today(repo, workflow, now)
    except (subprocess.SubprocessError, ValueError, KeyError, TypeError) as e:
        print(f"could not list today's runs ({type(e).__name__}); counting tonight as not taken")
        return []


def gate(argv):
    now = datetime.datetime.now(datetime.timezone.utc)
    if os.environ.get("NIGHT") != "true":
        go, why = True, "a branch's run"
    else:
        nights = lookup(os.environ["GITHUB_REPOSITORY"], argv[2], now)
        go, why = decide(now, int(os.environ.get("GITHUB_RUN_ID", "0")), [i for i, _, planned in nights if planned])
    print(why)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"go={'true' if go else 'false'}\n")
    return 0


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def clock(argv, sleep=time.sleep, clock_now=utc_now):
    repo, night, me = os.environ["GITHUB_REPOSITORY"], argv[2], argv[3]
    now = clock_now()
    taken = [i for i, finished, planned in lookup(repo, night, now) if planned or not finished]
    due = owed(now, taken)
    if due:
        try:
            gh("workflow", "run", night, "--repo", repo, "--ref", "main", "-f", "night=true")
            print(f"started tonight's testing ({now:%H:%M} UTC)")
            due = False
        except subprocess.SubprocessError as e:
            print(f"could not start tonight's testing ({type(e).__name__}); trying again soon")
    elif taken:
        print(f"tonight's testing already started (run {taken[0]})")
    wait = sleep_for(clock_now(), due)
    print(f"sleeping {wait // 60} minutes")
    sleep(wait)
    # The next clock run waits in the clock's concurrency group until this one
    # ends. Three tries; if all fail, the clock's hourly schedule restarts it.
    for attempt in range(3):
        try:
            gh("workflow", "run", me, "--repo", repo, "--ref", "main")
            print("started the next clock run")
            return 0
        except subprocess.SubprocessError as e:
            print(f"could not start the next clock run ({type(e).__name__})")
            if attempt < 2:
                sleep(30)
    return 1


def main(argv):
    if len(argv) == 3 and argv[1] == "gate":
        return gate(argv)
    if len(argv) == 4 and argv[1] == "clock":
        return clock(argv)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
