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


class TookNight(unittest.TestCase):
    def test_by_hand(self):
        # The kernel's night: its plan job succeeded (it fails when started too late).
        self.assertTrue(ng.took_night("kernel-nightly.yml", [{"name": "plan", "conclusion": "success"}]))
        self.assertFalse(ng.took_night("kernel-nightly.yml", [{"name": "plan", "conclusion": "failure"}]))
        # The app's: its journeys job exists and wasn't skipped (running, or finished either way).
        self.assertTrue(ng.took_night("nightly.yml", [{"name": "journeys", "conclusion": None}]))
        self.assertTrue(ng.took_night("nightly.yml", [{"name": "journeys", "conclusion": "failure"}]))
        self.assertFalse(ng.took_night("nightly.yml", [{"name": "journeys", "conclusion": "skipped"}]))
        self.assertFalse(ng.took_night("nightly.yml", [{"name": "gate", "conclusion": "success"}]))
        # Each workflow's rule only: a kernel-style plan job means nothing to the app's.
        self.assertFalse(ng.took_night("nightly.yml", [{"name": "plan", "conclusion": "success"}]))


class RoundTheClock(unittest.TestCase):
    """The daytime runs between nights (Ben, 2026-11-09)."""

    def test_the_daytime_window_by_hand(self):
        # The night's jobs stop at 22:35 UTC (6:35am Perth): the daytime
        # starts then. Its runs stop at 14:50 UTC, ten minutes before the
        # night's 15:00 start, and a run needs 30 minutes, so the last start
        # is 14:20 UTC.
        self.assertFalse(ng.day_open(at(22, 34, 59))[0])
        self.assertIn("night's hours", ng.day_open(at(22, 34, 59))[1])
        self.assertTrue(ng.day_open(at(22, 35))[0])
        self.assertTrue(ng.day_open(at(3, 0))[0])
        self.assertTrue(ng.day_open(at(14, 20))[0])
        self.assertFalse(ng.day_open(at(14, 20, 1))[0])
        self.assertIn("too late", ng.day_open(at(14, 20, 1))[1])
        for night in (at(14, 50), at(15, 0), at(18, 0), at(22, 5)):
            self.assertFalse(ng.day_open(night)[0], night)

    def test_the_cut_off_by_hand(self):
        # 03:00 UTC: today's 14:50. 23:00 UTC: tomorrow's.
        self.assertEqual(ng.day_end(at(3, 0)), at(14, 50))
        self.assertEqual(ng.day_end(at(23, 0)), at(14, 50, day=9))
        self.assertEqual(ng.day_end(at(14, 50)), at(14, 50, day=9))

    def test_the_last_start_at_0_9_and_1_1_of_the_half_hour(self):
        # 1.1 x 30 min = 33 min left (14:17): starts. 0.9 x 30 = 27 min left (14:23): doesn't.
        self.assertTrue(ng.day_open(at(14, 17))[0])
        self.assertFalse(ng.day_open(at(14, 23))[0])

    def test_daytime_and_night_never_overlap(self):
        # Every minute of two days: a daytime run may start only outside the
        # night's start window and outside its jobs' hours (15:00 to 22:35
        # UTC), and its cut-off is always before the next night starts.
        t = at(0, 0)
        while t < at(0, 0, day=10):
            if ng.day_open(t)[0]:
                self.assertFalse(ng.owed(t, []), t)
                self.assertFalse((15, 0) <= (t.hour, t.minute) < (22, 35), t)
                start, _ = ng.window(t)
                if t >= start:
                    start += datetime.timedelta(days=1)
                self.assertLessEqual(ng.day_end(t), start - datetime.timedelta(minutes=10), t)
                self.assertGreaterEqual((ng.day_end(t) - t).total_seconds(), ng.MIN_LEFT, t)
            t += datetime.timedelta(minutes=1)

    def test_the_switch_by_hand(self):
        self.assertTrue(ng.switch_on("on\n"))
        self.assertTrue(ng.switch_on("ON"))
        self.assertFalse(ng.switch_on("off\n"))
        self.assertFalse(ng.switch_on(""))
        self.assertFalse(ng.switch_on(None))
        self.assertFalse(ng.switch_on("onward"))

    def test_sleeps_hourly_while_on(self):
        self.assertEqual(ng.sleep_for(at(2, 0), False, True), 3600)
        self.assertEqual(ng.sleep_for(at(14, 59), False, True), 60)
        self.assertEqual(ng.sleep_for(at(16, 0), True, True), 600)
        # Off: as before.
        self.assertEqual(ng.sleep_for(at(2, 0), False, False), 19800)

    def test_a_clock_chain_with_the_switch_on_still_never_skips_a_night(self):
        for start in (at(0, 0), at(9, 13), at(15, 0), at(22, 40), at(23, 59)):
            now, woke = start, []
            while now < at(15, 1, day=10):
                if ng.owed(now, [] if now.day not in woke else [1]):
                    woke.append(now.day)
                    self.assertEqual((now.hour, now.minute), (15, 0), start)
                step = ng.sleep_for(now, False, True)
                self.assertLessEqual(step, 3600)
                now += datetime.timedelta(seconds=step)
            self.assertIn(9, woke, start)
            self.assertIn(10, woke, start)


