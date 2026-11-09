"""Starting the kernel's night of random testing (kernel-nightly.yml) on time,
without GitHub's schedule; tested in test_nightly_gate.py.

GitHub starts this repo's scheduled runs hours late or not at all (11-06:
5.5 h late, 11-07: 4 h, 11-08: none of twelve hourly runs, and the
half-hourly auto-merge schedule about one run in eight). A run started by
workflow_dispatch starts within seconds, so a clock does it instead
(kernel-night-clock.yml): one run at a time sleeps on a runner until the next
night (at most 5.5 hours, a job's limit is 6), then starts the next clock
run; one that finds the night's window open and the night not yet taken
starts tonight's run (kernel-nightly.yml with night=true), and, when the
app's workflow is named as the clock's last word, the app's night the same
way (nightly.yml with night=true: GitHub's 15:00 UTC schedule started it 4
to 6 hours late every night of 11-01 to 11-08; that schedule stays as a
spare, and its run skips at the gate once tonight is taken). The clock's
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

Round the clock (Ben, 2026-11-09: random testing every hour of the day,
until he says stop). While the switch file round_the_clock.txt on main says
`on`, the clock also keeps the daytime going between nights: from the
night's 22:35 UTC cut-off to 14:50 UTC (10:50pm Perth, ten minutes before
the next night), runs titled "Kernel random testing, daytime" test the
kernel's main back to back, each with fresh seeds, each at most `minutes`
long and never past 14:50 UTC. The clock keeps one waiting behind the one
running (the daytime runs share one concurrency group, so the waiting one
starts the moment the running one ends) and wakes at least hourly while the
switch is on. Every daytime job gives its runner to CI (stop-on-merge.sh),
so pull requests never wait for it. The switch is read from main each time
(a failed read counts as off): writing `off` there stops new daytime runs,
and a waiting one skips; the night is not affected.

With the app's random testing named too (`clock ... nightly.yml`), the clock
keeps its daytime runs ("Random testing, daytime": the monkey's long seeded
sessions with fresh seeds and the golden models) going the same way.

  nightly_gate.py gate <workflow file>
      with DAY=true: a daytime run goes only while the switch is on and
      inside the daytime window (at least 30 minutes before 14:50 UTC).
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
APP = "nightly.yml"  # the app's random testing
APP_NIGHT_TITLE = "Random testing, nightly"  # nightly.yml's run-name for a night
HOP = 19800  # seconds a clock run sleeps at most: 5.5 hours, inside the job's 360 minutes
RETRY = 600  # seconds before trying again when tonight's run could not be started
DAY_TITLE = "Kernel random testing, daytime"  # kernel-nightly.yml's run-name for a daytime run
APP_DAY_TITLE = "Random testing, daytime"  # nightly.yml's run-name for a daytime run
DAY_END = (14, 50)  # UTC: 10:50pm Perth, the daytime runs' cut-off, ten minutes before the night
DAY_HOP = 3600  # seconds a clock run sleeps at most while the switch is on
SWITCH = ".github/scripts/round_the_clock.txt"  # `on` or `off`, read from main
WAITING = {"queued", "pending", "waiting", "requested"}


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


def sleep_for(now, still_owed, round_the_clock=False):
    """Seconds the clock sleeps before starting the next clock run: until the
    next night's start, at most HOP (DAY_HOP while the switch is on); RETRY
    while tonight's run is owed."""
    if still_owed:
        return RETRY
    start, _ = window(now)
    if now >= start:
        start += datetime.timedelta(days=1)
    return max(0, min(DAY_HOP if round_the_clock else HOP, int((start - now).total_seconds())))


def day_end(now):
    """The daytime cut-off now falls before: the next 14:50 UTC."""
    utc = now.astimezone(datetime.timezone.utc)
    end = utc.replace(hour=DAY_END[0], minute=DAY_END[1], second=0, microsecond=0)
    return end if utc < end else end + datetime.timedelta(days=1)


def day_open(now):
    """(go, why) for starting a daytime run now: after the night's 22:35 UTC
    cut-off, and with at least MIN_LEFT before the daytime cut-off."""
    utc = now.astimezone(datetime.timezone.utc)
    end = day_end(utc)
    cut = utc.replace(hour=CUT_OFF[0], minute=CUT_OFF[1], second=0, microsecond=0)
    if end.date() > utc.date() and utc < cut:
        return False, f"the night's hours ({utc:%H:%M} UTC; the daytime starts at {cut:%H:%M} UTC)"
    if (end - utc).total_seconds() < MIN_LEFT:
        return False, f"too late ({utc:%H:%M} UTC; a daytime run must start by 30 minutes before {end:%H:%M} UTC)"
    return True, f"starting daytime testing ({utc:%H:%M} UTC, until {end:%H:%M} UTC at the latest)"


