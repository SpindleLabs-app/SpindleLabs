"""The reference models' fast arithmetic stays installed: python3 -m unittest discover -s .github/scripts

mpmath, which the kernel's reference models work in, uses gmpy2 by itself
when it is installed and its own pure-Python arithmetic when not: the same
answers either way, but without gmpy2 the checks that run those models take
up to a third longer (2026-11-11), and nothing else would notice it gone."""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def pins(text):
    """The package names a requirements file pins, each to a version and a hash."""
    return {m.group(1).lower() for m in re.finditer(r"^([A-Za-z0-9_.-]+)==\S+ --hash=sha256:[0-9a-f]{64}$", text, re.M)}


class OracleSpeed(unittest.TestCase):
    def test_gmpy2_is_pinned_wherever_mpmath_is(self):
        with open(os.path.join(HERE, "oracle-requirements.txt")) as f:
            got = pins(f.read())
        self.assertIn("mpmath", got)
        self.assertIn("gmpy2", got)

    def test_a_file_without_it_is_told_apart(self):
        # The planted break: the same file with gmpy2's line taken out.
        with open(os.path.join(HERE, "oracle-requirements.txt")) as f:
            text = "\n".join(l for l in f.read().splitlines() if not l.startswith("gmpy2=="))
        self.assertNotIn("gmpy2", pins(text))
        self.assertIn("mpmath", pins(text))


if __name__ == "__main__":
    unittest.main()
