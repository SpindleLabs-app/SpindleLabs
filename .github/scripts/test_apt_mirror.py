"""Tests for apt-mirror.sh: python3 -m unittest discover -s .github/scripts
The script runs against a temp copy of the apt files, a fake `sudo` and a fake probe."""

import os
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "apt-mirror.sh")
MIRRORS = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttp://security.ubuntu.com/ubuntu/\tpriority:3\n"


class AptMirror(unittest.TestCase):
    def run_script(self, ok_host):
        with tempfile.TemporaryDirectory() as d:
            bins, apt = os.path.join(d, "bin"), os.path.join(d, "apt")
            os.makedirs(bins)
            os.makedirs(os.path.join(apt, "sources.list.d"))
            with open(os.path.join(apt, "apt-mirrors.txt"), "w") as f:
                f.write(MIRRORS)
            for name, body in (("sudo", 'exec "$@"\n'), ("probe", 'test "$1" = "$PROBE_OK"\n')):
                path = os.path.join(bins, name)
                with open(path, "w") as f:
                    f.write("#!/usr/bin/env bash\n" + body)
                os.chmod(path, 0o755)
            env = {**os.environ, "PATH": bins + os.pathsep + os.environ["PATH"], "APT_DIR": apt,
                   "MIRROR_PROBE": "probe", "PROBE_OK": ok_host}
            p = subprocess.run([SCRIPT], env=env, capture_output=True, text=True, timeout=60)
            with open(os.path.join(apt, "apt-mirrors.txt")) as f:
                return p.returncode, p.stderr, f.read()

    def test_with_an_ubuntu_host_resolving_nothing_changes(self):
        code, err, mirrors = self.run_script("archive.ubuntu.com")
        self.assertEqual((code, mirrors), (0, MIRRORS))

    def test_with_only_the_fallback_resolving_apt_is_pointed_at_it(self):
        code, err, mirrors = self.run_script("mirrors.edge.kernel.org")
        self.assertEqual(code, 0, err)
        self.assertEqual(mirrors, "http://mirrors.edge.kernel.org/ubuntu/\tpriority:1\n")

    def test_with_nothing_resolving_it_fails_at_once(self):
        code, err, mirrors = self.run_script("none.example")
        self.assertEqual(code, 1)
        self.assertEqual(mirrors, MIRRORS)
        self.assertIn("cannot be installed", err)


if __name__ == "__main__":
    unittest.main()
