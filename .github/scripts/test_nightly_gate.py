"""Tests for nightly_gate.py: python3 -m unittest discover -s .github/scripts"""

import datetime
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nightly_gate as ng  # noqa: E402

UTC = datetime.timezone.utc


def at(h, m, s=0, day=8):
    return datetime.datetime(2026, 11, day, h, m, s, tzinfo=UTC)


class Decide(unittest.TestCase):
    def test_the_window_by_hand(self):
        # The night starts at 15:00 UTC (11pm Perth); the cut-off is 22:35
        # UTC and a night needs 30 minutes, so the last start is 22:05.
        self.assertEqual(ng.window(at(18, 0)), (at(15, 0), at(22, 5)))

    def test_a_run_before_the_window_waits_for_a_later_one(self):
        go, why = ng.decide(at(14, 59, 59), 1, [])
        self.assertFalse(go)
        self.assertIn("too early", why)
        self.assertTrue(ng.decide(at(15, 0), 1, [])[0])

    def test_a_run_after_the_last_start_skips(self):
        self.assertTrue(ng.decide(at(22, 5), 1, [])[0])
        go, why = ng.decide(at(22, 5, 1), 1, [])
        self.assertFalse(go)
        self.assertIn("too late", why)

    def test_a_night_already_planned_today_is_not_started_twice(self):
        go, why = ng.decide(at(16, 17), 2, [1])
        self.assertFalse(go)
        self.assertIn("run 1", why)

    def test_the_run_itself_does_not_count(self):
        self.assertTrue(ng.decide(at(16, 17), 2, [2])[0])


class Clock(unittest.TestCase):
    def test_owed_only_inside_the_window_and_only_once(self):
        self.assertFalse(ng.owed(at(14, 59, 59), []))
        self.assertTrue(ng.owed(at(15, 0), []))
        self.assertTrue(ng.owed(at(22, 5), []))
        self.assertFalse(ng.owed(at(22, 5, 1), []))
        self.assertFalse(ng.owed(at(16, 0), [7]))

    def test_sleeps_by_hand(self):
        # 10:00 UTC: 5 h to 15:00, under the 5.5 h hop, so it wakes at 15:00.
        self.assertEqual(ng.sleep_for(at(10, 0), False), 5 * 3600)
        # 02:00 UTC: 13 h to 15:00, so one full hop of 5.5 h (19,800 s).
        self.assertEqual(ng.sleep_for(at(2, 0), False), 19800)
        # 15:00 UTC, tonight's run just started: the next night is tomorrow's.
        self.assertEqual(ng.sleep_for(at(15, 0), False), 19800)
        # 23:00 UTC: 16 h to tomorrow's 15:00, one hop.
        self.assertEqual(ng.sleep_for(at(23, 0), False), 19800)
        # 14:59 UTC: one minute.
        self.assertEqual(ng.sleep_for(at(14, 59), False), 60)
        # Tonight's run could not be started: try again in ten minutes.
        self.assertEqual(ng.sleep_for(at(16, 0), True), 600)

    def test_a_clock_chain_never_skips_a_night(self):
        # Hop by hop through two days from any start: each night's start is
        # reached exactly (a clock run wakes at 15:00, not after it).
        for start in (at(0, 0), at(9, 13), at(15, 0), at(22, 40), at(23, 59)):
            now, woke = start, []
            while now < at(15, 1, day=10):
                if ng.owed(now, [] if now.day not in woke else [1]):
                    woke.append(now.day)
                    self.assertEqual((now.hour, now.minute), (15, 0), start)
                now += datetime.timedelta(seconds=ng.sleep_for(now, False))
            self.assertIn(10, woke, start)
            self.assertIn(9, woke, start)


FAKE_GH = r"""#!/usr/bin/env bash
# Plays `gh`: today's runs 10 (a night whose plan was skipped: too early),
# 11 (a night whose plan succeeded), 12 (a branch's run on main) and 13 (a
# night still waiting); $FAKE_RUNS picks which are listed.
echo "$*" >>"$FAKE_LOG"
case "$*" in
  "workflow run"*) [ -n "$FAKE_DISPATCH_FAILS" ] && exit 1; exit 0;;
  *"/workflows/"*)
    runs=""
    for id in $FAKE_RUNS; do
      case $id in
        12) title="Kernel random testing on main"; status=completed;;
        13) title="Kernel random testing, nightly"; status=queued;;
        *) title="Kernel random testing, nightly"; status=completed;;
      esac
      runs="$runs${runs:+,}{\"id\":$id,\"display_title\":\"$title\",\"status\":\"$status\"}"
    done
    echo "{\"workflow_runs\":[$runs]}";;
  *"/runs/10/jobs"*) echo '{"jobs":[{"name":"idle","conclusion":"success"},{"name":"plan","conclusion":"skipped"}]}';;
  *"/runs/11/jobs"*|*"/runs/12/jobs"*) echo '{"jobs":[{"name":"idle","conclusion":"success"},{"name":"plan","conclusion":"success"}]}';;
  *"/runs/13/jobs"*) echo '{"jobs":[{"name":"idle","conclusion":null}]}';;
esac
"""


