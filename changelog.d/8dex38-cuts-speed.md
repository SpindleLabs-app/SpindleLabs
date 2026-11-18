fix

- Rebuilding a part no longer slows down by a fixed amount for each Extrude Cut or Combine before the edit: a step that did not change keeps the names of its result instead of measuring every body it used again (SL #677 item 2).

public:
- Editing a part with many cuts is quicker.