FAKE_GH = r"""#!/usr/bin/env bash
# Plays `gh` (`workflow run` prints the new run's address, not JSON, as the
# real one does: the clock crashed on it on 11-08 and 11-09): today's runs 10 (a night whose plan was skipped: too early),
# 11 (a night whose plan succeeded), 12 (a branch's run on main) and 13 (a
# night still waiting), 14 (a daytime run waiting) and 15 (a daytime run
# running), 17 (the app's night, journeys ran) and 18 (the app's night,
# skipped at the gate); $FAKE_RUNS picks which are listed. The switch file says
# $FAKE_SWITCH; its read fails when $FAKE_SWITCH_FAILS is set.
echo "$*" >>"$FAKE_LOG"
case "$*" in
  *"/contents/.github/scripts/round_the_clock.txt?ref=main"*) [ -n "$FAKE_SWITCH_FAILS" ] && exit 1; echo "$FAKE_SWITCH";;
  "workflow run"*) [ -n "$FAKE_DISPATCH_FAILS" ] && exit 1; echo "https://github.com/o/r/actions/runs/99"; exit 0;;
  *"/workflows/"*)
    runs=""
    for id in $FAKE_RUNS; do
      case $id in
        12) title="Kernel random testing on main"; status=completed;;
        13) title="Kernel random testing, nightly"; status=queued;;
        14) title="Kernel random testing, daytime"; status=queued;;
        16) title="Random testing, daytime"; status=queued;;
        17|18) title="Random testing, nightly"; status=completed;;
        15) title="Kernel random testing, daytime"; status=in_progress;;
        *) title="Kernel random testing, nightly"; status=completed;;
      esac
      runs="$runs${runs:+,}{\"id\":$id,\"display_title\":\"$title\",\"status\":\"$status\"}"
    done
    echo "{\"workflow_runs\":[$runs]}";;
  *"/runs/10/jobs"*) echo '{"jobs":[{"name":"idle","conclusion":"success"},{"name":"plan","conclusion":"skipped"}]}';;
  *"/runs/11/jobs"*|*"/runs/12/jobs"*) echo '{"jobs":[{"name":"idle","conclusion":"success"},{"name":"plan","conclusion":"success"}]}';;
  *"/runs/13/jobs"*) echo '{"jobs":[{"name":"idle","conclusion":null}]}';;
  *"/runs/17/jobs"*) echo '{"jobs":[{"name":"gate","conclusion":"success"},{"name":"journeys","conclusion":"failure"}]}';;
  *"/runs/18/jobs"*) echo '{"jobs":[{"name":"gate","conclusion":"success"},{"name":"journeys","conclusion":"skipped"}]}';;
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
        for k in ("FAKE_DISPATCH_FAILS", "FAKE_SWITCH", "FAKE_SWITCH_FAILS"):
            self.env.pop(k, None)
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

    def run_clock(self, now, app=None, **extra):
        self.use(**extra)
        slept = []
        code = ng.clock(["", "clock", "kernel-nightly.yml", "kernel-night-clock.yml"] + ([app] if app else []), sleep=slept.append, clock_now=lambda: now)
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

    def test_switched_off_the_clock_queues_no_daytime_run(self):
        for extra in ({"FAKE_SWITCH": "off"}, {"FAKE_SWITCH": "on", "FAKE_SWITCH_FAILS": "1"}, {}):
            os.path.exists(self.log) and os.remove(self.log)
            code, slept, dispatched = self.run_clock(at(3, 0), FAKE_RUNS="", **extra)
            self.assertEqual(dispatched, ["workflow run kernel-night-clock.yml --repo o/r --ref main"], extra)
            self.assertEqual(slept, [19800], extra)

    def test_switched_on_the_clock_queues_the_next_daytime_run(self):
        # Nothing waiting, or one running (the new one waits behind it): queue one, wake within the hour.
        for runs in ("", "15", "10 11 12"):
            os.path.exists(self.log) and os.remove(self.log)
            code, slept, dispatched = self.run_clock(at(3, 0), FAKE_RUNS=runs, FAKE_SWITCH="on")
            self.assertEqual(code, 0)
            self.assertEqual(dispatched, ["workflow run kernel-nightly.yml --repo o/r --ref main -f day=true",
                                          "workflow run kernel-night-clock.yml --repo o/r --ref main"], runs)
            self.assertEqual(slept, [3600], runs)
        self.assertIn("api -H Accept: application/vnd.github.raw repos/o/r/contents/.github/scripts/round_the_clock.txt?ref=main", self.calls())

    def test_the_apps_daytime_runs_too(self):
        code, slept, dispatched = self.run_clock(at(3, 0), app="nightly.yml", FAKE_RUNS="", FAKE_SWITCH="on")
        self.assertEqual(dispatched, ["workflow run kernel-nightly.yml --repo o/r --ref main -f day=true",
                                      "workflow run nightly.yml --repo o/r --ref main -f day=true",
                                      "workflow run kernel-night-clock.yml --repo o/r --ref main"])
        # Each keeps its own one waiting: the kernel's waiting run doesn't hold up the app's, nor the other way round.
        for runs, queued in (("14", "nightly.yml"), ("16", "kernel-nightly.yml")):
            os.remove(self.log)
            code, slept, dispatched = self.run_clock(at(3, 0), app="nightly.yml", FAKE_RUNS=runs, FAKE_SWITCH="on")
            self.assertEqual(dispatched, [f"workflow run {queued} --repo o/r --ref main -f day=true",
                                          "workflow run kernel-night-clock.yml --repo o/r --ref main"], runs)
        # Switched off: neither.
        os.remove(self.log)
        code, slept, dispatched = self.run_clock(at(3, 0), app="nightly.yml", FAKE_RUNS="", FAKE_SWITCH="off")
        self.assertEqual(dispatched, ["workflow run kernel-night-clock.yml --repo o/r --ref main"])

    def test_the_clock_workflow_names_the_apps_testing(self):
        with open(os.path.join(os.path.dirname(HERE), "workflows", "kernel-night-clock.yml")) as f:
            self.assertIn("nightly_gate.py clock kernel-nightly.yml kernel-night-clock.yml nightly.yml", f.read())

    def test_daytime_monkey_seeds_by_hand(self):
        # nightly.yml's daytime seeds: 300,000,000 + 2 x minutes since 1970. At
        # 2026-11-09 03:00 UTC (1,794,193,200 s = 29,903,220 min) the first is
        # 300,000,000 + 59,806,440 = 359,806,440: above every night's seed
        # (2026MMDD0/1, at most 202,912,311) and below 2^31 - 1 = 2,147,483,647.
        t = int(at(3, 0, day=9).timestamp())
        self.assertEqual(t, 1794193200)
        first = 300000000 + 2 * (t // 60)
        self.assertEqual(first, 359806440)
        self.assertGreater(first, 202912311)
        # Still under 2^31 in 2500: about 300,000,000 + 2 x 279,000,000 minutes.
        far = int(datetime.datetime(2500, 1, 1, tzinfo=UTC).timestamp())
        self.assertLess(300000000 + 2 * (far // 60) + 3, 2**31 - 1)
        with open(os.path.join(os.path.dirname(HERE), "workflows", "nightly.yml")) as f:
            self.assertIn("first=$(( 300000000 + 2 * (now / 60) )) seeds=4", f.read())

    def test_the_apps_night_is_found_by_its_own_title_and_journeys(self):
        self.use(FAKE_RUNS="10 11 17 18")
        self.assertEqual(ng.nights_today("o/r", "nightly.yml", at(16, 17)), [(17, True, True), (18, True, False)])

    def test_the_clock_starts_the_apps_night_too(self):
        code, slept, dispatched = self.run_clock(at(15, 0), app="nightly.yml", FAKE_RUNS="")
        self.assertEqual(dispatched, ["workflow run kernel-nightly.yml --repo o/r --ref main -f night=true",
                                      "workflow run nightly.yml --repo o/r --ref main -f night=true",
                                      "workflow run kernel-night-clock.yml --repo o/r --ref main"])
        self.assertEqual(slept, [19800])
        # The kernel's night taken (11) and the app's (17): neither again.
        os.remove(self.log)
        code, slept, dispatched = self.run_clock(at(16, 0), app="nightly.yml", FAKE_RUNS="11 17")
        self.assertEqual(dispatched, ["workflow run kernel-night-clock.yml --repo o/r --ref main"])
        # The app's only night so far skipped at its gate (18): it is still owed.
        os.remove(self.log)
        code, slept, dispatched = self.run_clock(at(16, 0), app="nightly.yml", FAKE_RUNS="11 18")
        self.assertEqual(dispatched, ["workflow run nightly.yml --repo o/r --ref main -f night=true",
                                      "workflow run kernel-night-clock.yml --repo o/r --ref main"])

    def test_one_waiting_daytime_run_is_enough(self):
        code, slept, dispatched = self.run_clock(at(3, 0), FAKE_RUNS="14 15", FAKE_SWITCH="on")
        self.assertEqual(dispatched, ["workflow run kernel-night-clock.yml --repo o/r --ref main"])

    def test_no_daytime_run_in_the_nights_hours(self):
        # 18:00 UTC with tonight running: switched on, but it is the night's.
        code, slept, dispatched = self.run_clock(at(18, 0), FAKE_RUNS="11", FAKE_SWITCH="on")
        self.assertEqual(dispatched, ["workflow run kernel-night-clock.yml --repo o/r --ref main"])
        self.assertEqual(slept, [3600])
        # 15:00 UTC: the night starts, and no daytime run beside it.
        os.remove(self.log)
        code, slept, dispatched = self.run_clock(at(15, 0), FAKE_RUNS="", FAKE_SWITCH="on")
        self.assertEqual(dispatched, ["workflow run kernel-nightly.yml --repo o/r --ref main -f night=true",
                                      "workflow run kernel-night-clock.yml --repo o/r --ref main"])

    def gate_day(self, **extra):
        out = os.path.join(self.dir.name, "out")
        env = dict(self.env, NIGHT="false", DAY="true", GITHUB_OUTPUT=out, **extra)
        p = subprocess.run([sys.executable, os.path.join(HERE, "nightly_gate.py"), "gate", "kernel-nightly.yml"], env=env,
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        with open(out) as f:
            return f.read(), p.stdout

    def test_a_daytime_run_skips_once_switched_off(self):
        for extra in ({"FAKE_SWITCH": "off"}, {"FAKE_SWITCH": "on", "FAKE_SWITCH_FAILS": "1"}):
            os.path.exists(os.path.join(self.dir.name, "out")) and os.remove(os.path.join(self.dir.name, "out"))
            got, said = self.gate_day(**extra)
            self.assertEqual(got, "go=false\n", extra)
            self.assertIn("switched off", said, extra)

    def test_a_daytime_run_switched_on_follows_the_window(self):
        got, said = self.gate_day(FAKE_SWITCH="on")
        self.assertEqual(got, f"go={'true' if ng.day_open(datetime.datetime.now(UTC))[0] else 'false'}\n", said)


if __name__ == "__main__":
    unittest.main()
