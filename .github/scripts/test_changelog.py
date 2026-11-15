"""Tests for changelog.py: python3 -m unittest discover -s .github/scripts"""

import os
import random
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import changelog  # noqa: E402
from changelog import Fragment, check_pr, number, parse_changelog, parse_fragment, render  # noqa: E402
from check_version import check_changelog  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "changelog.py")

START = """# Changelog

Intro.

## 0.32.21 (2026-10-27)

- Old entry.

## 0.32.20 (2026-10-26)

- Older entry.
"""


PUBLIC_START = """# What's new

Intro.

## 0.32.21 (2026-10-27)

- Old public line.
"""


def frag(name, bump, date="2026-11-01"):
    return Fragment(name, bump, f"- Entry {name}.", date)


def numbered_text(text, fragments):
    preamble, sections = parse_changelog(text)
    return render(preamble, number(sections, fragments))


class ParseFragment(unittest.TestCase):
    def test_each_bump(self):
        for first, bump in [("fix", "fix"), ("none", "none"), ("step 33", ("step", 33)), ("step 0", ("step", 0))]:
            f, problem = parse_fragment("a.md", f"{first}\n\n- Text.\n")
            self.assertIsNone(problem)
            self.assertEqual((f.bump, f.text), (bump, "- Text."))

    def test_several_lines_kept(self):
        f, _ = parse_fragment("a.md", "fix\n\n- One.\n- Two,\n  more.   \n\n")
        self.assertEqual(f.text, "- One.\n- Two,\n  more.")

    def test_refused(self):
        cases = [
            ("A.md", "fix\n\n- x\n", "name"),
            ("a.txt", "fix\n\n- x\n", "name"),
            ("-a.md", "fix\n\n- x\n", "name"),
            ("a.md", "Fix\n\n- x\n", "first line"),
            ("a.md", "fix:\n\n- x\n", "first line"),
            ("a.md", "step\n\n- x\n", "first line"),
            ("a.md", "step 033\n\n- x\n", "first line"),
            ("a.md", "bugfix\n\n- x\n", "first line"),
            ("a.md", "fix\n- x\n", "blank line"),
            ("a.md", "fix", "blank line"),
            ("a.md", "fix\n\nx\n", "start with '- '"),
            ("a.md", "fix\n\n\n", "start with '- '"),
            ("a.md", "fix\n\n- x\n## 0.40.0 (2026-11-01)\n", "no headings"),
        ]
        for name, content, words in cases:
            f, problem = parse_fragment(name, content)
            self.assertIsNone(f, (name, content))
            self.assertIn(words, problem, (name, content))


class NextVersion(unittest.TestCase):
    def test_hand_worked(self):
        nv = changelog.next_version
        self.assertEqual(nv((0, 32, 21), "fix"), (0, 32, 22))  # bug fix adds one
        self.assertEqual(nv((0, 32, 21), ("step", 33)), (0, 33, 0))  # a new step: one more, starting at .0
        # The step's own number never moves the version by more than one: the
        # middle number counts steps started. Step 89 done early from 0.35.53
        # is 0.36.0, not 0.89.0 (the jump this rule ends), and the main line's
        # step 37 from 0.89.72 is 0.90.0, not "nothing" (37 < 89).
        self.assertEqual(nv((0, 35, 53), ("step", 89)), (0, 36, 0))
        self.assertEqual(nv((0, 89, 72), ("step", 37)), (0, 90, 0))
        self.assertEqual(nv((0, 89, 72), ("step", 0)), (0, 90, 0))
        self.assertIsNone(nv((0, 32, 21), "none"))

    def test_legacy_rule_kept(self):
        # The fragments merged under the old rule (0.N.0, or nothing when
        # step N or later had started) keep it, so their numbers never move.
        nv = changelog.next_version
        self.assertEqual(nv((0, 32, 21), ("step", 35), legacy=True), (0, 35, 0))
        self.assertEqual(nv((0, 35, 53), ("step", 89), legacy=True), (0, 89, 0))
        self.assertIsNone(nv((0, 89, 5), ("step", 77), legacy=True))
        self.assertIsNone(nv((0, 89, 5), ("step", 89), legacy=True))
        self.assertEqual(changelog.bumped((0, 35, 53), frag("oubx5f-kept-history.md", ("step", 89))), (0, 89, 0))
        self.assertEqual(changelog.bumped((0, 35, 53), frag("other.md", ("step", 89))), (0, 36, 0))

    def test_main_history_replayed(self):
        # The app's own history, by hand (`changelog.py show`, 14 Nov 2026):
        # 0.35.53, then step 89 (kept history, legacy) made 0.89.0; a fix
        # 0.89.1; step 77 (3MF and OBJ, legacy) nothing; a fix 0.89.2; step
        # 53 (symmetric, legacy) and step 66 (mass, legacy) nothing. From
        # then on: step 37 makes 0.90.0, a fix 0.90.1, step 38 0.91.0. The
        # numbers already shown stay exactly as they were and none goes back.
        start = "# Changelog\n\n## 0.35.53 (2026-11-09)\n\n- Start.\n"
        order = [frag("oubx5f-kept-history.md", ("step", 89)), frag("a.md", "fix"),
                 frag("p357ph-3mf-obj.md", ("step", 77)), frag("b.md", "fix"),
                 frag("gig53r-symmetric.md", ("step", 53)), frag("gig53r-body-mass.md", ("step", 66)),
                 frag("c.md", ("step", 37)), frag("d.md", "fix"), frag("e.md", ("step", 38))]
        versions = [v for _, v in changelog.versions_of(parse_changelog(start)[1], order)]
        self.assertEqual(versions, [(0, 89, 0), (0, 89, 1), (0, 89, 1), (0, 89, 2), (0, 89, 2), (0, 89, 2),
                                    (0, 90, 0), (0, 90, 1), (0, 91, 0)])

    def test_legacy_names_are_the_merged_step_fragments(self):
        # Every step fragment still on main is a legacy one (all merged before
        # the rule changed); a new one there would mean the list is stale or a
        # pull request added itself to it.
        fragments, _ = changelog.read_fragments(ROOT)
        steps = {n for n, f in fragments.items() if isinstance(f.bump, tuple)}
        for name in steps - changelog.LEGACY_STEPS:
            self.assertNotIn(fragments[name].bump[1], changelog.STARTED_STEPS, name)


