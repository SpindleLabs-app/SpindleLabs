fix

- Moving an item in the timeline past a Move or Combine that placed or changed a body it works on is refused, naming both, instead of quietly changing the result.
- Deleting a Move or Combine that a later item's bodies depend on now asks first, naming the items that will change.
- Editing a Combine so that it uses up a body a later item works on is refused, saying which item to change first.

public: none
