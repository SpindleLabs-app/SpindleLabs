"""The site's security.txt is valid and gets published: python3 -m unittest discover -s .github/scripts

security.txt (RFC 9116) tells someone who finds a security problem how to
report it privately. It lives at apps/fission/public/.well-known/security.txt,
which Vite copies into the build. RFC 9116 requires a Contact line and exactly
one Expires line, so a stale file is never trusted; this test goes red 30 days
before Expires so the date is moved on (keep it under a year ahead) while the
old one still holds. Pages' upload action leaves out hidden folders like
.well-known unless told to include them, so that setting is checked too."""

import datetime
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SECURITY_TXT = os.path.join(ROOT, "apps", "fission", "public", ".well-known", "security.txt")
PAGES_YML = os.path.join(ROOT, ".github", "workflows", "pages.yml")
RENEW_DAYS = 30
MAX_DAYS = 366


def problems(text, now):
    """Every way text breaks the rules above, as plain sentences ([] when it is fine)."""
    fields = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, sep, value = line.partition(":")
        if not sep:
            return [f"not a field: {line!r}"]
        fields.setdefault(name.strip().lower(), []).append(value.strip())
    found = []
    contacts = fields.get("contact", [])
    if not contacts:
        found.append("no Contact line")
    for c in contacts:
        if not re.fullmatch(r"(mailto:[^@\s]+@[^@\s]+\.[a-z]+|https://\S+)", c):
            found.append(f"Contact is not a mailto: or https: address: {c!r}")
    expires = fields.get("expires", [])
    if len(expires) != 1:
        found.append(f"needs exactly one Expires line, has {len(expires)}")
    else:
        try:
            when = datetime.datetime.strptime(expires[0], "%Y-%m-%dT%H:%M:%S.%fZ").replace(
                tzinfo=datetime.timezone.utc
            )
        except ValueError:
            found.append(f"Expires is not a UTC time like 2027-10-31T16:00:00.000Z: {expires[0]!r}")
        else:
            left = (when - now).total_seconds() / 86400
            if left < RENEW_DAYS:
                found.append(f"Expires is {left:.1f} days away: move it on (under a year ahead)")
            elif left > MAX_DAYS:
                found.append(f"Expires is {left:.1f} days away: RFC 9116 asks for under a year")
    canon = fields.get("canonical", [])
    if canon != ["https://spindlelabs.app/.well-known/security.txt"]:
        found.append(f"Canonical must be the live address, got {canon!r}")
    return found


NOW = datetime.datetime(2026, 11, 4, tzinfo=datetime.timezone.utc)
GOOD = """# comment
Contact: mailto:ben@spindlelabs.app
Expires: 2027-10-31T16:00:00.000Z
Canonical: https://spindlelabs.app/.well-known/security.txt
"""


class SecurityTxt(unittest.TestCase):
    def test_the_real_file_is_valid_today(self):
        with open(SECURITY_TXT, encoding="utf-8") as f:
            text = f.read()
        now = datetime.datetime.now(datetime.timezone.utc)
        self.assertEqual(problems(text, now), [])

    def test_pages_uploads_hidden_folders(self):
        with open(PAGES_YML, encoding="utf-8") as f:
            self.assertRegex(f.read(), r"(?m)^\s+include-hidden-files:\s*true\s*$")

    def test_good_file_passes(self):
        self.assertEqual(problems(GOOD, NOW), [])

    def test_days_left_worked_by_hand(self):
        # 4 Nov 2026 00:00 UTC to 31 Oct 2027 16:00 UTC: 4 Nov 2026 to 4 Nov 2027
        # is 365 days (no 29 Feb between), less 4 days back to 31 Oct = 361 days,
        # less 8 hours (16:00 not 24:00) = 360.667 days, inside 30..366.
        self.assertEqual(problems(GOOD, NOW), [])
        # 30 days before 31 Oct 2027 16:00 is 1 Oct 2027 16:00. 0.9 of the margin
        # (27 days left, 4 Oct) still leaves under 30: red. 1.1 of it (33 days
        # left, 28 Sep) is green.
        red = datetime.datetime(2027, 10, 4, 16, tzinfo=datetime.timezone.utc)
        green = datetime.datetime(2027, 9, 28, 16, tzinfo=datetime.timezone.utc)
        self.assertEqual(problems(GOOD, red), ["Expires is 27.0 days away: move it on (under a year ahead)"])
        self.assertEqual(problems(GOOD, green), [])

    def test_too_far_ahead_fails(self):
        early = datetime.datetime(2026, 10, 1, tzinfo=datetime.timezone.utc)
        self.assertIn("RFC 9116 asks for under a year", problems(GOOD, early)[0])

    def test_missing_contact_fails(self):
        text = GOOD.replace("Contact: mailto:ben@spindlelabs.app\n", "")
        self.assertEqual(problems(text, NOW), ["no Contact line"])

    def test_bad_contact_fails(self):
        text = GOOD.replace("mailto:ben@spindlelabs.app", "ben at spindlelabs")
        self.assertIn("Contact is not", problems(text, NOW)[0])

    def test_two_expires_fail(self):
        text = GOOD + "Expires: 2027-10-31T16:00:00.000Z\n"
        self.assertEqual(problems(text, NOW), ["needs exactly one Expires line, has 2"])

    def test_local_time_expires_fails(self):
        text = GOOD.replace("2027-10-31T16:00:00.000Z", "2027-11-01 00:00 AWST")
        self.assertIn("not a UTC time", problems(text, NOW)[0])

    def test_wrong_canonical_fails(self):
        text = GOOD.replace("https://spindlelabs.app/", "https://spindlelabs-app.github.io/")
        self.assertIn("Canonical must be", problems(text, NOW)[0])


if __name__ == "__main__":
    unittest.main()
