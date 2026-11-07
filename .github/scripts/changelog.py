"""CHANGELOG.md's version numbers, given when a change reaches main.

Pull requests used to write their own "## 0.32.22 (date)" heading and the
same number in VERSION, so every merge made the next pull request in the
queue conflict on those two files, renumber and run CI again. Now a pull
request never picks a number. It adds one small file of its own,
changelog.d/<name>.md (a name no other pull request uses: its branch's last
part and a word or two, like ev4faw-version-bot.md), so no two pull requests
ever touch the same file:

    fix

    - Fixed: what was broken, how it was found and how it was checked.

The first line says what the change does to the version:
- `fix`: the bug-fix number goes up by one (0.32.21 -> 0.32.22);
- `step N`: the first piece of CAD step N: the version becomes 0.N.0, unless
  step N (or a later one) has already started, when it changes nothing;
- `none`: everything else (integration, AI, UI, tests, CI, docs); the entry
  is listed under the version main already has.
Then a blank line and the entry itself, one or more "- " lines in plain words.
Last, after a blank line, the public part, for the What's new list that the
app shows in Settings (WHATS_NEW.md): `public:` and the "- " lines a person
using SpindleLabs would notice, or `public: none` when they would notice
nothing (tests, CI, docs, refactors, the kernel's inner workings, anything
still behind a switch):

    fix

    - Fixed: what was broken, how it was found and how it was checked.

    public:
    - Arcs far from the origin no longer crash the app.

A public line says WHAT changed for the user, never HOW: no algorithm, no
private name, no tolerance, and a security fix is only "Security
improvements." A feature behind a switch gets its public line in the pull
request that switches it on. Every new fragment must have the public part
(`pr` checks it); fragments merged before it existed have none, and their
public lines were written into WHATS_NEW.md by hand.

The numbers are worked out from the order the fragments reached main: the
first-parent history of main, where every merged pull request is one merge
commit (the merge queue merges one pull request per commit). That order is
fixed once a pull request merges, so a fragment's number never changes, and
two pull requests in the queue can never get the same number or skip one.
`show` prints the whole changelog with every number as main has it now.
Now and then a pull request runs `fold`, which writes the numbered entries
into CHANGELOG.md and deletes their fragments, so the file on GitHub stays
current; folding never changes a number (test_changelog.py checks this).

Commands (ROOT defaults to the repository root):
  check [ROOT]      every fragment is well formed and CHANGELOG.md's
                    headings are in order (CI's kernel job, every run, through
                    test_changelog.py)
  pr BASE HEAD      what a pull request did to the changelog files, from git
                    (CI's kernel job on pull requests): it adds exactly one
                    fragment, or folds (writing just what fold writes); it
                    never edits a merged fragment or writes a version
                    heading itself
  show [ROOT]       the whole changelog, numbered (needs main's full history:
                    git fetch --unshallow origin main)
  version [ROOT]    just the current version
  fold [ROOT]       write the numbered entries into CHANGELOG.md, their
                    public lines into WHATS_NEW.md, and delete their fragments
  public [ROOT]     WHATS_NEW.md with every public line not folded in yet,
                    numbered (the app's build reads this; needs the history
                    like show)

The pure parts (parse_fragment, parse_changelog, number, render) are tested
by hand-worked cases and seeded random merge orders in test_changelog.py.
"""

import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from check_version import HEADING_RE, check_changelog  # noqa: E402

FRAGMENTS = "changelog.d"
WHATS_NEW = "WHATS_NEW.md"
PUBLIC_RE = re.compile(r"public:( none)?")
NAME_RE = re.compile(r"[a-z0-9][a-z0-9._-]*\.md")
BUMP_RE = re.compile(r"fix|none|step (0|[1-9]\d*)")

