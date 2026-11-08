"""Whether a scheduled kernel-nightly.yml run starts tonight's testing
(its `idle` job's first step; tested in test_nightly_gate.py).

GitHub starts scheduled runs late, sometimes by hours (11-06: 5.5 h, 11-07:
4 h, each cutting the night to an hour or three before the 22:35 UTC
cut-off). So the workflow is scheduled every hour from 10:17 to 21:17 UTC
and the first run that lands inside the night's window takes it:

  - before 15:00 UTC: too early (Perth's 11pm; the day's CI comes first);
  - less than 30 minutes before 22:35 UTC: too late (as the plan job says);
  - a scheduled run of the workflow already planned a night today (its
    `plan` job succeeded): taken.

Runs of the workflow share one concurrency group, so a run asking here is
never alongside tonight's: an earlier one has either finished or not
started. A failed lookup counts as "not taken" (only an earlier night that
ended early could be missed, and starting a second is the better mistake).

  nightly_gate.py <workflow file>
      prints why, and writes go=true|false to $GITHUB_OUTPUT. A run that
      isn't scheduled (workflow_dispatch) always goes. Needs GH_TOKEN,
      GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_EVENT_NAME.
"""

import datetime
import json
import os
import subprocess
import sys

START_HOUR = 15  # UTC: 11pm Perth
CUT_OFF = (22, 35)  # UTC: 6:35am Perth, as the plan job's deadline
MIN_LEFT = 1800  # seconds: as the plan job's "started too late"


def window(now):
    """(start, last start) of the night window on now's UTC day."""
    day = now.astimezone(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start = day.replace(hour=START_HOUR)
    last = day.replace(hour=CUT_OFF[0], minute=CUT_OFF[1]) - datetime.timedelta(seconds=MIN_LEFT)
    return start, last


def decide(now, own_id, planned_ids):
    """(go, why). planned_ids: ids of today's scheduled runs whose plan job
    succeeded (from 14:00 UTC on)."""
    start, last = window(now)
    if now < start:
        return False, f"too early ({now:%H:%M} UTC; the night starts at {start:%H:%M} UTC)"
    if now > last:
        return False, f"too late ({now:%H:%M} UTC; a night must start by {last:%H:%M} UTC)"
    others = [i for i in planned_ids if i != own_id]
    if others:
        return False, f"tonight's testing already started (run {others[0]})"
    return True, f"starting tonight's testing ({now:%H:%M} UTC)"


def gh(path):
    return json.loads(subprocess.run(["gh", "api", path], check=True, capture_output=True, text=True, timeout=60).stdout)


def planned_today(repo, workflow, now):
    since = now.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT14:00:00Z")
    runs = gh(f"repos/{repo}/actions/workflows/{workflow}/runs?event=schedule&created=%3E%3D{since}&per_page=50")["workflow_runs"]
    ids = []
    for run in runs:
        jobs = gh(f"repos/{repo}/actions/runs/{run['id']}/jobs?per_page=100")["jobs"]
        if any(j["name"] == "plan" and j.get("conclusion") == "success" for j in jobs):
            ids.append(run["id"])
    return ids


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    now = datetime.datetime.now(datetime.timezone.utc)
    if os.environ.get("GITHUB_EVENT_NAME") != "schedule":
        go, why = True, "started by hand"
    else:
        own = int(os.environ.get("GITHUB_RUN_ID", "0"))
        try:
            planned = planned_today(os.environ["GITHUB_REPOSITORY"], argv[1], now)
        except (subprocess.SubprocessError, ValueError, KeyError, TypeError) as e:
            print(f"could not list today's runs ({type(e).__name__}); counting tonight as not taken")
            planned = []
        go, why = decide(now, own, planned)
    print(why)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"go={'true' if go else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
