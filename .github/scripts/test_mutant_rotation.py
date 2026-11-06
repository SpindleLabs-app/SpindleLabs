"""mutant_rotation.py, the kernel's whole-kernel mutation testing a slice a
run: python3 -m unittest discover -s .github/scripts. File names here are
made up (the kernel's own never appear in this public repo)."""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mutant_rotation as mr  # noqa: E402
from mutant_rotation import read  # noqa: E402

COUNTS = {"src/z.rs": 81, "src/hot/a.rs": 40, "src/warm/b.rs": 1, "src/a.rs": 5, "src/hot/c.rs": 41}
FIRST = ["src/warm/", "src/hot/"]


class Units(unittest.TestCase):
    def test_hand_worked_order_and_slices(self):
        # Worked by hand, size 40: the "first" prefixes lead in their listed
        # order (warm before hot), each group by path; then the rest by path.
        # A file of c mutants is ceil(c/40) slices: b 1 -> 1, a 40 -> 1,
        # c 41 -> 2 (40 + 1), src/a.rs 5 -> 1, z 81 -> 3 (40 + 40 + 1).
        self.assertEqual([mr.unit_id(u) for u in mr.units_of(COUNTS, FIRST, 40)], [
            "src/warm/b.rs#0/1", "src/hot/a.rs#0/1", "src/hot/c.rs#0/2", "src/hot/c.rs#1/2",
            "src/a.rs#0/1", "src/z.rs#0/3", "src/z.rs#1/3", "src/z.rs#2/3"])

    def test_no_first_list_is_plain_path_order(self):
        self.assertEqual([u[0] for u in mr.units_of({"b.rs": 1, "a.rs": 1}, [], 40)], ["a.rs", "b.rs"])

    def test_the_first_file_lists_prefixes_without_comments(self):
        self.assertEqual(mr.first_prefixes("# newest code first\nsrc/hot/  # booleans\n\nsrc/warm/\n"), ["src/hot/", "src/warm/"])

    def test_counts_from_the_listing(self):
        self.assertEqual(mr.counts_of([{"file": "a"}, {"file": "b"}, {"file": "a"}]), {"a": 2, "b": 1})

    def test_strip_drops_line_and_column_only(self):
        self.assertEqual(mr.strip("src/a.rs:12:5: replace < with <= in f"), "src/a.rs: replace < with <= in f")
        self.assertEqual(mr.strip("src/a.rs: replace x"), "src/a.rs: replace x")


class Pending(unittest.TestCase):
    UNITS = mr.units_of(COUNTS, FIRST, 40)

    def test_a_fresh_state_starts_cycle_one_with_everything(self):
        self.assertEqual(mr.pending(self.UNITS, {}), (1, self.UNITS))

    def test_done_units_of_this_cycle_are_skipped_others_are_not(self):
        state = {"cycle": 2, "units": {"src/warm/b.rs#0/1": {"cycle": 2}, "src/hot/a.rs#0/1": {"cycle": 1}}}
        cycle, left = mr.pending(self.UNITS, state)
        self.assertEqual(cycle, 2)
        self.assertEqual(mr.unit_id(left[0]), "src/hot/a.rs#0/1")  # done last cycle: due again
        self.assertEqual(len(left), len(self.UNITS) - 1)

    def test_a_finished_cycle_starts_the_next_with_everything(self):
        state = {"cycle": 4, "units": {mr.unit_id(u): {"cycle": 4} for u in self.UNITS}}
        self.assertEqual(mr.pending(self.UNITS, state), (5, self.UNITS))

    def test_a_file_cut_differently_is_due_again(self):
        # z grew from 81 to 121 mutants: 4 slices now, none of them done.
        state = {"cycle": 1, "units": {"src/z.rs#0/3": {"cycle": 1}}}
        units = mr.units_of(dict(COUNTS, **{"src/z.rs": 121}), FIRST, 40)
        self.assertIn("src/z.rs#0/4", [mr.unit_id(u) for u in mr.pending(units, state)[1]])

    def test_shares_split_the_list_and_cover_it_once(self):
        shares = [mr.share(self.UNITS, j, 3) for j in range(3)]
        self.assertEqual(sorted(u for s in shares for u in s), sorted(self.UNITS))
        self.assertEqual(shares[0][:2], [self.UNITS[0], self.UNITS[3]])


def result(uid, cycle=1, exit=0, caught=3, missed=(), timeout=0, unviable=1):
    return {"id": uid, "cycle": cycle, "exit": exit, "caught": caught, "missed": sorted(missed), "timeout": timeout, "unviable": unviable}