# The changelog is public; the geometry kernel is private. A public entry
# says WHAT changed for the user, never HOW the kernel does it. These are the
# high-signal tells of kernel internals leaking into an entry: a Rust source
# file (the public app is TypeScript, so a ".rs" name is always the kernel's),
# the private source trees, and the internal names a reader could search on.
# Kept tight so a plain user-facing entry never trips it.
LEAKS = [
    (re.compile(r"\b[\w./-]*\.rs\b"), "a kernel source file name"),
    (re.compile(r"\bprototypes/"), "a private source path"),
    (re.compile(r"\bkernel/(?:src|tests)\b"), "a private kernel source path"),
    (re.compile(r"\bfacts[ _-]?model\b", re.I), "an internal algorithm name"),
    (re.compile(r"\bfacts[ _-]table\b", re.I), "an internal data-structure name"),
    (re.compile(r"\bspade\b", re.I), "a third-party library the kernel is built on"),
]


# The What's new list is for people using the app, so on top of LEAKS a
# public line never talks about how SpindleLabs is built or tested, never
# names a tolerance, and never describes a security hole (at most "Security
# improvements."). Again kept tight, so a plain line about what the user
# sees never trips it ("a small test piece" is a print, not a test).
PUBLIC_LEAKS = [
    (re.compile(r"\b(?:unit|browser|property|regression|e2e|end-to-end|mutation|fuzz(?:ing)?|random|snapshot|golden) tests?\b", re.I),
     "about how SpindleLabs is tested"),
    (re.compile(r"\b(?:CI|refactor\w*|fuzz\w*|proptest|mutants?|stryker|nightly|test harness|oracle)\b", re.I),
     "about how SpindleLabs is built or tested"),
    (re.compile(r"\b(?:kernel|tolerances?|epsilon|ulps?)\b", re.I),
     "about the geometry engine's inner workings (say \"the geometry engine\" and what changed for the user)"),
    (re.compile(r"\b(?:vulnerab\w*|exploit\w*|injection|XSS|CSRF|CSP|Content[- ]Security[- ]Policy|bypass\w*|attacker|DoS|denial of service)\b", re.I),
     "a description of a security problem (write only \"Security improvements.\")"),
]


def public_leaks(where, text):
    """Problems where `text` (public What's new lines) is not for the public:
    every LEAKS problem plus PUBLIC_LEAKS."""
    return leaks(where, text) + public_only_leaks(where, text)


def public_only_leaks(where, text):
    """The PUBLIC_LEAKS problems alone (for text LEAKS already checked)."""
    found = []
    for pattern, what in PUBLIC_LEAKS:
        m = pattern.search(text)
        if m:
            found.append(f"{where}: {m.group(0)!r} is {what}; a What's new line says only what a person using "
                         "SpindleLabs notices, in plain words")
    return found


def leaks(where, text):
    """Problems where `text` (a fragment's content) describes kernel internals
    instead of what changed for the user, one sentence each."""
    found = []
    for pattern, what in LEAKS:
        m = pattern.search(text)
        if m:
            found.append(f"{where}: {m.group(0)!r} is {what}; the public changelog says what changed "
                         "for the user, never how the kernel works — drop the kernel-internal detail")
    return found


class Fragment:
    """One pull request's entry: its file name, bump ('fix', 'none' or
    ('step', N)), text, and the date it reached main."""

    def __init__(self, name, bump, text, date=None, public=None):
        self.name, self.bump, self.text, self.date = name, bump, text, date
        # The What's new lines: None when the fragment has no public part
        # (merged before it existed), "" for `public: none`, else "- " lines.
        self.public = public

    def __repr__(self):
        return f"Fragment({self.name!r}, {self.bump!r})"


