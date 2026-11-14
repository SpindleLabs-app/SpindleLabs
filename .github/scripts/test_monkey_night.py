"""Tests for monkey_night.py and the monkey's part of collect-results.sh and
file_issues.py (hunt 3f): python3 -m unittest discover -s .github/scripts

The logs below are written the way apps/fission/e2e/monkey.mjs prints
(its `report`): one "seed N: pass (K actions)" or "seed N: FAIL at action K:
<check>: <message>" line per seed, the shrunk list after a failure.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

import monkey_night
from file_issues import kinds_of

HERE = os.path.dirname(os.path.abspath(__file__))

LOG = """seed 20261025: pass (2000 actions)
seed 20261026: FAIL at action 65: no sideways scrolling: the page is 4 px wider than the window
  shrunk to 3 actions in 41 replays:
    {"kind":"phone"}
  saved to /x/e2e/monkey-results/seed-20261026.json
monkey: 1 failed
"""


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


class Night(unittest.TestCase):
    def night(self, log, first=20261025, count=2, steps=2000, saved=(), how=None, combine=False):
        """Runs monkey_night.write; returns (failed, {relative path: text}). `how`: the fields the monkey adds to a saved list."""
        with tempfile.TemporaryDirectory() as d:
            results, out = os.path.join(d, "results"), os.path.join(d, "out")
            os.makedirs(results)
            for seed in saved:
                with open(os.path.join(results, f"seed-{seed}.json"), "w") as f:
                    json.dump({"seed": seed, **(how or {}), "actions": [{"kind": "phone"}]}, f)
            failed = monkey_night.write(log, results, out, first, count, steps, combine=combine)
            files = {}
            for root, _, names in os.walk(out):
                for n in names:
                    with open(os.path.join(root, n)) as f:
                        files[os.path.relpath(os.path.join(root, n), out)] = f.read()
            return failed, files

    def test_one_seed_failing_gets_its_folder(self):
        failed, files = self.night(LOG, saved=[20261026])
        self.assertEqual(failed, 1)
        # Worked from the log: seeds 20261025 and 20261026 (first 20261025, 2 seeds), the second failed.
        self.assertEqual(files["report.txt"],
                         "Monkey, seeds 20261025-20261026: 2 session(s) of 2000 actions in Chromium; 1 FAILED\n"
                         "seed 20261025: pass (2000 actions)\n"
                         "seed 20261026: FAIL: no sideways scrolling: the page is 4 px wider than the window\n")
        report = files["seed-monkey-20261026/monkey-report.txt"].splitlines()
        self.assertEqual(report[1],
                         "failure: no sideways scrolling: the page is 4 px wider than the window | seed 20261026 at action 65; "
                         "replay: cd apps/fission && npm run build && FISSION_SEED=20261026 MONKEY_STEPS=2000 node e2e/monkey.mjs")
        self.assertEqual(json.loads(files["seed-monkey-20261026/actions.json"])["actions"], [{"kind": "phone"}])
        self.assertNotIn("seed-monkey-20261025/monkey-report.txt", files)

    def test_how_the_actions_were_kept_is_said_after_the_failure_line(self):
        # Issue #248: a session that does not fail again on replay keeps its whole list, and the report says why.
        cases = [
            ({"shrunk": False, "replayed": False}, "actions.json: the whole session; its actions did not fail again when replayed, so it is a timing failure (a slow runner or a race)"),
            ({"shrunk": True, "replayed": True, "outOfTime": True}, "actions.json: the shortest list found before shrinking ran out of time, not the shortest there is"),
            ({"shrunk": False}, "actions.json: the whole session; the job ended before it was replayed"),
            # The monkey's own time limit came before the replay (issue #476): the whole list, said as such.
            ({"shrunk": False, "outOfTime": True}, "actions.json: the whole session; the run's time limit came before it was replayed"),
        ]
        for how, line in cases:
            with self.subTest(how=how):
                _, files = self.night(LOG, saved=[20261026], how=how)
                report = files["seed-monkey-20261026/monkey-report.txt"].splitlines()
                # The failure line stays second (file_issues.py reads it); the note is the third and last line.
                self.assertTrue(report[1].startswith("failure: no sideways scrolling"))
                self.assertEqual(report[2:], [line])
        # Shrunk in full (and an older list with no fields): nothing added.
        for how in ({"shrunk": True, "replayed": True}, None):
            with self.subTest(how=how):
                _, files = self.night(LOG, saved=[20261026], how=how)
                self.assertEqual(len(files["seed-monkey-20261026/monkey-report.txt"].splitlines()), 2)

    def test_a_clean_night(self):
        failed, files = self.night("seed 5: pass (2000 actions)\nseed 6: pass (2000 actions; known bug seen: x)\n", first=5)
        self.assertEqual(failed, 0)
        self.assertEqual(files["report.txt"].splitlines()[0],
                         "Monkey, seeds 5-6: 2 session(s) of 2000 actions in Chromium; every check passed after every action")
        self.assertEqual(sorted(files), ["report.txt"])

    def test_a_seed_never_reported_is_a_failure(self):
        # The job ran out of time during the second session: an empty
        # second line must not read as a clean night.
        failed, files = self.night("seed 5: pass (2000 actions)\n", first=5)
        self.assertEqual(failed, 1)
        self.assertIn("1 FAILED", files["report.txt"])
        self.assertIn("failure: no result: the session never finished", files["seed-monkey-6/monkey-report.txt"])
        # Nothing at all (the tester crashed before its first line): both seeds.
        failed, _ = self.night("", first=5)
        self.assertEqual(failed, 2)

    def test_a_session_the_time_limit_stopped_is_said_but_not_failed(self):
        # Issues #476 and #477: the monkey stops itself on MONKEY_MINUTES, so a session it cut off and a seed it
        # never began are said in the report, not filed as "no result"; a seed with no line at all still is.
        log = ("seed 5: pass (2000 actions, 1 Combine made of 2 tried)\n"
               "seed 6: cut off after 812 actions by the run's time limit (MONKEY_MINUTES 150), every check passed until then\n"
               "seed 7: not started: the run's time limit (MONKEY_MINUTES 150) came first\n"
               "monkey: 1 Combine made, 2 tried\nmonkey: all passed\n")
        failed, files = self.night(log, first=5, count=3, combine=True)
        self.assertEqual(failed, 0)
        self.assertEqual(files["report.txt"],
                         "Monkey, seeds 5-7: 3 session(s) of 2000 actions in Chromium; 1 Combine made of 2 tried; "
                         "every check passed after every action; 1 cut off and 1 not started by the time limit\n"
                         "seed 5: pass (2000 actions)\n"
                         "seed 6: cut off after 812 actions by the time limit (every check passed until then)\n"
                         "seed 7: not started (the time limit came first)\n")
        self.assertEqual(sorted(files), ["report.txt"])
        # The same night with seed 7's line missing (the job killed the monkey): seed 7 is a failure again.
        failed, files = self.night(log.replace("seed 7: not started", "seed 9: not started"), first=5, count=3, combine=True)
        self.assertEqual(failed, 1)
        self.assertIn("failure: no result: the session never finished", files["seed-monkey-7/monkey-report.txt"])

    def test_a_run_where_no_session_finished_fails(self):
        # Every seed stopped by the time limit: nothing was tested to the end, which must not read as clean.
        log = ("seed 5: cut off after 40 actions by the run's time limit (MONKEY_MINUTES 9), every check passed until then\n"
               "seed 6: not started: the run's time limit (MONKEY_MINUTES 9) came first\nmonkey: all passed\n")
        failed, files = self.night(log, first=5)
        self.assertEqual(failed, 1)
        self.assertIn("failure: no session finished in the run's time limit", files["seed-monkey-time/monkey-report.txt"])
        # One session failing is a finished one: its failure is the night's only one.
        failed, files = self.night(log.replace("seed 5: cut off after 40 actions by the run's time limit (MONKEY_MINUTES 9), every check passed until then",
                                               "seed 5: FAIL at action 40: save: Save gave no file"), first=5)
        self.assertEqual(failed, 1)
        self.assertNotIn("seed-monkey-time/monkey-report.txt", files)

    def test_regression_and_replay_lines_are_not_seeds(self):
        # Only the night's own seeds count, not a kept regression's line.
        failed, files = self.night("regression monkey-x.json: FAIL at action 3: a: b\nseed 1: pass (2000 actions)\n", first=1, count=1)
        self.assertEqual(failed, 0)

    def test_a_failing_self_test_is_a_failure(self):
        # monkey.mjs checks itself before the seeds (Save beside a stray
        # download) and counts a failure there in "monkey: N failed"; both
        # seeds passing must not make the night read clean.
        log = ("self-test save beside a stray download: FAIL: Save gave 12 bytes that aren't a project\n"
               "seed 5: pass (2000 actions)\nseed 6: pass (2000 actions)\nmonkey: 1 failed\n")
        failed, files = self.night(log, first=5)
        self.assertEqual(failed, 1)
        # By hand: 2 sessions, 0 failed seeds, 1 failed self-test, so "1 FAILED".
        self.assertEqual(files["report.txt"],
                         "Monkey, seeds 5-6: 2 session(s) of 2000 actions in Chromium; 1 FAILED\n"
                         "self-test save beside a stray download: FAIL: Save gave 12 bytes that aren't a project\n"
                         "seed 5: pass (2000 actions)\n"
                         "seed 6: pass (2000 actions)\n")
        report = files["seed-monkey-self-test/monkey-report.txt"].splitlines()
        self.assertEqual(report[1],
                         "failure: self-test save beside a stray download: Save gave 12 bytes that aren't a project | the self-test; "
                         "replay: cd apps/fission && npm run build && FISSION_SEED=5 MONKEY_STEPS=1 node e2e/monkey.mjs")
        self.assertEqual(list(kinds_of({"monkey-report.txt": files["seed-monkey-self-test/monkey-report.txt"]})),
                         ["monkey self-test save beside a stray download: Save gave # bytes that aren't a project"])
        # A passing self-test is no failure.
        failed, files = self.night("self-test save beside a stray download: pass\nseed 5: pass (2000 actions)\nmonkey: all passed\n",
                                   first=5, count=1)
        self.assertEqual((failed, sorted(files)), (0, ["report.txt"]))

    def test_a_failure_the_lines_miss_is_a_failure(self):
        # The monkey's own count is the last word: "monkey: 2 failed" with
        # only one FAIL line in the log (a new check printing some other way)
        # leaves one failure unexplained, and that is a failure too.
        log = "seed 5: FAIL at action 3: a: b\nseed 6: pass (2000 actions)\nmonkey: 2 failed\n"
        failed, files = self.night(log, first=5)
        self.assertEqual(failed, 2)
        self.assertIn("failure: the monkey counted 2 failed but its log shows 1 FAIL line(s)",
                      files["seed-monkey-unexplained/monkey-report.txt"])
        # The count agreeing: nothing extra.
        failed, files = self.night(LOG, saved=[20261026])
        self.assertEqual(failed, 1)
        self.assertNotIn("seed-monkey-unexplained/monkey-report.txt", files)

    def test_a_night_that_tried_no_combine_fails_when_combine_is_asked_for(self):
        # 35f1d: the nightly job passes "combine"; the monkey's last lines say how many Combines it made and tried
        # (tried: OK pressed with both bodies picked; a sphere's Combine is refused in words until step 37, still tried).
        clean = ("seed 5: pass (2000 actions, 2 Combines made of 5 tried)\nseed 6: pass (2000 actions, 1 Combine made of 2 tried)\n"
                 "monkey: 3 Combines made, 7 tried\nmonkey: all passed\n")
        failed, files = self.night(clean, first=5, combine=True)
        self.assertEqual(failed, 0)
        # By hand: 2 + 1 = 3 made of 5 + 2 = 7 tried, said in the first line; the seeds' lines read as passes.
        self.assertEqual(files["report.txt"].splitlines()[0],
                         "Monkey, seeds 5-6: 2 session(s) of 2000 actions in Chromium; 3 Combines made of 7 tried; every check passed after every action")
        self.assertEqual(files["report.txt"].splitlines()[1:], ["seed 5: pass (2000 actions)", "seed 6: pass (2000 actions)"])
        # One made: "1 Combine made", singular.
        one = clean.replace("monkey: 3 Combines made, 7 tried", "monkey: 1 Combine made, 7 tried")
        self.assertIn("; 1 Combine made of 7 tried;", self.night(one, first=5, combine=True)[1]["report.txt"].splitlines()[0])
        # Tried but none made (every pick curved): still tested, so no failure.
        refused = clean.replace("monkey: 3 Combines made, 7 tried", "monkey: 0 Combines made, 7 tried")
        self.assertEqual(self.night(refused, first=5, combine=True)[0], 0)
        # None tried: a failure of its own, filed under its own kind, though every seed passed.
        none = clean.replace("monkey: 3 Combines made, 7 tried", "monkey: 0 Combines made, 0 tried")
        failed, files = self.night(none, first=5, combine=True)
        self.assertEqual(failed, 1)
        self.assertIn("0 Combines made of 0 tried; 1 FAILED", files["report.txt"].splitlines()[0])
        report = files["seed-monkey-combine/monkey-report.txt"].splitlines()
        self.assertTrue(report[1].startswith("failure: the monkey tried no Combine in the night's sessions, so the hidden Combine tool went untested"), report[1])
        self.assertEqual(list(kinds_of({"monkey-report.txt": files["seed-monkey-combine/monkey-report.txt"]})),
                         ["monkey the monkey tried no Combine in the night's sessions, so the hidden Combine tool went untested (is ?combine still in its address?)"])
        # No count at all (an older monkey, or the older "made" line alone): a failure too, saying so.
        for log in ("seed 5: pass (2000 actions)\nseed 6: pass (2000 actions)\nmonkey: all passed\n", clean.replace(", 7 tried", "")):
            failed, files = self.night(log, first=5, combine=True)
            self.assertEqual(failed, 1)
            self.assertIn("never said how many Combines", files["seed-monkey-combine/monkey-report.txt"])
        # Without "combine" (a night by hand, the older tests above): no count asked for, nothing added.
        failed, files = self.night(none, first=5)
        self.assertEqual((failed, sorted(files)), (0, ["report.txt"]))
        self.assertNotIn("Combine", files["report.txt"].splitlines()[0])

    def test_the_kind_takes_numbers_out(self):
        _, files = self.night(LOG, saved=[20261026])
        kinds = kinds_of({"monkey-report.txt": files["seed-monkey-20261026/monkey-report.txt"]})
        self.assertEqual(list(kinds), ["monkey no sideways scrolling: the page is # px wider than the window"])


class Daytime(unittest.TestCase):
    """The daytime monkey's plan (issue #671): how many fresh seeds fit before 14:50 UTC, or none at all."""

    @staticmethod
    def at(hhmmss):
        # 1 Jan 2026 is day 56 x 365 + 14 leap days (1972 to 2024) = 20,454 since 1970; 13 Nov is 316 days later,
        # day 20,770, so its midnight is 20,770 x 86,400 = 1,794,528,000 s.
        h, m, s = map(int, hhmmss.split(":"))
        return 1794528000 + 3600 * h + 60 * m + s

    def test_the_day_used_by_these_tests(self):
        self.assertEqual(time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(self.at("14:03:27"))), "2026-11-13 14:03:27")

    def test_issue_671_a_late_start_runs_no_session_that_cannot_finish(self):
        # 14:03:27 to 14:50 is 46 whole minutes, less the report's 15: 31 minutes, under one session's 40, so no
        # session is started and the plan says so instead of running one that the time limit must cut off.
        plan = monkey_night.day_plan(self.at("14:03:27"))
        self.assertEqual(plan, (None, 0, 31))

    def test_forty_minutes_is_one_session_and_thirty_nine_is_none(self):
        # 13:55:00 leaves 55 - 15 = 40 minutes: exactly one session's 40 (fit 1). 13:56:00 leaves 39: none.
        first, seeds, limit = monkey_night.day_plan(self.at("13:55:00"))
        self.assertEqual((seeds, limit), (1, 40))
        # First seed: 300,000,000 + twice the minutes since 1970 (1,794,528,000 / 60 = 29,908,800; + 835 for 13:55).
        self.assertEqual(first, 300000000 + 2 * (29908800 + 835))
        self.assertEqual(monkey_night.day_plan(self.at("13:56:00")), (None, 0, 39))

    def test_the_seeds_that_fit_and_the_cap_of_four(self):
        # 12:00 leaves 170 - 15 = 155 minutes: 155 // 40 = 3 sessions.
        self.assertEqual(monkey_night.day_plan(self.at("12:00:00"))[1:], (3, 155))
        # 10:00 leaves 275: 6 fit, but a daytime run has four seeds.
        self.assertEqual(monkey_night.day_plan(self.at("10:00:00"))[1:], (4, 275))
        # 15:00 counts to tomorrow's 14:50 (1,430 - 15 minutes), and no run is longer than 300.
        self.assertEqual(monkey_night.day_plan(self.at("15:00:00"))[1:], (4, 300))

    def test_a_skipped_run_writes_a_clean_report_and_no_failure_folder(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "out")
            said = subprocess.run([sys.executable, os.path.join(HERE, "monkey_night.py"), "day", out, str(self.at("14:03:27"))],
                                  capture_output=True, text=True, check=True).stdout
            self.assertEqual(said.split(), ["skip"])
            self.assertEqual(os.listdir(out), ["report.txt"])
            report = open(os.path.join(out, "report.txt")).read()
            self.assertIn("Monkey, daytime: not run, only 31 minutes were left before 14:50 UTC", report)
            self.assertNotIn("FAIL", report)
            # A run with time for sessions prints them for the workflow: first seed, seeds, minutes.
            said = subprocess.run([sys.executable, os.path.join(HERE, "monkey_night.py"), "day", out, str(self.at("12:00:00"))],
                                  capture_output=True, text=True, check=True).stdout
            self.assertEqual(said.split()[1:], ["3", "155"])


