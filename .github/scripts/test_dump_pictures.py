"""dump_pictures.sh: finds every failure's 3D page and photographs it with
the runner's headless Chrome, best effort. The picture test needs a Chrome
(CHROME, google-chrome or chromium on PATH) and is skipped without one."""
import os
import shutil
import struct
import subprocess
import tempfile
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "dump_pictures.sh")
# A page that fills the window red as it loads, as the kernel's dump pages draw on a canvas.
PAGE = ("<!doctype html><body style=margin:0><canvas id=c width=1200 height=800></canvas><script>"
        "const g = document.getElementById('c').getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 1200, 800);"
        "</script>")


def chrome():
    return os.environ.get("CHROME") or shutil.which("google-chrome") or shutil.which("chromium")


def first_pixel(png):
    """(width, height, (r, g, b)) of a PNG's top-left pixel, read by hand:
    the IHDR size, then the first scanline of the inflated IDAT data (filter
    byte, then RGB or RGBA; a top-left pixel's filter can only add zeros)."""
    with open(png, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    at, idat, size, depth = 8, b"", None, None
    while at < len(data):
        n, kind = struct.unpack(">I4s", data[at:at + 8])
        body = data[at + 8:at + 8 + n]
        if kind == b"IHDR":
            size, depth = struct.unpack(">II", body[:8]), body[9]
        elif kind == b"IDAT":
            idat += body
        at += 12 + n
    raw = zlib.decompress(idat)
    assert depth in (2, 6), depth
    return size[0], size[1], tuple(raw[1:4])


class DumpPictures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        t = self.tmp.name
        # Two failure folders as collect receives them, and a page outside failure-dumps that is no dump.
        for d in ["fuzz-kernel-boolean/seed-1/failure-dumps/input-1-crash-a", "endless-a-0/seed-9/failure-dumps/seed9-x", "endless-a-0/seed-9/other"]:
            os.makedirs(os.path.join(t, d))
            with open(os.path.join(t, d, "index.html"), "w") as f:
                f.write(PAGE)

    def run_it(self, **env):
        return subprocess.run(["bash", SCRIPT, self.tmp.name], capture_output=True, text=True, env=dict(os.environ, **env))

    def pictures(self):
        return sorted(os.path.relpath(r, self.tmp.name) for r, _, fs in os.walk(self.tmp.name) if "picture.png" in fs)

    def test_no_browser_is_no_picture_and_no_failure(self):
        out = self.run_it(CHROME=os.path.join(self.tmp.name, "no-such-chrome"))
        self.assertEqual((out.returncode, out.stdout, out.stderr), (0, "pictures 0 of 2\n", ""))
        self.assertEqual(self.pictures(), [])

    def test_a_browser_that_writes_no_picture_leaves_none(self):
        # A "browser" that writes junk where the picture goes: not a PNG, so removed and not counted.
        fake = os.path.join(self.tmp.name, "fake-chrome")
        with open(fake, "w") as f:
            f.write('#!/bin/sh\nfor a in "$@"; do case $a in --screenshot=*) echo junk >"${a#--screenshot=}";; esac; done\n')
        os.chmod(fake, 0o755)
        out = self.run_it(CHROME=fake)
        self.assertEqual((out.returncode, out.stdout), (0, "pictures 0 of 2\n"))
        self.assertEqual(self.pictures(), [])

    def test_at_most_max_pictures(self):
        fake = os.path.join(self.tmp.name, "fake-chrome")
        with open(fake, "w") as f:
            f.write('#!/bin/sh\nfor a in "$@"; do case $a in --screenshot=*) printf "\\211PNG" >"${a#--screenshot=}";; esac; done\n')
        os.chmod(fake, 0o755)
        out = self.run_it(CHROME=fake, MAX_PICTURES="1")
        self.assertEqual(out.stdout, "pictures 1 of 2\n")
        # Sorted by path: endless-a-0 comes before fuzz-kernel-boolean.
        self.assertEqual(self.pictures(), ["endless-a-0/seed-9/failure-dumps/seed9-x"])

    def test_a_broken_browser_is_given_up_on(self):
        # A browser that never writes a picture: after two pages in a row it is not tried again, so a night
        # of hundreds of failures doesn't spend the collect job's 15 minutes on a browser that can't start.
        for n in range(3, 6):
            d = os.path.join(self.tmp.name, f"endless-b-{n}/seed-{n}/failure-dumps/d")
            os.makedirs(d)
            with open(os.path.join(d, "index.html"), "w") as f:
                f.write(PAGE)
        tries = os.path.join(self.tmp.name, "tries")
        fake = os.path.join(self.tmp.name, "fake-chrome")
        with open(fake, "w") as f:
            f.write(f"#!/bin/sh\necho x >>{tries}\n")
        os.chmod(fake, 0o755)
        out = self.run_it(CHROME=fake)
        self.assertEqual(out.stdout, "pictures 0 of 5\n")
        with open(tries) as f:
            self.assertEqual(len(f.read().split()), 2)
        # And no new picture once TOTAL_SECONDS are spent (0: none at all).
        os.remove(tries)
        out = self.run_it(CHROME=fake, TOTAL_SECONDS="0")
        self.assertEqual((out.stdout, os.path.exists(tries)), ("pictures 0 of 5\n", False))

    def test_a_picture_shows_the_page(self):
        if not chrome():
            self.skipTest("needs a Chrome")
        out = self.run_it(CHROME=chrome())
        self.assertEqual((out.returncode, out.stdout), (0, "pictures 2 of 2\n"), out.stderr)
        self.assertEqual(self.pictures(), ["endless-a-0/seed-9/failure-dumps/seed9-x", "fuzz-kernel-boolean/seed-1/failure-dumps/input-1-crash-a"])
        # By hand: the page fills its 1200 x 800 window red, so the picture is 1200 x 800 and its corner is red.
        png = os.path.join(self.tmp.name, "fuzz-kernel-boolean/seed-1/failure-dumps/input-1-crash-a/picture.png")
        self.assertEqual(first_pixel(png), (1200, 800, (255, 0, 0)))


if __name__ == "__main__":
    unittest.main()