def parse_fragment(name, content):
    """(Fragment, None) or (None, the problem in one sentence)."""
    where = f"{FRAGMENTS}/{name}"
    if not NAME_RE.fullmatch(name):
        return None, f"{where}: a fragment's name is lower-case letters, digits, '.', '_' or '-', ending .md"
    lines = content.split("\n")
    m = BUMP_RE.fullmatch(lines[0].rstrip())
    if not m:
        return None, f"{where}: the first line must be 'fix', 'step N' or 'none', not {lines[0]!r}"
    bump = ("step", int(m.group(1))) if m.group(1) is not None else m.group(0)
    if len(lines) < 3 or lines[1].strip():
        return None, f"{where}: a blank line must follow '{lines[0].rstrip()}', then the entry"
    body = lines[2:]
    marks = [i for i, line in enumerate(body) if PUBLIC_RE.fullmatch(line.rstrip())]
    public = None
    if len(marks) > 1:
        return None, f"{where} line {marks[1] + 3}: only one public part"
    if marks:
        i = marks[0]
        after = "\n".join(line.rstrip() for line in body[i + 1:]).strip("\n")
        if body[i].rstrip() == "public: none":
            if after:
                return None, f"{where} line {i + 4}: nothing follows 'public: none'"
            public = ""
        else:
            if not after.startswith("- "):
                return None, (f"{where} line {i + 3}: 'public:' is followed by the '- ' lines for What's new "
                              "(write 'public: none' when a person using the app would notice nothing)")
            public = after
        body = body[:i]
    text = "\n".join(line.rstrip() for line in body).strip("\n")
    if not text.startswith("- "):
        return None, f"{where}: the entry must start with '- ' (a list item, like the rest of CHANGELOG.md)"
    for n, line in enumerate(lines[2:], 3):
        if line.startswith("#"):
            return None, f"{where} line {n}: no headings in an entry; its version heading is written for it"
    return Fragment(name, bump, text, public=public), None


class Section:
    """One "## X.Y.Z (date)" heading and the text under it, kept exactly as
    read (raw) until an entry is added to it."""

    def __init__(self, version, date, raw):
        self.version, self.date, self.raw = version, date, raw


def parse_changelog(text):
    """(preamble, sections newest first). preamble + every section's raw is
    the text again, byte for byte."""
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.startswith("## ")]
    if not starts:
        return text, []
    preamble = "".join(lines[: starts[0]])
    sections = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(lines)
        m = HEADING_RE.fullmatch(lines[start].rstrip())
        if not m:
            raise ValueError(f"CHANGELOG.md line {start + 1}: a ## heading must be a version, like '## 0.24.0 (2026-10-18)'")
        version = tuple(int(g) for g in m.groups()[:3])
        sections.append(Section(version, m.group(4), "".join(lines[start:end])))
    return preamble, sections


def heading(version, date):
    return f"## {'.'.join(map(str, version))} ({date})"


def add_entry(section, text):
    """The section with `text` as its newest entry (at the top, under the
    heading), the older entries kept exactly."""
    head, _, rest = section.raw.partition("\n")
    body = rest.strip("\n")
    raw = f"{head}\n\n{text}\n" + (f"{body}\n\n" if body else "\n")
    return Section(section.version, section.date, raw)


def next_version(current, bump):
    """The version after `current` for this bump, or None when it doesn't
    change (none, or a step already started)."""
    big, step, fix = current
    if bump == "fix":
        return (big, step, fix + 1)
    if bump == "none":
        return None
    n = bump[1]
    return (big, n, 0) if n > step else None


def number(sections, fragments):
    """The sections (newest first) after the fragments, oldest merged first,
    each give or keep a version: a bump starts a new section dated the day
    it merged, anything else joins the newest section."""
    out = list(sections)
    for f in fragments:
        if not out:
            raise ValueError("CHANGELOG.md has no version heading to count on from")
        v = next_version(out[0].version, f.bump)
        if v is None:
            out[0] = add_entry(out[0], f.text)
        else:
            out.insert(0, Section(v, f.date, f"{heading(v, f.date)}\n\n{f.text}\n\n"))
    return out


def render(preamble, sections):
    text = preamble + "".join(s.raw for s in sections)
    return text.rstrip("\n") + "\n"


# --- What's new (WHATS_NEW.md) ---------------------------------------------