class WithFakeGh(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = self.dir.name
        os.makedirs(os.path.join(d, "bin"))
        with open(os.path.join(d, "bin", "gh"), "w") as f:
            f.write(FAKE_GH)
        os.chmod(os.path.join(d, "bin", "gh"), 0o755)
        self.log = os.path.join(d, "log")
        self.env = dict(os.environ, PATH=os.path.join(d, "bin") + os.pathsep + os.environ["PATH"], FAKE_LOG=self.log,
                        FAKE_RUNS="10 11 12", GITHUB_REPOSITORY="o/r")
        self.env.pop("FAKE_DISPATCH_FAILS", None)
        self.old = os.environ.copy()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old)
        self.dir.cleanup()

    def use(self, **extra):
        os.environ.clear()
        os.environ.update(self.env, **extra)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as f:
            return f.read().splitlines()

    def test_only_a_night_whose_plan_succeeded_counts_as_planned(self):
        self.use()
        nights = ng.nights_today("o/r", "kernel-nightly.yml", at(16, 17))
        self.assertEqual(nights, [(10, True, False), (11, True, True)])
        self.assertIn("repos/o/r/actions/workflows/kernel-nightly.yml/runs?created=%3E%3D2026-11-08T14:00:00Z", self.calls()[0])

    def test_a_branch_run_always_goes(self):
        out = os.path.join(self.dir.name, "out")
        env = dict(self.env, NIGHT="false", GITHUB_OUTPUT=out)
        p = subprocess.run([sys.executable, os.path.join(HERE, "nightly_gate.py"), "gate", "kernel-nightly.yml"], env=env,
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        with open(out) as f:
            self.assertEqual(f.read(), "go=true\n")
        self.assertEqual(self.calls(), [])

    def run_clock(self, now, **extra):
        self.use(**extra)
        slept = []
        code = ng.clock(["", "clock", "kernel-nightly.yml", "kernel-night-clock.yml"], sleep=slept.append, clock_now=lambda: now)
        dispatched = [c for c in self.calls() if c.startswith("workflow run")]
        return code, slept, dispatched

    def test_the_clock_starts_tonight_then_the_next_clock(self):
        # Runs 10 (plan skipped) and 12 (a branch's) don't take the night.
        code, slept, dispatched = self.run_clock(at(15, 0), FAKE_RUNS="10 12")
        self.assertEqual(code, 0)
        self.assertEqual(dispatched, ["workflow run kernel-nightly.yml --repo o/r --ref main -f night=true",
                                      "workflow run kernel-night-clock.yml --repo o/r --ref main"])
        self.assertEqual(slept, [19800])

    def test_the_clock_never_starts_a_second_night(self):
        for runs in ("11", "13"):  # planned, or still waiting
            os.path.exists(self.log) and os.remove(self.log)
            code, _, dispatched = self.run_clock(at(16, 0), FAKE_RUNS=runs)
            self.assertEqual(dispatched, ["workflow run kernel-night-clock.yml --repo o/r --ref main"], runs)

    def test_outside_the_window_the_clock_only_sleeps(self):
        code, slept, dispatched = self.run_clock(at(11, 0), FAKE_RUNS="")
        self.assertEqual(slept, [4 * 3600])
        self.assertEqual(dispatched, ["workflow run kernel-night-clock.yml --repo o/r --ref main"])

    def test_a_failed_start_is_tried_again_soon(self):
        code, slept, dispatched = self.run_clock(at(15, 0), FAKE_RUNS="", FAKE_DISPATCH_FAILS="1")
        # Tonight's start fails: sleep ten minutes (not until tomorrow); the
        # next clock run's start fails three times (30 s apart) and the run fails.
        self.assertEqual(slept, [600, 30, 30])
        self.assertEqual(code, 1)
        self.assertEqual(len(dispatched), 4)


if __name__ == "__main__":
    unittest.main()