class Number(unittest.TestCase):
    def test_hand_worked(self):
        # Merged in this order: a none, b fix, c none, d step 33, e fix, f none, g step 40.
        # a joins 0.32.21 (on top: newest first); b makes 0.32.22, c joins it;
        # d makes 0.33.0; e makes 0.33.1; f joins 0.33.1 above e; g (step 40,
        # done early) makes 0.34.0, one more, never 0.40.0.
        order = [frag("a", "none", "2026-10-28"), frag("b", "fix", "2026-10-28"), frag("c", "none", "2026-10-29"),
                 frag("d", ("step", 33), "2026-10-29"), frag("e", "fix", "2026-10-30"),
                 frag("f", "none", "2026-10-30"), frag("g", ("step", 40), "2026-10-31")]
        self.assertEqual(numbered_text(START, order), """# Changelog

Intro.

## 0.34.0 (2026-10-31)

- Entry g.

## 0.33.1 (2026-10-30)

- Entry f.
- Entry e.

## 0.33.0 (2026-10-29)

- Entry d.

## 0.32.22 (2026-10-28)

- Entry c.
- Entry b.

## 0.32.21 (2026-10-27)

- Entry a.
- Old entry.

## 0.32.20 (2026-10-26)

- Older entry.
""")

    def test_order_decides_the_numbers(self):
        # Two fixes: whichever merged first is 0.32.22.
        one = numbered_text(START, [frag("x", "fix"), frag("y", "fix")])
        other = numbered_text(START, [frag("y", "fix"), frag("x", "fix")])
        self.assertIn("## 0.32.23 (2026-11-01)\n\n- Entry y.\n\n## 0.32.22 (2026-11-01)\n\n- Entry x.", one)
        self.assertIn("## 0.32.23 (2026-11-01)\n\n- Entry x.\n\n## 0.32.22 (2026-11-01)\n\n- Entry y.", other)

    def test_nothing_to_number(self):
        self.assertEqual(numbered_text(START, []), START)

    def test_no_heading_to_count_from(self):
        with self.assertRaises(ValueError):
            numbered_text("# Changelog\n", [frag("a", "fix")])

    def test_real_changelog_reads_back_exactly(self):
        # parse then render is the file, byte for byte, so a fold never
        # rewrites an old entry.
        with open(os.path.join(ROOT, "CHANGELOG.md"), encoding="utf-8") as f:
            text = f.read()
        self.assertEqual(numbered_text(text, []), text)


def model(start, bumps):
    """The version after these bumps, worked out independently of number():
    the middle number is the start's plus one per step (whatever its number);
    the fix count is the start's plus every fix when no step merged,
    otherwise the fixes merged after the last step. Every fix and every step
    makes a new version."""
    big, step, fixes = start
    steps = [i for i, b in enumerate(bumps) if b not in ("fix", "none")]
    new = bumps.count("fix") + len(steps)
    if not steps:
        return (big, step, fixes + bumps.count("fix")), new
    return (big, step + len(steps), bumps[steps[-1] + 1:].count("fix")), new


