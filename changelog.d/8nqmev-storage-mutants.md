none

- New tests for saving in the browser, written for the changes last night's mutation testing found no test noticed, and reasons recorded for the few that make no difference.
- A tab whose saves were refused because another tab had saved no longer briefly says "Saved" after going back to the state it opened.
- Closing a project while browser storage is full no longer writes over another tab's unsaved changes, and keeps the latest change rather than an earlier one.

public: none
