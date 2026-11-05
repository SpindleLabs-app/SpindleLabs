"""One rolling issue listing the states the kernel's random testing never reached.

The kernel's nightly rounds count how often each interesting state of its
code was reached (the endless jobs' markers.txt: "name count" per line, and
" rare" after a state not expected every night). collect-results.sh adds the
jobs' files up; this script, for a night on main only, keeps one issue
(labelled `state-coverage`, found again by a marker in its body) listing
every state that is not rare and was reached 0 times:
- a list and no issue: a new one;
- the list changed: the body is rewritten and a comment says what changed
  (an unchanged list only has its body's run line updated, so no one is
  notified every night);
- a closed issue whose states are missed again is reopened;
- an empty list closes the open issue with a comment.
Branch runs are not judged (a short or half-done branch may miss a state).
Never reached is not a failure kind: it never counts against the clean
streak (new-failures.csv), as nothing went wrong; it says the testing does
not reach somewhere.

`never_reached` and `plan` are pure (tested in test_coverage_issue.py); `run`
does the `gh` calls (without GH_TOKEN it prints what it would do).

Usage: coverage_issue.py <totals file>; needs RUN_URL, COMMIT, BRANCH.
"""

import json
import os
import re
import subprocess
import sys

LABEL = "state-coverage"
MARK = "<!-- state-coverage -->"
LIST_RE = re.compile(r"^- `([^`]+)`$", re.M)
TITLE = "State coverage: parts of the kernel the random testing never reached"


def parse(text):
    """[(name, count, rare)] in the file's order; malformed lines are skipped."""
    out = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            out.append((parts[0], int(parts[1]), len(parts) > 2 and parts[2] == "rare"))
    return out


def never_reached(marks):
    """(names of the not-rare marks counted 0, names of the rare ones counted 0)."""
    return [n for n, c, r in marks if c == 0 and not r], [n for n, c, r in marks if c == 0 and r]


def body(missed, total, run_url, commit, branch):
    lines = [MARK, f"The nightly random testing on {branch} (last run {run_url}, commit {commit}) never reached "
             f"{len(missed)} of the {total} states it counts:", ""]
    lines += [f"- `{n}`" for n in missed]
    lines += ["", "Each is a case the kernel handles that no random round produced. Make the generators reach it "
              "(or, if it truly cannot happen, remove its count). markers/latest.txt on the test-results branch "
              "has every count."]
    return "\n".join(lines) + "\n"


def plan(missed, issue):
    """What to do: [("create" | "edit" | "comment" | "reopen" | "close", text)].
    issue is {number, state, body} or None."""
    if issue is None:
        return [("create", "")] if missed else []
    before = LIST_RE.findall(issue["body"] or "")
    if not missed:
        return [("comment", "Every state was reached this night."), ("close", "")] if issue["state"] == "OPEN" else []
    acts = []
    if issue["state"] != "OPEN":
        acts.append(("reopen", ""))
    acts.append(("edit", ""))
    if set(missed) != set(before) or issue["state"] != "OPEN":
        gone = sorted(set(before) - set(missed))
        new = sorted(set(missed) - set(before))
        words = []
        if new:
            words.append("No longer reached: " + ", ".join(f"`{n}`" for n in new) + ".")
        if gone:
            words.append("Reached now: " + ", ".join(f"`{n}`" for n in gone) + ".")
        acts.append(("comment", " ".join(words) or "Missed again."))
    return acts


def gh(*args, stdin=None):
    return subprocess.run(["gh", *args], input=stdin, capture_output=True, text=True, check=True).stdout


def run(path, log=print):
    branch = os.environ["BRANCH"]
    if branch != "main":
        log(f"State coverage not judged on {branch} (main only).")
        return []
    with open(path) as f:
        marks = parse(f.read())
    missed, rare = never_reached(marks)
    live = bool(os.environ.get("GH_TOKEN"))
    issue = None
    if live:
        gh("label", "create", LABEL, "--force", "--color", "fbca04",
           "--description", "States the nightly random testing never reached; one rolling issue")
        found = [i for i in json.loads(gh("issue", "list", "--label", LABEL, "--state", "all", "--limit", "100",
                                          "--json", "number,state,body")) if MARK in (i["body"] or "")]
        issue = min(found, key=lambda i: i["number"]) if found else None
    text = body(missed, len(marks), os.environ["RUN_URL"], os.environ["COMMIT"], branch)
    acts = plan(missed, issue)
    for act, words in acts:
        log(f"coverage {act} {len(missed)} never reached{': ' + words if words else ''}")
        if not live:
            continue
        n = str(issue["number"]) if issue else ""
        if act == "create":
            gh("issue", "create", "--title", TITLE, "--label", LABEL, "--body-file", "-", stdin=text)
        elif act == "edit":
            gh("issue", "edit", n, "--body-file", "-", stdin=text)
        elif act == "comment":
            gh("issue", "comment", n, "--body", words)
        elif act == "reopen":
            gh("issue", "reopen", n)
        elif act == "close":
            gh("issue", "close", n, "--reason", "completed")
    if rare:
        log(f"Rare states not reached (not filed): {', '.join(rare)}")
    return acts


if __name__ == "__main__":
    try:
        run(sys.argv[1])
    except subprocess.CalledProcessError as e:
        print(f"Could not update the state coverage issue: {(e.stderr or '').strip()}", file=sys.stderr)
        sys.exit(2)