def versions_of(sections, fragments):
    """[(fragment, the version it is listed under)], the fragments oldest
    merged first, numbered exactly as `number` numbers them."""
    if not sections:
        raise ValueError("CHANGELOG.md has no version heading to count on from")
    current, out = sections[0].version, []
    for f in fragments:
        current = next_version(current, f.bump) or current
        out.append((f, current))
    return out


def fold_public(whats_new, assigned, dates):
    """WHATS_NEW.md's text with the public lines of `assigned` ([(fragment,
    version)], oldest merged first) written in: each under its version's
    heading, the newest at the top of it, a heading made (dated dates[version],
    the changelog's own date for it) where the version had none. A version
    with nothing public never gets a heading, so the numbers can jump."""
    preamble, sections = parse_changelog(whats_new)
    for f, version in assigned:
        if not f.public:
            continue
        at = next((i for i, s in enumerate(sections) if s.version == version), None)
        if at is not None:
            sections[at] = add_entry(sections[at], f.public)
            continue
        new = Section(version, dates[version], f"{heading(version, dates[version])}\n\n{f.public}\n\n")
        at = next((i for i, s in enumerate(sections) if s.version < version), len(sections))
        sections.insert(at, new)
    return render(preamble, sections)


def check_public(text, changelog_sections):
    """Every problem with WHATS_NEW.md, one sentence each: its headings are
    versions, newest first (gaps are fine: a version with nothing public is
    left out), each with at least one '- ' line and nothing else; a version
    CHANGELOG.md already holds has the same date there (newer ones are still
    fragments, numbered at merge time); and no line leaks."""
    problems = []
    lines = text.splitlines()
    if not lines or lines[0] != "# What's new":
        problems.append(f"{WHATS_NEW} line 1: the title is \"# What's new\"")
    dates = {s.version: s.date for s in changelog_sections}
    newest = changelog_sections[0].version if changelog_sections else None
    seen, last, in_section, entries = set(), None, False, 0
    for n, line in enumerate(lines + ["## end"], 1):
        if line.startswith("## "):
            if in_section and entries == 0:
                problems.append(f"{WHATS_NEW} line {n}: the version above has no '- ' line; leave a version out instead")
            if line == "## end" and n == len(lines) + 1:
                break
            m = HEADING_RE.fullmatch(line.rstrip())
            if not m:
                problems.append(f"{WHATS_NEW} line {n}: a ## heading must be a version, like '## 0.24.0 (2026-10-18)'")
                in_section, entries = True, 1
                continue
            version, date = tuple(int(g) for g in m.groups()[:3]), m.group(4)
            shown = ".".join(map(str, version))
            if version in seen:
                problems.append(f"{WHATS_NEW} line {n}: {shown} is listed twice")
            elif last is not None and version >= last:
                problems.append(f"{WHATS_NEW} line {n}: {shown} must come below {'.'.join(map(str, last))} (newest first)")
            if version in dates and dates[version] != date:
                problems.append(f"{WHATS_NEW} line {n}: CHANGELOG.md dates {shown} {dates[version]}, not {date}")
            elif version not in dates and newest is not None and version <= newest:
                problems.append(f"{WHATS_NEW} line {n}: {shown} is not a version in CHANGELOG.md")
            seen.add(version)
            last, in_section, entries = version, True, 0
        elif in_section and line.strip():
            if line.startswith("- "):
                entries += 1
            elif not (line.startswith("  ") and entries):
                problems.append(f"{WHATS_NEW} line {n}: under a version, only '- ' lines (one per change)")
        elif not in_section and line.startswith("- "):
            problems.append(f"{WHATS_NEW} line {n}: an entry above the first version heading")
    if not seen:
        problems.append(f"{WHATS_NEW} has no version heading")
    return problems + public_leaks(WHATS_NEW, text)


# --- Files and git ---------------------------------------------------------


def root_dir(argv, i):
    return argv[i] if len(argv) > i else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def git(root, *args):
    env = dict(os.environ, TZ="UTC")
    return subprocess.run(["git", "-C", root, *args], check=True, capture_output=True, text=True, env=env).stdout


