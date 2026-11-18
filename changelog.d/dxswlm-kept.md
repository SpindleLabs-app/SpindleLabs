fix

- An extrude of several profiles from one sketch now keeps each profile's own last shape: when one profile's outline was broken and later another's, the second came back at an older shape (two squares built as 100 + 100 mm³ where 250 was right).
- Design data version 19: each profile's kept shape is saved under its own key; version 18 files open and are upgraded, each profile keeping the shape it had.

public:
- An extrude of several shapes from one sketch now keeps the right size for each shape when their outlines are broken one after another.