class Collect(unittest.TestCase):
    def test_a_failing_night_reaches_the_branch_and_files_its_kind(self):
        with tempfile.TemporaryDirectory() as d:
            origin, work, incoming = (os.path.join(d, x) for x in ("origin.git", "work", "in"))
            git(d, "init", "-q", "--bare", origin)
            git(d, "init", "-q", work)
            git(work, "remote", "add", "origin", origin)
            monkey_night.write(LOG, os.path.join(d, "none"), os.path.join(incoming, "monkey"), 20261025, 2, 2000)
            env = {k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_STEP_SUMMARY")}
            env.update(IN=incoming, RUN_URL="https://example.invalid/runs/1", COMMIT="abcdef1234567", BRANCH="main",
                       GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
            for s in ("collect-results.sh", "file_issues.py"):
                shutil.copy(os.path.join(HERE, s), d)
            out = subprocess.run(["bash", os.path.join(d, "collect-results.sh")], cwd=work, env=env, capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
            check = os.path.join(d, "check")
            git(d, "clone", "-q", "-b", "test-results", origin, check)

            def read(path):
                with open(os.path.join(check, path)) as f:
                    return f.read()
            self.assertIn("failure: no sideways scrolling", read("failures/seed-monkey-20261026/monkey-report.txt"))
            self.assertIn("tested commit abcdef1234567 on branch main", read("failures/seed-monkey-20261026/commit.txt"))
            self.assertIn("Latest monkey sessions", read("summary.txt"))
            self.assertIn("  seed 20261026: FAIL: no sideways scrolling", read("summary.txt"))
            self.assertRegex(read("monkey/log.txt"), r"^\d{4}-\d\d-\d\d \d\d:\d\d,abcdef1,main,Monkey, seeds 20261025-20261026: .*1 FAILED\n$")
            # No GH_TOKEN: file_issues.py says what it would file.
            self.assertIn("create  monkey no sideways scrolling: the page is # px wider than the window", out.stdout)


if __name__ == "__main__":
    unittest.main()