def read_fragments(root):
    """(fragments by name, problems)."""
    folder = os.path.join(root, FRAGMENTS)
    found, problems = {}, []
    names = sorted(os.listdir(folder)) if os.path.isdir(folder) else []
    for name in names:
        if name == "README.txt":
            continue
        f, problem = parse_fragment(name, read(os.path.join(folder, name)))
        if problem:
            problems.append(problem)
        else:
            found[name] = f
    return found, problems


def merge_order(root):
    """{fragment name: (position, date)} from main's first-parent history:
    the commit that added each one (its latest addition), oldest first."""
    if git(root, "rev-parse", "--is-shallow-repository").strip() == "true":
        raise RuntimeError("this clone is shallow, so the merge order can't be read: git fetch --unshallow origin")
    out = git(root, "log", "--first-parent", "--diff-merges=first-parent", "--diff-filter=A", "--reverse",
              "--name-only", "--date=format-local:%Y-%m-%d", "--format=%x01%cd", "--", FRAGMENTS + "/")
    order, position, date = {}, 0, None
    for line in out.splitlines():
        if line.startswith("\x01"):
            position, date = position + 1, line[1:]
        elif line.startswith(FRAGMENTS + "/"):
            order[line[len(FRAGMENTS) + 1:]] = (position, date)
    return order


def ordered(root, fragments, today):
    """(the fragments oldest merged first, the names of those not committed
    yet). One not committed yet comes last, dated today; a tie (one commit
    adding two) goes by name."""
    order = merge_order(root)
    late = (float("inf"), today)
    for f in fragments.values():
        f.date = order.get(f.name, late)[1]
    pending = sorted(n for n in fragments if n not in order)
    return sorted(fragments.values(), key=lambda f: (order.get(f.name, late)[0], f.name)), pending


def numbered(root):
    import datetime

    fragments, problems = read_fragments(root)
    if problems:
        raise ValueError("\n".join(problems))
    preamble, sections = parse_changelog(read(os.path.join(root, "CHANGELOG.md")))
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    merged, pending = ordered(root, fragments, today)
    return preamble, number(sections, merged), fragments, pending, versions_of(sections, merged)


def public_text(root, sections, assigned):
    """WHATS_NEW.md with the public lines of `assigned` written in."""
    return fold_public(read(os.path.join(root, WHATS_NEW)), assigned, {s.version: s.date for s in sections})


def check(root):
    """Every problem with the files as they are, one sentence each."""
    changelog = read(os.path.join(root, "CHANGELOG.md"))
    problems = check_changelog(changelog)
    fragments, bad = read_fragments(root)
    problems += bad
    for f in fragments.values():
        problems += leaks(f"{FRAGMENTS}/{f.name}", f.text)
        if f.public:
            problems += public_leaks(f"{FRAGMENTS}/{f.name} (public)", f.public)
    whats_new = os.path.join(root, WHATS_NEW)
    if not os.path.exists(whats_new):
        problems.append(f"{WHATS_NEW} is missing: it is the public What's new list the app shows in Settings")
    else:
        try:
            problems += check_public(read(whats_new), parse_changelog(changelog)[1])
        except ValueError as e:
            problems.append(str(e))
    if os.path.exists(os.path.join(root, "VERSION")):
        problems.append("VERSION is gone: the version is worked out from CHANGELOG.md and changelog.d/ "
                        "(.github/scripts/changelog.py version)")
    if not problems:
        # Numbered in any order, the result must pass the heading check.
        for f in fragments.values():
            f.date = "2000-01-01"
        preamble, sections = parse_changelog(changelog)
        problems += check_changelog(render(preamble, number(sections, [fragments[n] for n in sorted(fragments)])))
    return problems


