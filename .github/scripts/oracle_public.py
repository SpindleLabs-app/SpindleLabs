"""What of the private oracle's findings may go public (H3c, 2026-11-18).

The sessions' extrudes (fuzz.yml sessions-oracle) and the golden models'
STEP files (nightly.yml golden-step) are judged by the kernel's private
oracle on this public repo's runners. Its findings went into public
artifacts, this repo's public test-results branch and public issues in
full: each check's details name how it judges a body (copies moved home,
caps centred on their axes, what OpenCascade read), an oracle error's repr
and the oracle's own file name. The kernel's rule is that a description of
how the kernel works never goes public.

So the public file keeps only what file_issues.py turns into a kind: the
shape (the app's own session input) or the golden model's name, and each
check's name (the words before its first colon, anything in brackets cut,
and only plain words kept; anything else becomes "other check"). The full
text is sealed for the private kernel-results repo by the workflow.

  python3 oracle_public.py sessions FULL OUT   compare.py's disagreements file
  python3 oracle_public.py golden FULL OUT     golden_step.py's report

A FULL that is missing (the oracle crashed before writing it) gives an
"oracle crashed" line, which file_issues.py files as its own kind.
"""

import os
import re
import sys

PLAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ,'-]{0,79}$")
CRASHED = "oracle crashed before writing its findings (details in kernel-results)"


def check_name(line):
    """The public name of one check line: 'volume: fission 1.0, exact 2.0 (ctx)' -> 'volume'."""
    name = line.strip().split(":", 1)[0]
    name = re.sub(r"\s*\(.*$", "", name).strip()
    return name if PLAIN.match(name) else "other check"


def sessions(full):
    """compare.py's format: 'line N: {shape}', then one indented 'check: details' line each."""
    out = []
    for line in full.splitlines():
        if line.startswith("line "):
            out.append(line)
        elif line.startswith(" ") and line.strip():
            out.append("  " + check_name(line))
        elif line.strip():
            # Any other line (an OpenCascade-rounding note, a crash) is reduced to its kind, never copied.
            out.append(CRASHED if line.startswith("oracle crashed") else "other note")
    return "\n".join(out) + "\n"


def golden(full):
    """golden_step.py's report: a header line, then 'failure: <model>: <first> | also: <r>; also: <r>; ' per model."""
    lines = full.splitlines()
    m = re.search(r"(\d+) of (\d+) bodies failed", lines[0]) if lines else None
    head = f"Golden models' STEP files: {m.group(1)} of {m.group(2)} bodies failed" if m else "Golden models' STEP files: some bodies failed"
    out = [head]
    for line in lines[1:]:
        if not line.startswith("failure: "):
            continue
        model, _, rest = line[len("failure: "):].partition(": ")
        if not PLAIN.match(model):
            model = "a golden model"
        first, _, also = rest.partition(" | ")
        more = [check_name(a[len("also: "):]) for a in also.split("; ") if a.startswith("also: ") and a[len("also: "):].strip()]
        out.append(f"failure: {model}: {check_name(first)}" + (" | " + "".join(f"also: {n}; " for n in more) if more else ""))
    return "\n".join(out) + "\n"


def main(argv):
    if len(argv) != 4 or argv[1] not in ("sessions", "golden"):
        print("usage: oracle_public.py sessions|golden FULL OUT")
        return 2
    kind, full_path, out_path = argv[1:]
    if os.path.isfile(full_path):
        with open(full_path, errors="replace") as f:
            text = (sessions if kind == "sessions" else golden)(f.read())
    else:
        text = CRASHED + "\n" if kind == "sessions" else f"Golden models' STEP files: {CRASHED}\nfailure: the oracle: {CRASHED}\n"
    with open(out_path, "w") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
