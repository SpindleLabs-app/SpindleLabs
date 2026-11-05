"""coverage_issue.py and collect-results.sh's state coverage section:
python3 -m unittest discover -s .github/scripts

The kernel's endless jobs each leave a markers.txt ("name count", " rare"
after a state not expected every night). The night's counts must be added
up across jobs, summarised (how many reached, which never), and on main
the never-reached states kept in one rolling issue that does not notify
every night. The names here are made up (widget-*)."""

import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import coverage_issue as ci  # noqa: E402
import test_collect_results as tcr  # noqa: E402

JOB_A = "widget-a 3\nwidget-b 0\nwidget-c 0 rare\nwidget-d 0\n"
JOB_B = "widget-a 1\nwidget-b 2\nwidget-c 0 rare\nwidget-d 0\n"


class Pure(unittest.TestCase):
    def test_never_reached_leaves_out_reached_and_rare(self):
        # By hand over both jobs: a 4, b 2, c 0 (rare), d 0: only d is missed.
        marks = ci.parse("widget-a 4\nwidget-b 2\nwidget-c 0 rare\nwidget-d 0\nnot a line\n")
        self.assertEqual(len(marks), 4)
        self.assertEqual(ci.never_reached(marks), (["widget-d"], ["widget-c"]))

    def test_no_issue_and_nothing_missed_does_nothing(self):
        self.assertEqual(ci.plan([], None), [])
        self.assertEqual(ci.plan(["widget-d"], None), [("create", "")])

    def test_an_unchanged_list_only_edits_quietly(self):
        issue = {"number": 5, "state": "OPEN", "body": ci.body(["widget-d"], 4, "u", "c", "main")}
        self.assertEqual(ci.plan(["widget-d"], issue), [("edit", "")])

    def test_a_changed_list_says_what_changed(self):
        issue = {"number": 5, "state": "OPEN", "body": ci.body(["widget-d", "widget-b"], 4, "u", "c", "main")}
        self.assertEqual(ci.plan(["widget-d", "widget-e"], issue),
                         [("edit", ""), ("comment", "No longer reached: `widget-e`. Reached now: `widget-b`.")])

    def test_all_reached_closes_and_a_miss_reopens(self):
        open_ = {"number": 5, "state": "OPEN", "body": ci.body(["widget-d"], 4, "u", "c", "main")}
        self.assertEqual([a for a, _ in ci.plan([], open_)], ["comment", "close"])
        closed = dict(open_, state="CLOSED")
        self.assertEqual(ci.plan([], closed), [])
        self.assertEqual([a for a, _ in ci.plan(["widget-d"], closed)], ["reopen", "edit", "comment"])


class Collect(unittest.TestCase):
    collect = tcr.CollectGolden.collect

    def night(self):
        return self.collect(tcr.CLEAN, None, {"endless-a-0/markers.txt": JOB_A, "endless-b-1/markers.txt": JOB_B})

    def test_the_jobs_add_up_and_the_summary_names_the_missed(self):
        stdout, files = self.night()
        latest = files["markers/latest.txt"].splitlines()
        self.assertIn("tested commit abcdef1 on main", latest[0])
        # By hand: a 3 + 1 = 4, b 0 + 2 = 2, c 0 rare, d 0.
        self.assertEqual(latest[1:], ["widget-a 4", "widget-b 2", "widget-c 0 rare", "widget-d 0"])
        summary = files["summary.txt"]
        self.assertIn("  2 of 4 states reached\n  never reached: widget-d\n  rare, not reached: widget-c\n", summary)
        # No GH_TOKEN: says what it would do; never a failure kind.
        self.assertIn("coverage create 1 never reached", stdout)
        self.assertTrue(summary.startswith("New failures this run (kinds of problem no earlier run found): 0\n"), summary[:200])

    def test_a_night_without_marks_has_no_section(self):
        stdout, files = self.collect(tcr.CLEAN, None)
        self.assertNotIn("markers/latest.txt", files)
        self.assertNotIn("state coverage", files["summary.txt"])
        self.assertNotIn("coverage", stdout)

    def test_a_branch_night_is_not_judged(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "m.txt")
            with open(path, "w") as f:
                f.write(JOB_A)
            env = dict(os.environ, RUN_URL="u", COMMIT="c", BRANCH="claude/x")
            env.pop("GH_TOKEN", None)
            out = subprocess.run([sys.executable, os.path.join(HERE, "coverage_issue.py"), path], env=env,
                                 capture_output=True, text=True, check=True).stdout
        self.assertIn("not judged on claude/x", out)
        self.assertNotIn("create", out)


if __name__ == "__main__":
    unittest.main()