def fold_problem(base_changelog, head_changelog, folded):
    """None when head_changelog is what fold writes from base_changelog with
    the fragments `folded`, else the problem. The merge order isn't in a
    pull request's shallow clone, so it is read from where fold put each
    entry (the oldest lowest), and each new heading's date from the heading
    above the entry; everything else must match fold byte for byte."""
    preamble, sections = parse_changelog(base_changelog)
    head_sections = parse_changelog(head_changelog)[1]
    for f in folded:
        f.date = next((s.date for s in head_sections if f.text in s.raw), "0000-00-00")
    try:
        want = number(sections, sorted(folded, key=lambda f: -head_changelog.find(f.text)))
    except ValueError as e:
        return str(e)
    if render(preamble, want) == head_changelog:
        return None
    for got, exp in zip(head_sections, want):
        if (got.version, got.date) != (exp.version, exp.date):
            return (f"CHANGELOG.md isn't what fold writes from main's: it has the heading {heading(got.version, got.date)[3:]} "
                    f"where fold writes {heading(exp.version, exp.date)[3:]}; run changelog.py fold on a fresh main")
    return "CHANGELOG.md isn't what fold writes from main's (an entry or a heading changed by hand); run changelog.py fold on a fresh main"


def whats_new_problems(status, deleted, folded, base_file, head_file, head_changelog):
    """What a pull request did to WHATS_NEW.md: a fold writes exactly what
    fold writes (each folded public line under the version CHANGELOG.md now
    gives its entry); any other pull request may correct its lines but never
    adds a version heading (versions come from merge order) or deletes it."""
    s = status.get(WHATS_NEW)
    if s == "D":
        return [f"{WHATS_NEW} is the public What's new list the app shows; don't delete it"]
    if deleted:
        public = [f for f in folded if f.public]
        if s is None:
            return [f"a fold writes the folded public lines into {WHATS_NEW} too; run changelog.py fold"] if public else []
        if head_changelog is None:
            return []
        head_sections = parse_changelog(head_changelog)[1]
        assigned = []
        for f in sorted(folded, key=lambda f: -head_changelog.find(f.text)):
            section = next((x for x in head_sections if f.text in x.raw), None)
            if section is None:
                return []  # already reported: its entry isn't in CHANGELOG.md
            assigned.append((f, section.version))
        try:
            want = fold_public(base_file(WHATS_NEW), assigned, {x.version: x.date for x in head_sections})
        except (ValueError, subprocess.CalledProcessError) as e:
            return [f"{WHATS_NEW} can't be folded into: {e}"]
        if want != head_file(WHATS_NEW):
            return [f"{WHATS_NEW} isn't what fold writes from main's (a public line or heading changed by hand); "
                    "run changelog.py fold on a fresh main"]
        return []
    if s == "M":
        old = {line for line in base_file(WHATS_NEW).splitlines() if line.startswith("## ")}
        new = [line for line in head_file(WHATS_NEW).splitlines() if line.startswith("## ") and line not in old]
        if new:
            return [f"{WHATS_NEW} gains the heading {new[0][3:]}: don't write version headings; put the line in "
                    f"this pull request's fragment, after 'public:' (the number is given at merge time)"]
    return []