class RandomMergeOrders(unittest.TestCase):
    """Seeded: pull requests merging in any order never give two entries one
    number or skip one, every entry appears once, and folding part way
    (fold, then number the rest from the folded file) gives the same file."""

    SEEDS = 500

    def test_random_orders(self):
        for seed in range(self.SEEDS):
            rng = random.Random(seed)
            step, fixes = rng.randint(1, 40), rng.randint(0, 5)
            start = f"# Changelog\n\nIntro.\n\n## 0.{step}.{fixes} (2026-10-01)\n\n- Start.\n"
            fragments = []
            for i in range(rng.randint(0, 14)):
                kind = rng.random()
                bump = "fix" if kind < 0.4 else "none" if kind < 0.75 else ("step", rng.randint(max(0, step - 2), step + 4))
                fragments.append(frag(f"pr{i}", bump, f"2026-10-{2 + i:02d}"))
            rng.shuffle(fragments)  # the order the queue happened to merge them in
            with self.subTest(seed=seed, order=fragments):
                text = numbered_text(start, fragments)
                self.assertEqual(check_changelog(text), [])  # newest first, no repeat, no skip
                for f in fragments:
                    self.assertEqual(text.count(f.text), 1)
                # The pull request folding them all passes check_pr: the order
                # it reads from the entries' places is the one they merged in.
                files = {"CHANGELOG.md": start}
                for f in fragments:
                    first = f.bump if isinstance(f.bump, str) else f"step {f.bump[1]}"
                    files[f"changelog.d/{f.name}.md"] = f"{first}\n\n{f.text}\n"
                diff = [("M", "CHANGELOG.md")] + [("D", f"changelog.d/{f.name}.md") for f in fragments]
                if fragments:
                    self.assertEqual(check_pr(diff, files.get, dict(files, **{"CHANGELOG.md": text}).get), [])
                _, sections = parse_changelog(text)
                expected_version, expected_new = model((0, step, fixes), [f.bump for f in fragments])
                self.assertEqual(sections[0].version, expected_version)
                self.assertEqual(len(sections) - 1, expected_new)
                # No jump and no going back: each entry's version is the one
                # before or one more fix or one more step.
                versions = [(0, step, fixes)] + [v for _, v in changelog.versions_of(parse_changelog(start)[1], fragments)]
                for before, after in zip(versions, versions[1:]):
                    self.assertIn(after, (before, (0, before[1], before[2] + 1), (0, before[1] + 1, 0)))
                k = rng.randint(0, len(fragments))
                folded = numbered_text(start, fragments[:k])
                self.assertEqual(numbered_text(folded, fragments[k:]), text)


class LeakGuard(unittest.TestCase):
    def test_a_plain_entry_is_clean(self):
        # A normal user-facing entry names no kernel internals.
        self.assertEqual(changelog.leaks("changelog.d/x.md",
                         "none\n\n- Extrude any flat face of a body, no sketch needed."), [])

    def test_a_rust_file_name_is_a_leak(self):
        # The public app is TypeScript, so any ".rs" file named in an entry is
        # the private kernel's; the guard must catch it and name the rule.
        problems = changelog.leaks("changelog.d/x.md", "fix\n\n- Fixed a crash in gearbox.rs.")
        self.assertEqual(len(problems), 1)
        self.assertIn("gearbox.rs", problems[0])
        self.assertIn("never how the kernel works", problems[0])

    def test_private_paths_and_internal_names_are_leaks(self):
        for text, tell in [
            ("none\n\n- Checked against prototypes/demo/model.py.", "prototypes/"),
            ("none\n\n- A change in kernel/src somewhere.", "kernel/src"),
            ("none\n\n- The facts table is now exact.", "facts table"),
            ("none\n\n- Fixed in the facts_model.", "facts_model"),
            ("none\n\n- The facts-table is now exact.", "facts-table"),
            ("none\n\n- The facts_table is now exact.", "facts_table"),
            ("none\n\n- A bug in spade no longer crashes arcs.", "spade"),
        ]:
            problems = changelog.leaks("changelog.d/x.md", text)
            self.assertTrue(problems, f"{tell!r} should be caught")

    def test_the_guard_catches_a_leaky_added_fragment_in_a_pr(self):
        # Same as a real PR: a clean entry passes, the same entry with a kernel
        # file name added fails with the leak message (a deliberate break).
        clean = check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p: "none\n\n- Combine is faster.\n\npublic: none\n")
        self.assertEqual(clean, [])
        leaky = check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p: "none\n\n- Combine is faster (widget.rs).\n\npublic: none\n")
        self.assertEqual(len(leaky), 1)
        self.assertIn("widget.rs", leaky[0])