class Merge(unittest.TestCase):
    def test_a_first_run_sets_survivors_without_calling_them_new(self):
        state, new, fig = mr.merge({}, [result("src/a.rs#0/1", missed=["src/a.rs:3:1: replace f -> bool with true"])], {}, "d1", "c1")
        self.assertEqual(new, [])
        self.assertEqual(state["units"]["src/a.rs#0/1"]["missed"], ["src/a.rs:3:1: replace f -> bool with true"])
        # Worked by hand: 3 caught + 1 missed + 0 timed out + 1 unviable = 5 tested.
        self.assertEqual((fig["done"], fig["tested"], fig["missed"]), (1, 5, 1))

    def test_a_survivor_that_only_moved_is_not_new_a_fresh_one_is(self):
        old = "src/a.rs:3:1: replace f -> bool with true"
        state, _, _ = mr.merge({}, [result("src/a.rs#0/1", missed=[old])], {}, "d1", "c1")
        moved = "src/a.rs:9:1: replace f -> bool with true"
        fresh = "src/a.rs:20:4: replace < with <= in g"
        _, new, _ = mr.merge(state, [result("src/a.rs#0/1", cycle=2, missed=[moved, fresh])], {}, "d2", "c2")
        self.assertEqual(new, [fresh])

    def test_a_unit_cut_off_is_not_done(self):
        state, _, fig = mr.merge({}, [result("src/a.rs#0/1", exit=124)], {}, "d1", "c1")
        self.assertNotIn("src/a.rs#0/1", state["units"])
        self.assertEqual((fig["done"], fig["tried"]), (0, 1))

    def test_the_next_cycle_closes_the_last_and_counts_its_runs(self):
        state = {"cycle": 1, "cycle_started": "d1", "runs_this_cycle": 3, "last_done": "d3", "units": {}, "cycles": []}
        state, _, _ = mr.merge(state, [result("src/a.rs#0/1", cycle=2)], {}, "d4", "c4")
        self.assertEqual(state["cycle"], 2)
        self.assertEqual(state["cycles"], [{"cycle": 1, "started": "d1", "finished": "d3", "runs": 3}])
        self.assertEqual((state["cycle_started"], state["runs_this_cycle"]), ("d4", 1))

    def test_units_no_longer_listed_are_dropped_after_their_survivors_count(self):
        old = "src/z.rs:1:1: replace h with ()"
        state, _, _ = mr.merge({}, [result("src/z.rs#0/3", missed=[old])], {}, "d1", "c1")
        # z is cut in 4 now; the old unit's survivor still makes it not new.
        state, new, _ = mr.merge(state, [result("src/z.rs#0/4", missed=["src/z.rs:2:1: replace h with ()"])],
                                 {"all": ["src/z.rs#0/4", "src/z.rs#1/4"]}, "d2", "c2")
        self.assertEqual(new, [])
        self.assertEqual(sorted(state["units"]), ["src/z.rs#0/4"])

    def test_the_cycle_line_gives_the_pace_then_the_length(self):
        state = {"cycle": 1, "cycle_started": "d1", "runs_this_cycle": 2, "units_total": 10,
                 "units": {f"u{k}": {"cycle": 1} for k in range(4)}, "cycles": []}
        # 4 units in 2 runs is 2 a run: 10 units take 5 runs.
        self.assertIn("4 of 10 units", mr.cycle_line(state))
        self.assertIn("about 5 run(s)", mr.cycle_line(state))
        state["cycles"] = [{"cycle": 0, "started": "d0", "finished": "d1", "runs": 6}]
        self.assertIn("cycle 0 took 6 run(s)", mr.cycle_line(state))


def write_job(root, job, units, baseline="0", plan="cycle 1\nunits 8\nmutants 208\nleft 8\n", all_units=()):
    jd = os.path.join(root, f"mutants-{job}")
    os.makedirs(jd)
    with open(os.path.join(jd, "baseline.txt"), "w") as f:
        f.write(baseline + "\n")
    with open(os.path.join(jd, "plan.txt"), "w") as f:
        f.write(plan)
    with open(os.path.join(jd, "units-all.txt"), "w") as f:
        f.writelines(u + "\n" for u in all_units)
    for k, (uid, code, missed) in enumerate(units):
        d = os.path.join(jd, "units", str(k))
        os.makedirs(d)
        for name, text in (("unit", uid), ("exit-code", str(code)), ("cycle", "1"), ("caught", "a\nb\n"),
                           ("missed", "".join(m + "\n" for m in missed)), ("timeout", ""), ("unviable", "u\n")):
            with open(os.path.join(d, name + ".txt"), "w") as f:
                f.write(text + ("\n" if text and not text.endswith("\n") else ""))


