"""Tests for app_tests.py: python3 -m unittest discover -s .github/scripts

ci.yml's app job is split in two (the design tests, and every other
workspace's); a workspace in neither, or in both, would be a test that never
runs or runs twice, so the split is checked against the real workspace list."""

import os
import unittest

import app_tests

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Split(unittest.TestCase):
    def test_every_workspace_in_exactly_one_share(self):
        everything = app_tests.workspaces(ROOT)
        design = app_tests.share("design", everything)
        rest = app_tests.share("rest", everything)
        self.assertEqual(design, ["workspaces/design"])
        self.assertEqual(sorted(design + rest), sorted(everything))
        self.assertFalse(set(design) & set(rest))

    def test_matches_the_root_workspace_globs(self):
        # Hand-checked from package.json: packages/*, workspaces/*, apps/* and training.
        everything = app_tests.workspaces(ROOT)
        self.assertIn("packages/core", everything)
        self.assertIn("apps/fission", everything)
        self.assertIn("training", everything)
        self.assertNotIn("packages", everything)

    def test_design_has_tests(self):
        self.assertTrue(app_tests.has_test(ROOT, "workspaces/design"))

    def test_a_share_name_that_does_not_exist_is_refused(self):
        with self.assertRaises(ValueError):
            app_tests.share("other", ["a"])


if __name__ == "__main__":
    unittest.main()