class CheckPr(unittest.TestCase):
    BASE = {"CHANGELOG.md": START, "changelog.d/old.md": "fix\n\n- Old fix.\n"}

    def run_check(self, diff, head):
        files = dict(self.BASE, **head)
        # An added fragment always has content on the head; default a clean one
        # for the tests that don't care about its text.
        for s, p in diff:
            if s == "A" and p.startswith("changelog.d/") and p.endswith(".md") and p not in files:
                files[p] = "none\n\n- A change.\n\npublic: none\n"
        return check_pr(diff, lambda p: self.BASE[p], lambda p: files[p])

    def test_one_new_fragment(self):
        self.assertEqual(self.run_check([("A", "changelog.d/new.md"), ("M", "kernel/src/lib.rs")], {}), [])

    def step_check(self, step, base_extra=None):
        base = dict(self.BASE, **(base_extra or {}))
        new = {"changelog.d/new.md": f"step {step}\n\n- A step.\n\npublic: none\n"}
        files = dict(base, **new)
        return check_pr([("A", "changelog.d/new.md")], lambda p: base[p], lambda p: files[p],
                        [p for p in base if p.startswith("changelog.d/")])

    def test_a_step_not_started_yet(self):
        # Step 37 (the main line's next) and step 90 have not started: fine.
        self.assertEqual(self.step_check(37), [])
        self.assertEqual(self.step_check(90), [])

    def test_a_step_already_started_is_refused(self):
        # Step 89 (done early), 53, 66, 77 and every step to 36 had started
        # by 14 Nov 2026: a second start would count one step twice.
        for step in (89, 77, 66, 53, 36, 35, 1, 0):
            problems = self.step_check(step)
            self.assertEqual(len(problems), 1, step)
            self.assertIn(f"step {step} has already started", problems[0])
            self.assertIn("write 'none'", problems[0])

    def test_a_step_another_fragment_on_main_started(self):
        # A fragment on main started step 40; this one may not start it again.
        problems = self.step_check(40, {"changelog.d/s40.md": "step 40\n\n- Step 40.\n\npublic: none\n"})
        self.assertEqual(len(problems), 1)
        self.assertIn("step 40 has already started (changelog.d/s40.md)", problems[0])
        # Step 41 is still free.
        self.assertEqual(self.step_check(41, {"changelog.d/s40.md": "step 40\n\n- Step 40.\n\npublic: none\n"}), [])

    def test_no_fragment(self):
        problems = self.run_check([("M", "kernel/src/lib.rs")], {})
        self.assertEqual(len(problems), 1)
        self.assertIn("add exactly one changelog.d/<name>.md", problems[0])

    def test_two_fragments(self):
        problems = self.run_check([("A", "changelog.d/a.md"), ("A", "changelog.d/b.md")], {})
        self.assertIn("not 2", problems[0])

    def test_readme_is_no_fragment(self):
        self.assertEqual(len(self.run_check([("A", "changelog.d/README.txt")], {})), 1)

    def test_merged_fragment_changed(self):
        problems = self.run_check([("A", "changelog.d/new.md"), ("M", "changelog.d/old.md")], {})
        self.assertEqual(problems, ["changelog.d/old.md is already on main, so its entry is fixed; "
                                    "add a new fragment instead of changing it"])

    def test_version_heading_written_by_hand(self):
        head = START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Mine.\n\n## 0.32.21")
        problems = self.run_check([("M", "CHANGELOG.md")], {"CHANGELOG.md": head})
        self.assertIn("CHANGELOG.md gains the heading 0.32.22 (2026-10-28): don't write version headings", problems[0])
        self.assertEqual(len(problems), 2)  # and no fragment

    def test_old_entry_corrected(self):
        head = START.replace("- Older entry.", "- Older entry, typo fixed.")
        self.assertEqual(self.run_check([("M", "CHANGELOG.md"), ("A", "changelog.d/typo.md")], {"CHANGELOG.md": head}), [])

    def test_version_added_back(self):
        problems = self.run_check([("A", "changelog.d/new.md"), ("A", "VERSION")], {"VERSION": "0.32.22\n"})
        self.assertEqual(len(problems), 1)
        self.assertIn("don't add VERSION back", problems[0])

    def test_fold(self):
        head = START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")
        self.assertEqual(self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {"CHANGELOG.md": head}), [])

    def test_fold_writing_its_own_heading(self):
        # A fold of the one fix fragment from 0.32.21 can only give 0.32.22;
        # deleting a fragment used to switch the heading check off, so any
        # number passed.
        head = START.replace("## 0.32.21", "## 0.40.0 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {"CHANGELOG.md": head})
        self.assertEqual(problems, ["CHANGELOG.md isn't what fold writes from main's: it has the heading 0.40.0 (2026-10-28) "
                                    "where fold writes 0.32.22 (2026-10-28); run changelog.py fold on a fresh main"])
        # The right fold with one more heading written by hand on top.
        head = START.replace("## 0.32.21", "## 0.32.23 (2026-10-28)\n\n- Mine.\n\n## 0.32.22 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {"CHANGELOG.md": head})
        self.assertEqual(len(problems), 1)
        self.assertIn("it has the heading 0.32.23 (2026-10-28) where fold writes 0.32.22 (2026-10-28)", problems[0])

    def test_fold_of_two_in_their_order(self):
        # Worked by hand from 0.32.21: the entries' places say the order they
        # merged in (the oldest lowest). The fix, then step 33: 0.32.22 for
        # the fix, then 0.33.0 for the step, newest first.
        base = dict(self.BASE, **{"changelog.d/step.md": "step 33\n\n- Step.\n"})
        diff = [("M", "CHANGELOG.md"), ("D", "changelog.d/old.md"), ("D", "changelog.d/step.md")]
        good = START.replace("## 0.32.21", "## 0.33.0 (2026-10-28)\n\n- Step.\n\n## 0.32.22 (2026-10-27)\n\n- Old fix.\n\n## 0.32.21")
        self.assertEqual(check_pr(diff, base.get, dict(base, **{"CHANGELOG.md": good}).get), [])
        # Swapped numbers: with the step below (older), it gives 0.33.0 and
        # the fix after it 0.33.1, so 0.32.22 on top is wrong.
        bad = START.replace("## 0.32.21", "## 0.33.0 (2026-10-28)\n\n- Old fix.\n\n## 0.32.22 (2026-10-27)\n\n- Step.\n\n## 0.32.21")
        problems = check_pr(diff, base.get, dict(base, **{"CHANGELOG.md": bad}).get)
        self.assertEqual(len(problems), 1)
        self.assertIn("it has the heading 0.33.0 (2026-10-28) where fold writes 0.33.1 (2026-10-28)", problems[0])
        # A none entry joins the newest heading, at its top.
        base = dict(self.BASE, **{"changelog.d/old.md": "none\n\n- Old note.\n"})
        good = START.replace("- Old entry.", "- Old note.\n- Old entry.")
        diff = [("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")]
        self.assertEqual(check_pr(diff, base.get, dict(base, **{"CHANGELOG.md": good}).get), [])

    def test_fold_losing_an_entry(self):
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {})
        self.assertEqual(problems, ["changelog.d/old.md is deleted but its entry isn't in CHANGELOG.md: only a fold deletes fragments"])

    def test_fragment_deleted_without_a_fold(self):
        problems = self.run_check([("D", "changelog.d/old.md")], {})
        self.assertIn("CHANGELOG.md isn't changed", problems[0])

    def test_fold_with_a_new_entry(self):
        head = START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md"), ("A", "changelog.d/new.md")],
                                  {"CHANGELOG.md": head})
        self.assertEqual(len(problems), 1)
        self.assertIn("a fold only folds", problems[0])