class Record(unittest.TestCase):
    def test_two_jobs_fold_into_the_state_log_and_summary(self):
        with tempfile.TemporaryDirectory() as d:
            inc, out = os.path.join(d, "in"), os.path.join(d, "out")
            write_job(inc, 0, [("src/a.rs#0/1", 2, ["src/a.rs:1:1: m1"])], all_units=["src/a.rs#0/1", "src/z.rs#0/3"])
            write_job(inc, 1, [("src/z.rs#0/3", 0, []), ("src/z.rs#1/3", 124, [])])
            got = subprocess.run([sys.executable, os.path.join(HERE, "mutant_rotation.py"), "record", "--dir", out, "--in", inc,
                                  "--commit", "abcdef123", "--run-url", "U", "--when", "2026-11-06 06:00"],
                                 capture_output=True, text=True, check=True).stdout
            self.assertEqual(json.loads(got), {"baseline_failed": False, "new": [], "units_done": 2})
            state = json.loads(read(os.path.join(out, "mutants", "rotation.json")))
            self.assertEqual(sorted(state["units"]), ["src/a.rs#0/1", "src/z.rs#0/3"])
            self.assertEqual(read(os.path.join(out, "mutants", "missed.txt")), "src/a.rs:1:1: m1\n")
            log = read(os.path.join(out, "mutants", "rotation-log.csv")).splitlines()
            # 2 units done of 3 started; each done unit: 2 caught + its missed + 1 unviable.
            self.assertEqual(log[1], "2026-11-06 06:00,abcdef1,main,1,2,3,7,4,1,0,2,0,U")
            summary = read(os.path.join(out, "mutants", "summary.txt"))
            self.assertIn("cycle 1: 2 of 8 units", summary)
            self.assertNotIn("failed", summary)

    def test_a_failed_baseline_is_reported(self):
        with tempfile.TemporaryDirectory() as d:
            inc, out = os.path.join(d, "in"), os.path.join(d, "out")
            write_job(inc, 0, [], baseline="101")
            got = subprocess.run([sys.executable, os.path.join(HERE, "mutant_rotation.py"), "record", "--dir", out, "--in", inc,
                                  "--commit", "abcdef123"], capture_output=True, text=True, check=True).stdout
            self.assertTrue(json.loads(got)["baseline_failed"])
            self.assertIn("the unmutated lib tests failed", read(os.path.join(out, "mutants", "summary.txt")))

    def test_a_baseline_cut_off_by_the_deadline_is_not_a_failure(self):
        with tempfile.TemporaryDirectory() as d:
            inc, out = os.path.join(d, "in"), os.path.join(d, "out")
            write_job(inc, 0, [], baseline="124")
            got = subprocess.run([sys.executable, os.path.join(HERE, "mutant_rotation.py"), "record", "--dir", out, "--in", inc,
                                  "--commit", "abcdef123"], capture_output=True, text=True, check=True).stdout
            self.assertFalse(json.loads(got)["baseline_failed"])


FAKE_CARGO = r"""#!/usr/bin/env bash
# Plays cargo for mutant_rotation.py run: a listing of 3 files, the
# baseline's exit code from $FAKE_BASELINE, and each unit taking
# $FAKE_UNIT_SECONDS and exiting $FAKE_UNIT_EXIT, logged to $FAKE_LOG.
# Like cargo mutants, it refuses an --output whose parent folder is missing.
echo "$*" >>"$FAKE_LOG"
case "$*" in
  "mutants --list --json") echo '[{"file":"src/hot/a.rs"},{"file":"src/b.rs"},{"file":"src/b.rs"},{"file":"src/c.rs"}]';;
  "test --lib") exit "${FAKE_BASELINE:-0}";;
  mutants*)
    out=$(echo "$*" | sed -E 's/.*--output ([^ ]+).*/\1/')
    [ -d "$(dirname "$out")" ] || { echo "create output parent directory"; exit 1; }
    sleep "${FAKE_UNIT_SECONDS:-0}"
    mkdir -p "$out/mutants.out" && echo "src/x.rs:1:1: caught one" >"$out/mutants.out/caught.txt"
    exit "${FAKE_UNIT_EXIT:-0}";;
esac
"""


