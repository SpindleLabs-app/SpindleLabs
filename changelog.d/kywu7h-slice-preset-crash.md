fix

- The Slice page crashed when it opened with a printer preset picked last time (the preset was applied before the rest of the panel was built); it now opens on the preset. A changed choice on the page now clears the last result's words, cost line and hint, as the dialog did.

public:
- Fixed the Slice page not opening for anyone who had picked a saved printer preset.
- On the Slice page, changing a choice now clears the last slice's result, so it never sits beside settings it no longer matches.
