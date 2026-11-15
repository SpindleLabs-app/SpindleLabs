One file per pull request: this folder holds the changelog entries that have
not been folded into CHANGELOG.md yet. A pull request never writes a version
number; it adds one file here, named so no other pull request uses it (its
branch's last part and a word or two, like ev4faw-version-bot.md):

    fix

    - Fixed: what was broken, how it was found and how it was checked.

    public:
    - What a person using SpindleLabs notices, in plain words.

First line: `fix` (the bug-fix number goes up by one), `step N` (the first
piece of CAD step N: the middle number goes up by one, 0.89.72 -> 0.90.0,
whatever N is; a step starts once, so its later pieces are `none` or `fix`)
or `none` (anything else).
Then a blank line and the entry, "- " lines in plain words.

Last, after a blank line, the public part: the lines for What's new, the
list the app shows in Settings > About (WHATS_NEW.md). Write `public:` and a
"- " line for each change a person using the app would notice (a new tool,
a fix they could see, a change in how something behaves), or `public: none`
when they would notice nothing (tests, CI, docs, refactors, the engine's
inner workings, anything still behind a switch: its public line comes with
the pull request that turns it on). Say WHAT changed, never HOW: no
algorithm, private file name or tolerance, and a security fix is only
"Security improvements." CI refuses a new fragment without the public part,
and public lines that mention tests, CI, the kernel, tolerances or a
security hole.

The numbers come from the order the pull requests reached main
(.github/scripts/changelog.py, which says how; `changelog.py show` prints the
whole changelog numbered). Never edit a fragment once it is on main.
