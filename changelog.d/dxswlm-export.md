fix

- Export STL and Slice for printing now say which timeline items failed and that they are not in the file (a failed hole was left out without a word, the STL still "Checked solid"); the STL is not marked checked then, and the print preview says it too.
- Two bodies that are each solid but touch or overlap get a milder note offering Combine > Join instead of a red "Not solid"; a body that is broken on its own is still "Not solid".

public:
- Export STL and Slice for printing now tell you when a feature in the timeline failed and is missing from the file.
- Bodies that only touch each other are no longer reported as "Not solid" on Export STL; you are offered Combine > Join instead.