class PublicPart(unittest.TestCase):
    """The fragment's public part: the lines for What's new (WHATS_NEW.md)."""

    def test_parsed(self):
        f, problem = parse_fragment("a.md", "fix\n\n- Fixed the arc maths.\n\npublic:\n- Arcs far out no longer crash.\n- Two.\n")
        self.assertIsNone(problem)
        self.assertEqual((f.text, f.public), ("- Fixed the arc maths.", "- Arcs far out no longer crash.\n- Two."))
        f, _ = parse_fragment("a.md", "none\n\n- Tests only.\n\npublic: none\n\n")
        self.assertEqual((f.text, f.public), ("- Tests only.", ""))
        # Merged before the public part existed: None, not "".
        f, _ = parse_fragment("a.md", "none\n\n- Old.\n")
        self.assertIsNone(f.public)

    def test_refused(self):
        cases = [
            ("fix\n\n- x\n\npublic:\n", "is followed by the '- ' lines"),
            ("fix\n\n- x\n\npublic:\nArcs work.\n", "is followed by the '- ' lines"),
            ("fix\n\n- x\n\npublic: none\n- But this.\n", "line 6: nothing follows 'public: none'"),
            ("fix\n\n- x\n\npublic:\n- a\npublic: none\n", "line 7: only one public part"),
            ("fix\n\npublic:\n- a\n", "the entry must start with '- '"),
        ]
        for content, why in cases:
            f, problem = parse_fragment("a.md", content)
            self.assertIsNone(f, content)
            self.assertIn(why, problem, content)

    def test_a_new_fragment_needs_it(self):
        # The break CI must catch: a fragment in the old form, with no public part.
        problems = check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p: "fix\n\n- Fixed it.\n")
        self.assertEqual(len(problems), 1)
        self.assertIn("end it with its public part for What's new", problems[0])
        for public in ("public: none", "public:\n- Arcs no longer crash."):
            self.assertEqual(check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p: f"fix\n\n- Fixed it.\n\n{public}\n"), [])

    def test_public_leaks(self):
        # Each tell in a public line, and a near miss of each that is fine.
        leaky = [
            ("- Fixed a flaky CI check.", "'CI'"),
            ("- More browser tests for Move.", "'browser tests'"),
            ("- The nightly fuzzing finds more.", "'nightly'"),
            ("- Refactored the sketch code.", "'Refactored'"),
            ("- Faster kernel booleans.", "'kernel'"),
            ("- A looser tolerance for imported parts.", "'tolerance'"),
            ("- Fixed an XSS in project names.", "'XSS'"),
            ("- Closed a vulnerability in file opening.", "'vulnerability'"),
            ("- Faster arcs (arc.rs).", "'arc.rs'"),
        ]
        for line, word in leaky:
            problems = check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p, line=line: f"fix\n\n- x\n\npublic:\n{line}\n")
            self.assertEqual(len(problems), 1, line)
            self.assertIn(word, problems[0], line)
        fine = ["- Print a small test piece and measure it.", "- Security improvements.", "- Circles are smoother.",
                "- Picking a CIrcle's centre.", "- The geometry engine restarts by itself."]
        for line in fine:
            self.assertEqual(check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p, line=line: f"fix\n\n- x\n\npublic:\n{line}\n"), [], line)
        # The internal entry may say how it was tested; only the public part is held to this.
        self.assertEqual(check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p: "fix\n\n- Nightly CI fuzzing found it.\n\npublic: none\n"), [])


def pfrag(name, bump, public, date="2026-11-01"):
    return Fragment(name, bump, f"- Entry {name}.", date, public=public)