def check_pr(diff, base_file, head_file):
    """What a pull request did to the changelog files. diff: (status, path)
    pairs from git diff --name-status --no-renames BASE HEAD; base_file(path)
    and head_file(path): a file's text on the base and on the head."""
    problems = []
    status = dict((path, s) for s, path in diff)
    fragment = [p for p in status if p.startswith(FRAGMENTS + "/") and p.endswith(".md")]
    added = [p for p in fragment if status[p] == "A"]
    deleted = [p for p in fragment if status[p] == "D"]
    for p in added:
        problems += leaks(p, head_file(p))
        f, _ = parse_fragment(p.split("/", 1)[1], head_file(p))
        if f is not None and f.public is None:
            problems.append(f"{p}: end it with its public part for What's new, after a blank line: 'public:' and "
                            "the '- ' lines a person using SpindleLabs would notice, or 'public: none' when they "
                            "would notice nothing (see changelog.d/README.txt)")
        elif f is not None and f.public:
            problems += public_only_leaks(f"{p} (public)", f.public)
    for p in fragment:
        if status[p] not in ("A", "D"):
            problems.append(f"{p} is already on main, so its entry is fixed; add a new fragment instead of changing it")
    if status.get("VERSION") == "A":
        problems.append("don't add VERSION back: the version is worked out at merge time (.github/scripts/changelog.py)")
    head_changelog = head_file("CHANGELOG.md") if "CHANGELOG.md" in status else None
    if head_changelog is not None and not deleted:
        base_versions = {s.version for s in parse_changelog(base_file("CHANGELOG.md"))[1]}
        new = [s for s in parse_changelog(head_changelog)[1] if s.version not in base_versions]
        if new:
            problems.append(f"CHANGELOG.md gains the heading {heading(new[0].version, new[0].date)[3:]}: don't write "
                            f"version headings, add {FRAGMENTS}/<name>.md (the numbers are given at merge time)")
    folded = []
    for p in deleted:
        if head_changelog is None:
            problems.append(f"{p} is deleted but CHANGELOG.md isn't changed: only a fold deletes fragments")
            continue
        f, _ = parse_fragment(p.split("/", 1)[1], base_file(p))
        if f is not None and f.text not in head_changelog:
            problems.append(f"{p} is deleted but its entry isn't in CHANGELOG.md: only a fold deletes fragments")
        elif f is not None:
            folded.append(f)
    # A fold writes headings, so it must write exactly fold's.
    if deleted and not problems and head_changelog is not None:
        problem = fold_problem(base_file("CHANGELOG.md"), head_changelog, folded)
        if problem:
            problems.append(problem)
    problems += whats_new_problems(status, deleted, folded, base_file, head_file, head_changelog)
    if deleted and added:
        problems.append("a fold only folds: add this pull request's own fragment in a pull request of its own")
    elif not deleted and len(added) != 1:
        problems.append(f"add exactly one {FRAGMENTS}/<name>.md with this pull request's entry (first line 'fix', "
                        f"'step N' or 'none'; see .github/scripts/changelog.py), not {len(added)}")
    return problems


def main(argv):
    command = argv[1] if len(argv) > 1 else "check"
    try:
        if command == "check":
            problems = check(root_dir(argv, 2))
            for p in problems:
                print(p)
            if not problems:
                print("CHANGELOG.md and changelog.d/ are in order")
            return 1 if problems else 0
        if command == "pr":
            base, head = argv[2], argv[3]
            root = root_dir(argv, 4)
            out = git(root, "diff", "--name-status", "--no-renames", base, head)
            diff = [tuple(line.split("\t", 1)) for line in out.splitlines() if line]
            problems = check_pr(diff, lambda p: git(root, "show", f"{base}:{p}"), lambda p: git(root, "show", f"{head}:{p}"))
            for p in problems:
                print(p)
            if not problems:
                print("this pull request's changelog files are in order")
            return 1 if problems else 0
        if command in ("show", "version", "fold", "public"):
            root = root_dir(argv, 2)
            preamble, sections, fragments, pending, assigned = numbered(root)
            if command == "fold" and pending:
                print(f"not committed, so not merged yet: {', '.join(pending)}; fold from a clean checkout of main")
                return 1
            if command == "show":
                sys.stdout.write(render(preamble, sections))
            elif command == "version":
                print(".".join(map(str, sections[0].version)))
            elif command == "public":
                sys.stdout.write(public_text(root, sections, assigned))
            else:
                whats_new = public_text(root, sections, assigned)
                with open(os.path.join(root, "CHANGELOG.md"), "w", encoding="utf-8") as f:
                    f.write(render(preamble, sections))
                with open(os.path.join(root, WHATS_NEW), "w", encoding="utf-8") as f:
                    f.write(whats_new)
                for name in fragments:
                    os.remove(os.path.join(root, FRAGMENTS, name))
                print(f"folded {len(fragments)} fragment(s); the version is {'.'.join(map(str, sections[0].version))}")
            return 0
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as e:
        print(getattr(e, "stderr", None) or e)
        return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
