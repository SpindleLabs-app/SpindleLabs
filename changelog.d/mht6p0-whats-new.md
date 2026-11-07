none

- What's new: Settings > About has a list of what changed in each version that a person using SpindleLabs would notice, newest first, back to 0.0.0 (WHATS_NEW.md, written by hand from the whole changelog for every version so far; versions with nothing visible are left out, never renumbered). Every fragment now ends with its public part (`public:` and the What's new lines, or `public: none`); CI refuses a new fragment without it and public lines that talk about tests, CI, the kernel, tolerances or security holes; `changelog.py fold` writes the public lines into WHATS_NEW.md under the right version, and `changelog.py public` (which the live build runs, with main's whole history) shows them before a fold. Checked by hand-worked and 300 seeded fold tests, deliberate breaks of each new check, unit tests of the list, and a browser check at 1280 px with the mouse and 375 px with taps.

public:
- What's new, in Settings under About: what changed in each version, newest first.
