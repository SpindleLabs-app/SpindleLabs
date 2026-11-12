fix

- The warning under an Extrude Join that adds nothing names its new body the same way the Bodies list does, on the first build and after the design is opened again.
- Editing a Combine names a tool body the Bodies list no longer shows by its item ("Box 2"), and one whose item was deleted as "Box 2 (deleted)", instead of a body number that isn't on the list or an internal id.
- Combine with fewer than two bodies says it needs two and how to add another, instead of asking you to click a body.
- Extrude set to Cut says when it only touches the body and would cut nothing, and suggests Flip, before OK asks.
- On a 320 px phone the Combine sheet keeps its rows in order: choices, then the two body fields side by side, then OK and Cancel.

public:
- Combine and Extrude's messages name bodies the same way as the Bodies list, and say what to do when there aren't two bodies to combine.
- Extrude set to Cut warns as you go when it points away from the body and would cut nothing.
- The Combine panel's layout is fixed on very narrow phones.
