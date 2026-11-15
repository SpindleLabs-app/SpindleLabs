fix

- Security improvements from the 2026-11-13 hunt: the offline copy keeps each of its files once, whatever address it was asked for under; the MCP server never writes through a link and gives a file's own words back as one short line, and reads and writes only inside the folders it is started with (`--folder`); the assistant is told an item's description as one short line; the bug report log's counter is closed to the browser, and a check covers every counter.

public:
- Security improvements.
