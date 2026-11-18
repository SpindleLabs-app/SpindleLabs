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
    def run_script(self, ok_host, args=(), mirrors=MIRRORS):
        with tempfile.TemporaryDirectory() as d:
            bins, apt = os.path.join(d, "bin"), os.path.join(d, "apt")
            os.makedirs(bins)
            os.makedirs(os.path.join(apt, "sources.list.d"))
            with open(os.path.join(apt, "apt-mirrors.txt"), "w") as f:
                f.write(mirrors)
            for name, body in (("sudo", 'exec "$@"\n'), ("probe", 'test "$1" = "$PROBE_OK"\n')):
                path = os.path.join(bins, name)
                with open(path, "w") as f:
                    f.write("#!/usr/bin/env bash\n" + body)
                os.chmod(path, 0o755)
            env = {**os.environ, "PATH": bins + os.pathsep + os.environ["PATH"], "APT_DIR": apt,
                   "MIRROR_PROBE": "probe", "PROBE_OK": ok_host}
            p = subprocess.run([SCRIPT, *args], env=env, capture_output=True, text=True, timeout=60)
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

    # 2026-11-18: kernel #282's apt step stalled 48 minutes on the image's EC2 mirror, which resolves, so the
    # resolve check above changed nothing and all four tries stayed on it.
    def test_switch_2_moves_any_regional_mirror_to_archive_ubuntu_com(self):
        ec2 = MIRRORS.replace("azure.archive", "us-east-2.ec2.archive")
        code, err, mirrors = self.run_script("archive.ubuntu.com", ("switch", "2"), mirrors=ec2)
        self.assertEqual(code, 0, err)
        self.assertEqual(mirrors, "http://archive.ubuntu.com/ubuntu/\tpriority:1\nhttp://security.ubuntu.com/ubuntu/\tpriority:3\n")

    def test_switch_3_and_4_move_to_the_fallback_when_it_resolves(self):
        for n in ("3", "4"):
            code, err, mirrors = self.run_script("mirrors.edge.kernel.org", ("switch", n))
            self.assertEqual(code, 0, err)
            self.assertEqual(mirrors, "http://mirrors.edge.kernel.org/ubuntu/\tpriority:1\n")

    def test_switch_3_leaves_apt_alone_when_the_fallback_does_not_resolve(self):
        code, err, mirrors = self.run_script("archive.ubuntu.com", ("switch", "3"))
        self.assertEqual((code, mirrors), (0, MIRRORS))

    def test_the_kernel_parts_apt_loop_switches_mirror_before_each_later_try(self):
        with open(os.path.join(os.path.dirname(HERE), "workflows", "kernel-ci.yml")) as f:
            text = f.read()
        loop = text[text.index("for try in 1 2 3 4; do"):]
        loop = loop[:loop.index("done")]
        self.assertIn(".github/scripts/apt-mirror.sh switch $try", loop)
        self.assertLess(loop.index("apt-mirror.sh switch"), loop.index("apt-get"))


if __name__ == "__main__":
    unittest.main()