def switch_on(text):
    """The switch file says on: its first word, any case."""
    words = (text or "").split()
    return bool(words) and words[0].lower() == "on"


def gh(*args):
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True, timeout=60).stdout
    return json.loads(out) if out.strip() else None


def took_night(workflow, jobs):
    """Whether a night run's jobs show it took the night: kernel-nightly.yml's
    plan job succeeded (it fails when started too late); nightly.yml's
    journeys job exists and was not skipped (its gate let the night through)."""
    if workflow == APP:
        return any(j["name"] == "journeys" and j.get("conclusion") != "skipped" for j in jobs)
    return any(j["name"] == "plan" and j.get("conclusion") == "success" for j in jobs)


def nights_today(repo, workflow, now):
    """Today's night runs (by their title) created from 14:00 UTC on, each as
    (id, finished, planned): planned when it took the night (took_night)."""
    title = APP_NIGHT_TITLE if workflow == APP else NIGHT_TITLE
    since = now.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT14:00:00Z")
    runs = gh("api", f"repos/{repo}/actions/workflows/{workflow}/runs?created=%3E%3D{since}&per_page=100")["workflow_runs"]
    out = []
    for run in runs:
        if run.get("display_title") != title:
            continue
        jobs = gh("api", f"repos/{repo}/actions/runs/{run['id']}/jobs?per_page=100")["jobs"]
        planned = took_night(workflow, jobs)
        out.append((run["id"], run.get("status") == "completed", planned))
    return out


def lookup(repo, workflow, now):
    try:
        return nights_today(repo, workflow, now)
    except (subprocess.SubprocessError, ValueError, KeyError, TypeError) as e:
        print(f"could not list today's runs ({type(e).__name__}); counting tonight as not taken")
        return []


def read_switch(repo):
    """Whether round the clock is on, from main's switch file; off if it can't be read."""
    try:
        out = subprocess.run(["gh", "api", "-H", "Accept: application/vnd.github.raw", f"repos/{repo}/contents/{SWITCH}?ref=main"],
                             check=True, capture_output=True, text=True, timeout=60).stdout
    except subprocess.SubprocessError as e:
        print(f"could not read the round-the-clock switch ({type(e).__name__}); counting it as off")
        return False
    return switch_on(out)


def days_waiting(repo, workflow, title=DAY_TITLE):
    """Ids of daytime runs waiting to start; a failed lookup counts as none
    (a second waiting one only replaces the first: GitHub keeps one per group)."""
    try:
        runs = gh("api", f"repos/{repo}/actions/workflows/{workflow}/runs?per_page=30")["workflow_runs"]
    except (subprocess.SubprocessError, ValueError, KeyError, TypeError) as e:
        print(f"could not list the daytime runs ({type(e).__name__}); counting none as waiting")
        return []
    return [r["id"] for r in runs if r.get("display_title") == title and r.get("status") in WAITING]


def queue_day(repo, workflow, title, now):
    """Queues a daytime run of `workflow` unless one already waits."""
    waiting = days_waiting(repo, workflow, title)
    if waiting:
        print(f"the next daytime run of {workflow} is already waiting (run {waiting[0]})")
        return
    try:
        gh("workflow", "run", workflow, "--repo", repo, "--ref", "main", "-f", "day=true")
        print(f"queued daytime testing of {workflow} ({now:%H:%M} UTC)")
    except subprocess.SubprocessError as e:
        print(f"could not queue daytime testing of {workflow} ({type(e).__name__}); trying again next time")


def gate(argv):
    now = datetime.datetime.now(datetime.timezone.utc)
    if os.environ.get("DAY") == "true":
        if read_switch(os.environ["GITHUB_REPOSITORY"]):
            go, why = day_open(now)
        else:
            go, why = False, "round the clock is switched off"
    elif os.environ.get("NIGHT") != "true":
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
    app = argv[4] if len(argv) > 4 else None
    now = clock_now()
    due = False
    for workflow in (night, app) if app else (night,):
        taken = [i for i, finished, planned in lookup(repo, workflow, now) if planned or not finished]
        if owed(now, taken):
            try:
                gh("workflow", "run", workflow, "--repo", repo, "--ref", "main", "-f", "night=true")
                print(f"started tonight's testing of {workflow} ({now:%H:%M} UTC)")
            except subprocess.SubprocessError as e:
                print(f"could not start tonight's testing of {workflow} ({type(e).__name__}); trying again soon")
                due = True
        elif taken:
            print(f"tonight's testing of {workflow} already started (run {taken[0]})")
    on = read_switch(repo)
    if on and day_open(now)[0]:
        queue_day(repo, night, DAY_TITLE, now)
        if app:
            queue_day(repo, app, APP_DAY_TITLE, now)
    wait = sleep_for(clock_now(), due, on)
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
    if len(argv) in (4, 5) and argv[1] == "clock":
        return clock(argv)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