class FoldPublic(unittest.TestCase):
    def test_hand_worked(self):
        # From 0.32.21: f1 is a fix with nothing public (0.32.22), f2 a fix
        # with a line (0.32.23), f3 a none with a line (joins 0.32.23, on top
        # of f2), f4 step 40 (one more step: 0.33.0). 0.32.22 gets no heading:
        # the list jumps from 0.32.23 to 0.32.21, and nothing is renumbered.
        sections = parse_changelog(START)[1]
        fragments = [pfrag("f1", "fix", "", "2026-10-28"), pfrag("f2", "fix", "- B.", "2026-10-29"),
                     pfrag("f3", "none", "- C.", "2026-10-30"), pfrag("f4", ("step", 40), "- D.", "2026-10-31")]
        assigned = changelog.versions_of(sections, fragments)
        self.assertEqual([v for _, v in assigned], [(0, 32, 22), (0, 32, 23), (0, 32, 23), (0, 33, 0)])
        dates = {s.version: s.date for s in number(sections, fragments)}
        got = changelog.fold_public(PUBLIC_START, assigned, dates)
        self.assertEqual(got, PUBLIC_START.replace(
            "## 0.32.21", "## 0.33.0 (2026-10-31)\n\n- D.\n\n## 0.32.23 (2026-10-29)\n\n- C.\n- B.\n\n## 0.32.21"))
        self.assertEqual(changelog.check_public(got, number(sections, fragments)), [])

    def test_into_the_middle(self):
        # A version between two already listed goes between them.
        text = PUBLIC_START.replace("## 0.32.21", "## 0.32.25 (2026-10-30)\n\n- New.\n\n## 0.32.21")
        got = changelog.fold_public(text, [(pfrag("x", "fix", "- Mid."), (0, 32, 23))], {(0, 32, 23): "2026-10-29"})
        self.assertIn("## 0.32.25 (2026-10-30)\n\n- New.\n\n## 0.32.23 (2026-10-29)\n\n- Mid.\n\n## 0.32.21", got)

    def test_legacy_and_none_add_nothing(self):
        assigned = [(pfrag("a", "fix", None), (0, 32, 22)), (pfrag("b", "fix", ""), (0, 32, 23))]
        self.assertEqual(changelog.fold_public(PUBLIC_START, assigned, {}), PUBLIC_START)

    def test_seeded_random(self):
        # 300 seeded runs: random bumps and public parts in a random merge
        # order. Every public line is listed exactly once, under the version
        # the changelog gives its entry; versions with nothing public have no
        # heading; the list passes its own check; and folding in two goes
        # (fold, then fold again later) gives the same text as one go.
        for seed in range(300):
            rng = random.Random(seed)
            fragments = []
            for i in range(rng.randint(1, 12)):
                bump = rng.choice(["fix", "fix", "none", ("step", rng.randint(33, 36))])
                public = rng.choice([None, "", f"- Line {i}.", f"- Line {i}a.\n- Line {i}b."])
                fragments.append(pfrag(f"f{i}", bump, public, f"2026-11-{i + 1:02d}"))
            sections = parse_changelog(START)[1]
            numbered = number(sections, fragments)
            dates = {s.version: s.date for s in numbered}
            assigned = changelog.versions_of(sections, fragments)
            got = changelog.fold_public(PUBLIC_START, assigned, dates)
            self.assertEqual(changelog.check_public(got, numbered), [], seed)
            listed = {s.version: s.raw for s in parse_changelog(got)[1]}
            for f, v in assigned:
                for line in (f.public or "").splitlines():
                    self.assertEqual(got.count(line + "\n"), 1, (seed, line))
                    self.assertIn(line, listed[v], (seed, line))
            public_versions = {v for f, v in assigned if f.public} | {(0, 32, 21)}
            self.assertEqual(set(listed), public_versions, seed)
            cut = rng.randint(0, len(fragments))
            first = changelog.fold_public(PUBLIC_START, assigned[:cut], dates)
            self.assertEqual(changelog.fold_public(first, assigned[cut:], dates), got, seed)


class CheckPublic(unittest.TestCase):
    SECTIONS = parse_changelog(START)[1]

    def problems(self, text):
        return changelog.check_public(text, self.SECTIONS)

    def test_good(self):
        self.assertEqual(self.problems(PUBLIC_START), [])
        # Newer than CHANGELOG.md's newest heading: still a fragment, fine.
        self.assertEqual(self.problems(PUBLIC_START.replace("## 0.32.21", "## 0.33.4 (2026-11-02)\n\n- Later.\n\n## 0.32.21")), [])
        # A gap: 0.32.21 and 0.32.19 listed, 0.32.20 left out.
        longer = parse_changelog(START + "\n## 0.32.19 (2026-10-25)\n\n- Oldest.\n")[1]
        self.assertEqual(changelog.check_public(PUBLIC_START + "\n## 0.32.19 (2026-10-25)\n\n- Older.\n", longer), [])

    def test_each_break(self):
        cases = [
            (PUBLIC_START.replace("# What's new", "# News"), "the title"),
            (PUBLIC_START.replace("(2026-10-27)", "(2026-10-28)"), "CHANGELOG.md dates 0.32.21 2026-10-27, not 2026-10-28"),
            (PUBLIC_START + "\n## 0.32.21 (2026-10-27)\n\n- Again.\n", "0.32.21 is listed twice"),
            (PUBLIC_START + "\n## 0.32.25 (2026-10-27)\n\n- Up.\n", "must come below 0.32.21"),
            (PUBLIC_START + "\n## 0.32.20 (2026-10-26)\n\n", "has no '- ' line"),
            (PUBLIC_START + "\nJust words.\n", "only '- ' lines"),
            (PUBLIC_START + "\n## 0.32.18 (2026-10-26)\n\n- Not a version.\n", "0.32.18 is not a version in CHANGELOG.md"),
            (PUBLIC_START.replace("## 0.32.21 (2026-10-27)", "## Latest"), "must be a version"),
            (PUBLIC_START.replace("- Old public line.", "- Fixed a CI check."), "'CI'"),
            ("# What's new\n\nNothing yet.\n", "no version heading"),
        ]
        for text, why in cases:
            found = self.problems(text)
            self.assertTrue(any(why in p for p in found), (why, found))


