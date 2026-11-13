"""The app job's tests, in two shares: python3 .github/scripts/app_tests.py design|rest

`npm test` runs every workspace's tests in one go, which with Design's
(about 13 minutes of it) was running into the job's time limit. ci.yml runs
the two shares as parallel jobs, `app (design)` and `app (rest)`, and the job
named `app` that auto-merge and main's ruleset wait for passes only when both
did. Every workspace in the root package.json's list is in exactly one share
(test_app_tests.py), so a new workspace's tests run without touching CI. Each
share runs all of its workspaces even after a failure, and fails if any did,
like `npm test --workspaces --if-present`."""

import glob
import json
import os
import subprocess
import sys

DESIGN = ["workspaces/design"]


def workspaces(root):
    """The root package.json's workspace folders, globs expanded, in order."""
    patterns = json.load(open(os.path.join(root, "package.json")))["workspaces"]
    found = []
    for pattern in patterns:
        for path in sorted(glob.glob(os.path.join(root, pattern))):
            if os.path.isfile(os.path.join(path, "package.json")):
                found.append(os.path.relpath(path, root))
    return found


def share(name, everything):
    if name == "design":
        return [w for w in everything if w in DESIGN]
    if name == "rest":
        return [w for w in everything if w not in DESIGN]
    raise ValueError(f"unknown share {name!r}: design or rest")


def has_test(root, workspace):
    scripts = json.load(open(os.path.join(root, workspace, "package.json"))).get("scripts", {})
    return "test" in scripts


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    root = os.getcwd()
    failed = []
    for w in share(argv[1], workspaces(root)):
        if has_test(root, w) and subprocess.run(["npm", "test", "-w", w], cwd=root).returncode != 0:
            failed.append(w)
    if failed:
        print("tests failed in: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
