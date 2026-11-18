fix

- An extrude joined into a body from one of its faces (the usual wrong-way mistake) is now asked about and warned on its row, "adds nothing: it lies wholly inside Body 1", as one floating inside the body already was.
- A Combine or an Extrude Cut, Join or Intersect with a round body is refused in plain words that say which side is round and that round shapes are coming.
- Insert and the timeline menus wait for an OK that is still being checked, so pressing one right after OK no longer drops the Combine, extrude or edit without a word.

public:
- Cutting or joining with a round shape now says in plain words that this works on flat-sided shapes for now.
- Extruding into a body from one of its faces with Join now warns that it adds nothing.
- Pressing Insert or Suppress right after OK no longer loses the step you just made.