class WhatsNewInPr(unittest.TestCase):
    BASE = {"CHANGELOG.md": START, "WHATS_NEW.md": PUBLIC_START,
            "changelog.d/old.md": "fix\n\n- Old fix.\n\npublic:\n- Users see it.\n"}
    FOLDED = START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")

    def run_check(self, diff, head):
        files = dict(self.BASE, **head)
        return check_pr(diff, lambda p: self.BASE[p], lambda p: files[p])

    def test_fold_writes_the_public_line(self):
        diff = [("M", "CHANGELOG.md"), ("M", "WHATS_NEW.md"), ("D", "changelog.d/old.md")]
        good = PUBLIC_START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Users see it.\n\n## 0.32.21")
        self.assertEqual(self.run_check(diff, {"CHANGELOG.md": self.FOLDED, "WHATS_NEW.md": good}), [])
        # Under the wrong version, or left out, is refused.
        wrong = PUBLIC_START.replace("- Old public line.", "- Users see it.\n- Old public line.")
        problems = self.run_check(diff, {"CHANGELOG.md": self.FOLDED, "WHATS_NEW.md": wrong})
        self.assertEqual(len(problems), 1)
        self.assertIn("isn't what fold writes", problems[0])
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {"CHANGELOG.md": self.FOLDED})
        self.assertEqual(problems, ["a fold writes the folded public lines into WHATS_NEW.md too; run changelog.py fold"])

    def test_hand_edits(self):
        new = "changelog.d/new.md"
        frag_ = {new: "none\n\n- Typo.\n\npublic: none\n"}
        fixed = PUBLIC_START.replace("- Old public line.", "- Old public line, put right.")
        self.assertEqual(self.run_check([("A", new), ("M", "WHATS_NEW.md")], dict(frag_, **{"WHATS_NEW.md": fixed})), [])
        heading = PUBLIC_START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Mine.\n\n## 0.32.21")
        problems = self.run_check([("A", new), ("M", "WHATS_NEW.md")], dict(frag_, **{"WHATS_NEW.md": heading}))
        self.assertEqual(len(problems), 1)
        self.assertIn("WHATS_NEW.md gains the heading 0.32.22 (2026-10-28)", problems[0])
        problems = self.run_check([("A", new), ("D", "WHATS_NEW.md")], frag_)
        self.assertEqual(len(problems), 1)
        self.assertIn("don't delete it", problems[0])


class RealGit(unittest.TestCase):
    """The commands on real repositories: pull requests merged with merge
    commits (as the merge queue does), in an order unlike their names'."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "t")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "commit.gpgsign", "false")
        self.write("CHANGELOG.md", START)
        self.write("WHATS_NEW.md", PUBLIC_START)
        self.write("changelog.d/README.txt", "Fragments.\n")
        self.commit("start")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def git(self, *args, date="2026-10-28T10:00:00Z"):
        env = dict(os.environ, GIT_COMMITTER_DATE=date, GIT_AUTHOR_DATE=date)
        return subprocess.run(["git", "-C", self.dir, *args], check=True, capture_output=True, text=True, env=env).stdout

    def write(self, path, text):
        full = os.path.join(self.dir, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(text)

    def commit(self, message, date="2026-10-28T10:00:00Z"):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message, date=date)

    def branch(self, name, bump, base="main", public="public: none"):
        self.git("checkout", "-q", "-b", name, base)
        self.write(f"changelog.d/{name}.md", f"{bump}\n\n- Entry {name}.\n\n{public}\n")
        self.commit(name)
        self.git("checkout", "-q", "main")

    def merge(self, name, date):
        self.git("merge", "-q", "--no-ff", "-m", f"Merge {name}", name, date=date)

    def run_script(self, *args):
        r = subprocess.run([sys.executable, SCRIPT, *args, self.dir], capture_output=True, text=True)
        return r.returncode, r.stdout

    def test_merge_order_not_name_order(self):
        # Three pull requests branch off the same main; they merge z, a, m.
        # z (fix) merged first: 0.32.22 on the 28th; a (fix) 0.32.23 on the
        # 29th; m (none) joins 0.32.23. By name they would be a, m, z.
        # z and m have public lines, a has none, so What's new lists 0.32.23
        # for m alone and 0.32.22 for z.
        for name, bump, public in [("a", "fix", "public: none"), ("m", "none", "public:\n- Public m."),
                                   ("z", "fix", "public:\n- Public z.")]:
            self.branch(name, bump, public=public)
        self.merge("z", "2026-10-28T23:30:00Z")
        # a merges main in first (as threads do): z's fragment reaches a's
        # branch, but on main it was added by z's merge, not a's.
        self.git("checkout", "-q", "a")
        self.git("merge", "-q", "--no-ff", "-m", "Merge main into a", "main", date="2026-10-29T01:00:00Z")
        self.git("checkout", "-q", "main")
        self.merge("a", "2026-10-29T02:00:00Z")
        self.merge("m", "2026-10-29T03:00:00Z")
        code, out = self.run_script("show")
        self.assertEqual(code, 0, out)
        self.assertIn("""## 0.32.23 (2026-10-29)