class Run(unittest.TestCase):
    def run_job(self, job, jobs, seconds_left, state=None, baseline="0", unit_seconds="0", first="src/hot/\n", unit_exit="0"):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "bin"))
        os.makedirs(os.path.join(d, "kernel", ".cargo"))
        with open(os.path.join(d, "kernel", ".cargo", "mutants-first.txt"), "w") as f:
            f.write(first)
        with open(os.path.join(d, "bin", "cargo"), "w") as f:
            f.write(FAKE_CARGO)
        os.chmod(os.path.join(d, "bin", "cargo"), 0o755)
        with open(os.path.join(d, "state.json"), "w") as f:
            json.dump(state or {}, f)
        env = dict(os.environ, PATH=os.path.join(d, "bin") + os.pathsep + os.environ["PATH"], FAKE_LOG=os.path.join(d, "log"),
                   FAKE_BASELINE=baseline, FAKE_UNIT_SECONDS=unit_seconds, FAKE_UNIT_EXIT=unit_exit)
        p = subprocess.run([sys.executable, os.path.join(HERE, "mutant_rotation.py"), "run", "--job", str(job), "--jobs", str(jobs),
                            "--deadline", str(time.time() + seconds_left), "--state", os.path.join(d, "state.json"),
                            "--out", os.path.join(d, "out"), "--scratch", os.path.join(d, "scratch")],
                           cwd=os.path.join(d, "kernel"), env=env, capture_output=True, text=True)
        units = []
        ud = os.path.join(d, "out", "units")
        for k in sorted(os.listdir(ud), key=int) if os.path.isdir(ud) else []:
            units.append(read(os.path.join(ud, k, "unit.txt")).strip())
        return p.returncode, units, read(os.path.join(d, "log"))

    def test_a_job_tests_its_share_first_files_first(self):
        # Units by hand (size 40): src/hot/a.rs leads (first), then b, c by
        # path. Job 0 of 2 takes units 0 and 2; job 1 takes unit 1.
        self.assertEqual(self.run_job(0, 2, 3600)[:2], (0, ["src/hot/a.rs#0/1", "src/c.rs#0/1"]))
        self.assertEqual(self.run_job(1, 2, 3600)[:2], (0, ["src/b.rs#0/1"]))

    def test_each_unit_is_one_file_slice_with_no_second_baseline(self):
        _, _, log = self.run_job(0, 1, 3600)
        self.assertIn("mutants -f src/b.rs --shard 0/1 --sharding slice --baseline skip", log)
        self.assertEqual(log.count("test --lib"), 1)

    def test_done_units_are_not_tested_again(self):
        state = {"cycle": 1, "units": {"src/hot/a.rs#0/1": {"cycle": 1}}}
        self.assertEqual(self.run_job(0, 1, 3600, state)[1], ["src/b.rs#0/1", "src/c.rs#0/1"])

    def test_a_failing_baseline_tests_nothing(self):
        code, units, log = self.run_job(0, 1, 3600, baseline="101")
        self.assertEqual((code, units), (4, []))
        self.assertNotIn("--shard", log)

    def test_a_baseline_cut_off_by_the_deadline_tests_nothing_and_passes(self):
        code, units, log = self.run_job(0, 1, 3600, baseline="124")
        self.assertEqual((code, units), (0, []))

    def test_cargo_mutants_failing_stops_the_job_red(self):
        # Exit 1 is cargo mutants itself failing (not a verdict): the job
        # stops at the first such unit instead of failing every unit left.
        code, units, log = self.run_job(0, 1, 3600, unit_exit="1")
        self.assertEqual((code, units), (1, ["src/hot/a.rs#0/1"]))
        self.assertEqual(log.count("--shard "), 1)

    def test_units_with_survivors_or_timeouts_carry_on(self):
        for verdict in ("2", "3"):
            self.assertEqual(self.run_job(0, 1, 3600, unit_exit=verdict)[:2], (0, ["src/hot/a.rs#0/1", "src/b.rs#0/1", "src/c.rs#0/1"]))

    def test_no_unit_starts_inside_the_margin(self):
        # 0.9x the margin left: nothing starts; 1.1x: the first unit starts.
        self.assertEqual(self.run_job(0, 1, mr.MARGIN * 0.9)[1], [])
        self.assertEqual(self.run_job(0, 1, mr.MARGIN * 1.1, unit_seconds="0")[1][:1], ["src/hot/a.rs#0/1"])


if __name__ == "__main__":
    unittest.main()
