fix

- A Move holding only a body an earlier Combine had used up now moves a piece an edit splits from that body straight away, instead of only after a reload or undo, so the screen matches the saved design.
- The timeline test model now treats a held piece whose Combine fails or is deleted as a warning, as the app does, so the nightly timeline fuzz no longer reports a false difference.

public: none
