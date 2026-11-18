"""Tests for oracle_public.py: python3 -m unittest discover -s .github/scripts

The examples are in the shapes the kernel's oracle writes (compare.py's
disagreements file, golden_step.py's report). Each expected public text is
worked out by hand from the rule in oracle_public.py's docstring: keep the
shape line or the model's name, and each check's name only (before its first
colon, brackets cut, plain words only).
"""

import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from file_issues import golden_kinds, oracle_kinds  # noqa: E402
from oracle_public import CRASHED, check_name, golden, sessions  # noqa: E402

SHAPE = '{"Extrude": {"outer": {"Path": {"points": [[0, 0], [10, 0], [10, 5]], "bulges": [0, 0.5, 0]}}, "height": 3}}'
FULL = (
    f"line 4: {SHAPE}\n"
    "  volume: fission 75.0, exact 74.2 (session 3, step 12)\n"
    "  step validity: as written: caps centred on their axes, moved up to 3e-09 mm (moved home by (1, 0, 0))\n"
    "  step orientation: cylinder face #3 doesn't run counter-clockwise round its normal: (u, v) area -1.2 (turned inside out)\n"
    "  oracle error: KeyError('fission_faces') (session 3, step 12)\n"
    "  bounds highest x: fission 10.0, occ 10.5\n"
)
# By hand: the shape line is kept; then the words before each line's first colon.
PUBLIC = f"line 4: {SHAPE}\n  volume\n  step validity\n  step orientation\n  oracle error\n  bounds highest x\n"

# golden_step.py's report: header naming the script, then one failure line a model.
GOLDEN_FULL = (
    "Golden models' STEP files (prototypes/oracle/golden_step.py): 2 of 31 bodies failed\n"
    "failure: gear: step faces: OpenCascade read 12, the kernel has 11 (gear, Body 1 (feature-3)) | "
    "also: step volume: OpenCascade read 3.1 from the file, exact 3.0, allowed 1e-06 (gear, Body 1 (feature-3)); \n"
    "failure: l-bracket: no hand-worked answers for this body, so its STEP file isn't judged (l-bracket, Body 2 (feature-9)) | \n"
)
# By hand: the header keeps only "2 of 31"; gear's first check is "step faces", its other "step volume";
# l-bracket's first is the whole phrase before the bracket (it has no colon), and nothing else.
GOLDEN_PUBLIC = (
    "Golden models' STEP files: 2 of 31 bodies failed\n"
    "failure: gear: step faces | also: step volume; \n"
    "failure: l-bracket: no hand-worked answers for this body, so its STEP file isn't judged\n"
)

# Words of the oracle's method, numbers it measured and its file: none may reach the public text.
PRIVATE = ("caps centred", "moved home", "counter-clockwise", "(u, v)", "KeyError", "fission_faces", "prototypes/oracle",
           "golden_step.py", "OpenCascade read", "allowed", "75.0", "10.5", "feature-3")


class Sessions(unittest.TestCase):
    def test_hand_worked_reduction(self):
        self.assertEqual(sessions(FULL), PUBLIC)

    def test_nothing_private_is_left(self):
        for word in PRIVATE:
            self.assertNotIn(word, sessions(FULL), word)

    def test_the_issue_kinds_are_the_same_as_from_the_full_text(self):
        # file_issues.py's kind is the shape and the check's name, so the public file files exactly the same issues.
        self.assertEqual([k for k, _ in oracle_kinds(sessions(FULL))], [k for k, _ in oracle_kinds(FULL)])
        self.assertEqual(len(oracle_kinds(FULL)), 5)

    def test_other_lines_are_never_copied(self):
        full = "occ-rounding, line 3: volume: occ 1.00001, exact 1.0 (moved home by (1, 2, 3))\noracle crashed: Traceback in compare.py line 40\n"
        self.assertEqual(sessions(full), f"other note\n{CRASHED}\n")
        self.assertEqual([k for k, _ in oracle_kinds(sessions(full))], ["OpenCascade oracle crashed"])

    def test_check_names_that_are_not_plain_words_are_hidden(self):
        # Breaking a valid name in exactly the way the rule guards against: a name with a path or a symbol in it.
        self.assertEqual(check_name("  volume: 1 (x)"), "volume")
        self.assertEqual(check_name("  compare.py/step_check: x"), "other check")
        self.assertEqual(check_name("  " + "a" * 81), "other check")
        self.assertEqual(check_name("  " + "a" * 80), "a" * 80)
        self.assertEqual(check_name("  step_issues raised"), "other check")


