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


def at(h, m, s=0):
    return datetime.datetime(2026, 11, 8, h, m, s, tzinfo=UTC)


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


FAKE_GH = r"""#!/usr/bin/env bash
# Plays `gh api`: today's scheduled runs 10 (its plan skipped: too early)
# and 11 (its plan succeeded).
echo "$*" >>"$FAKE_LOG"
case "$*" in
  *"/workflows/"*) echo '{"workflow_runs":[{"id":10},{"id":11}]}';;
  *"/runs/10/jobs"*) echo '{"jobs":[{"name":"idle","conclusion":"success"},{"name":"plan","conclusion":"skipped"}]}';;
  *"/runs/11/jobs"*) echo '{"jobs":[{"name":"idle","conclusion":"success"},{"name":"plan","conclusion":"success"}]}';;
esac
"""


class Lookup(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = self.dir.name
        os.makedirs(os.path.join(d, "bin"))
        with open(os.path.join(d, "bin", "gh"), "w") as f:
            f.write(FAKE_GH)
        os.chmod(os.path.join(d, "bin", "gh"), 0o755)
        self.log = os.path.join(d, "log")
        self.env = dict(os.environ, PATH=os.path.join(d, "bin") + os.pathsep + os.environ["PATH"], FAKE_LOG=self.log)

    def tearDown(self):
        self.dir.cleanup()

    def test_only_a_run_whose_plan_succeeded_counts_as_tonight(self):
        old = os.environ.copy()
        os.environ.update(self.env)
        try:
            self.assertEqual(ng.planned_today("o/r", "kernel-nightly.yml", at(16, 17)), [11])
        finally:
            os.environ.clear()
            os.environ.update(old)
        with open(self.log) as f:
            first = f.readline()
        self.assertIn("repos/o/r/actions/workflows/kernel-nightly.yml/runs?event=schedule&created=%3E%3D2026-11-08T14:00:00Z", first)

    def test_a_run_by_hand_always_goes(self):
        out = os.path.join(self.dir.name, "out")
        env = dict(self.env, GITHUB_EVENT_NAME="workflow_dispatch", GITHUB_OUTPUT=out)
        p = subprocess.run([sys.executable, os.path.join(HERE, "nightly_gate.py"), "kernel-nightly.yml"], env=env,
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        with open(out) as f:
            self.assertEqual(f.read(), "go=true\n")
        self.assertFalse(os.path.exists(self.log))


if __name__ == "__main__":
    unittest.main()