- Entry m.
- Entry a.

## 0.32.22 (2026-10-28)

- Entry z.

## 0.32.21 (2026-10-27)""", out)
        self.assertEqual(self.run_script("version"), (0, "0.32.23\n"))
        code, public = self.run_script("public")
        self.assertEqual(code, 0, public)
        self.assertEqual(public, PUBLIC_START.replace("## 0.32.21", "## 0.32.23 (2026-10-29)\n\n- Public m.\n\n"
                                                      "## 0.32.22 (2026-10-28)\n\n- Public z.\n\n## 0.32.21"))

        # Fold, commit it as a pull request would, then one more fix merges:
        # the numbers before the fold stay, the new one follows on.
        code, out = self.run_script("fold")
        self.assertEqual((code, out), (0, "folded 3 fragment(s); the version is 0.32.23\n"))
        self.assertEqual(sorted(os.listdir(os.path.join(self.dir, "changelog.d"))), ["README.txt"])
        with open(os.path.join(self.dir, "WHATS_NEW.md"), encoding="utf-8") as f:
            self.assertEqual(f.read(), public)  # fold writes what public showed
        self.git("checkout", "-q", "-b", "fold")
        self.commit("fold")
        # CI's check of the fold pull request agrees with fold itself.
        r = subprocess.run([sys.executable, SCRIPT, "pr", "main", "fold", self.dir], capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout), (0, "this pull request's changelog files are in order\n"))
        self.branch("b", "fix", base="main")
        self.merge("b", "2026-10-30T02:00:00Z")
        self.merge("fold", "2026-10-30T03:00:00Z")
        code, after = self.run_script("show")
        self.assertEqual(code, 0, after)
        self.assertTrue(after.startswith(START.split("## ")[0] + "## 0.32.24 (2026-10-30)\n\n- Entry b.\n\n## 0.32.23 (2026-10-29)"), after)
        self.assertEqual(self.run_script("check"), (0, "CHANGELOG.md and changelog.d/ are in order\n"))

    def test_fold_refuses_uncommitted_fragments(self):
        self.write("changelog.d/local.md", "fix\n\n- Not merged.\n")
        code, out = self.run_script("fold")
        self.assertEqual(code, 1)
        self.assertIn("not committed, so not merged yet: local.md", out)
        # show still previews it, last, dated today.
        code, out = self.run_script("show")
        self.assertIn("- Not merged.", out)

    def test_pr_command(self):
        self.branch("old", "fix")
        self.merge("old", "2026-10-28T12:00:00Z")
        self.git("checkout", "-q", "-b", "bad")
        self.write("changelog.d/old.md", "fix\n\n- Rewritten.\n")
        self.commit("rewrite a merged fragment")
        r = subprocess.run([sys.executable, SCRIPT, "pr", "main", "bad", self.dir], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("changelog.d/old.md is already on main", r.stdout)
        self.git("checkout", "-q", "-b", "good", "main")
        self.branch("new", "none", base="good")
        r = subprocess.run([sys.executable, SCRIPT, "pr", "main", "new", self.dir], capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout), (0, "this pull request's changelog files are in order\n"))

    def test_pr_command_refuses_a_step_started_on_main(self):
        # The real command reads the base's fragments from git: step 40
        # merged, so a second `step 40` is refused and `step 41` passes; the
        # version counts each step once (0.32.21 -> 0.33.0 -> 0.34.0).
        self.branch("s40", "step 40")
        self.merge("s40", "2026-10-28T12:00:00Z")
        self.branch("again", "step 40")
        r = subprocess.run([sys.executable, SCRIPT, "pr", "main", "again", self.dir], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("step 40 has already started (changelog.d/s40.md)", r.stdout)
        self.branch("s41", "step 41")
        r = subprocess.run([sys.executable, SCRIPT, "pr", "main", "s41", self.dir], capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout), (0, "this pull request's changelog files are in order\n"))
        self.merge("s41", "2026-10-29T12:00:00Z")
        self.assertEqual(self.run_script("version"), (0, "0.34.0\n"))

    def test_check_refuses_a_bad_fragment(self):
        self.write("changelog.d/bad.md", "bugfix\n\n- x\n")
        code, out = self.run_script("check")
        self.assertEqual(code, 1)
        self.assertIn("changelog.d/bad.md: the first line must be 'fix', 'step N' or 'none'", out)


class RepositoryFiles(unittest.TestCase):
    """The real CHANGELOG.md and changelog.d/, on every PR by CI's kernel job."""

    def test_in_order(self):
        self.assertEqual(changelog.check(ROOT), [])


if __name__ == "__main__":
    unittest.main()
