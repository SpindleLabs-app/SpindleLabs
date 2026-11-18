fix

- The Slice page crashed when it opened with a printer preset picked last time (the preset was applied before the rest of the panel was built); it now opens on the preset. A changed choice on the page now clears the last result's words, cost line and hint, as the dialog did. Leaving the page while it slices now drops that slice (no name box or download appears over Design), closing the print preview puts focus back on Preview, the hint's button is 44 px tall on a phone, and after "Turn supports on/off" the old result's hint goes. The dialog's three print browser checks (slice-print, slice-print-fixes, slice-settings-fold) now drive the page (SP5b2b group 1).

public:
- Fixed the Slice page not opening for anyone who had picked a saved printer preset.
- On the Slice page, changing a choice now clears the last slice's result, so it never sits beside settings it no longer matches, and leaving the page while it slices stops that slice instead of saving a file you walked away from.
