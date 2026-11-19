fix

- Opening a file stays quick however many projects are kept in this browser: it looked for its stored copy one project at a time, twice over for an Untitled file, so with about 60 kept projects it said "Saving…" for 20-35 s (nightly monkey issue #749).
- A Cut or Join question still up when another file opens now goes as a Cancel: left unanswered, the page said "Saved" yet asked "Leave site?" on every reload, and Undo waited for it for good (#749).

public:
- Opening a file is quick again when you have many projects kept in this browser.
- Reloading no longer asks "Leave site?" when your project says Saved after a Combine question was left open.