class Golden(unittest.TestCase):
    def test_hand_worked_reduction(self):
        self.assertEqual(golden(GOLDEN_FULL), GOLDEN_PUBLIC)

    def test_nothing_private_is_left(self):
        for word in PRIVATE:
            self.assertNotIn(word, golden(GOLDEN_FULL), word)

    def test_each_model_is_still_its_own_kind(self):
        self.assertEqual([k for k, _ in golden_kinds(golden(GOLDEN_FULL))], [
            "golden model gear: step faces",
            "golden model l-bracket: no hand-worked answers for this body, so its STEP file isn't judged"])

    def test_a_model_name_that_is_not_plain_is_hidden(self):
        full = "x: 1 of 1 bodies failed\nfailure: ../k/prototypes: volume: 1 | \n"
        self.assertEqual(golden(full), "Golden models' STEP files: 1 of 1 bodies failed\nfailure: a golden model: volume\n")


class Command(unittest.TestCase):
    def run_it(self, kind, text):
        with tempfile.TemporaryDirectory() as d:
            full, out = os.path.join(d, "full.txt"), os.path.join(d, "out.txt")
            if text is not None:
                with open(full, "w") as f:
                    f.write(text)
            r = subprocess.run([sys.executable, os.path.join(HERE, "oracle_public.py"), kind, full, out], capture_output=True, text=True)
            self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
            with open(out) as f:
                return f.read()

    def test_files(self):
        self.assertEqual(self.run_it("sessions", FULL), PUBLIC)
        self.assertEqual(self.run_it("golden", GOLDEN_FULL), GOLDEN_PUBLIC)

    def test_a_missing_file_is_a_crash_kind(self):
        self.assertEqual([k for k, _ in oracle_kinds(self.run_it("sessions", None))], ["OpenCascade oracle crashed"])
        self.assertEqual([k for k, _ in golden_kinds(self.run_it("golden", None))],
                         ["golden model the oracle: " + CRASHED])

    def test_bad_arguments(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "oracle_public.py"), "other", "a", "b"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


WORKFLOWS = os.path.join(os.path.dirname(HERE), "workflows")
ORACLE_RUN = re.compile(r"\bpython3?\b[^#\n]*\b(?:golden_step|sketch_extrude)\.py\b")
ORACLE_FILE = re.compile(r'"(\$[^"]*\.txt)"')
FINDINGS = re.compile(r'"(\$[^"]*(?:oracle-disagreements|golden-report)\.txt)"')


def oracle_problems(text):
    """Why a workflow lets the oracle's full findings reach a public folder, or []."""
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("#"):
            continue
        if ORACLE_RUN.search(line):
            # Every file the oracle writes is in the sealed folder ($private), never a public one.
            out += [f"line {n}: the oracle writes {p}" for p in ORACLE_FILE.findall(line) if not p.startswith("$private/")]
        elif "oracle_public.py" not in line:
            # A findings file outside the sealed folder is a public one: only oracle_public.py may write it.
            out += [f"line {n}: {p} is not made by oracle_public.py" for p in FINDINGS.findall(line) if not p.startswith("$private/")]
    return out


class Workflows(unittest.TestCase):
    def read(self, name):
        with open(os.path.join(WORKFLOWS, name)) as f:
            return f.read()

    def test_the_oracle_jobs_keep_the_full_findings_sealed(self):
        for name in ("fuzz.yml", "nightly.yml"):
            text = self.read(name)
            self.assertIn("oracle_public.py", text, name)
            self.assertEqual(oracle_problems(text), [], name)

    def test_the_check_catches_the_old_public_findings(self):
        # Put back what the jobs did before H3c: the oracle writing its findings straight into the public folder.
        fuzz = self.read("fuzz.yml").replace('"$private/oracle-disagreements.txt" >', '"$OUT/disagreements.txt" >', 1)
        self.assertEqual(len(oracle_problems(fuzz)), 1)
        golden = self.read("nightly.yml").replace(
            '            python3 .github/scripts/oracle_public.py golden "$private/golden-report.txt" "$dir/golden-report.txt"\n',
            '            mv "$private/golden-report.txt" "$dir/golden-report.txt"\n', 1)
        self.assertEqual(len(oracle_problems(golden)), 1)

    def test_the_sealed_findings_never_reach_the_public_collect(self):
        # fuzz.yml's collect takes only the fuzz-* folders; nightly.yml's drops the sealed ones before collecting.
        fuzz = self.read("fuzz.yml")
        collect = fuzz[fuzz.index("\n  collect:"):]
        self.assertIn("pattern: fuzz-*", collect)
        nightly = self.read("nightly.yml")
        self.assertIn('rm -rf "$IN/golden-step" "$IN"/sealed-*', nightly[nightly.index("\n  collect:"):])


if __name__ == "__main__":
    unittest.main()
