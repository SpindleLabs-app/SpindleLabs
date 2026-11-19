fix

- Combine's "Undo puts it back" line goes as soon as another tool opens or a later step is recorded (app bug hunt 11-18 D-8).
- A sketch of separate closed loops says how many regions Extrude offers instead of "not closed" (D-5).
- Laser: parts touching only at a corner are no longer told their cuts would share a line (C-2).
- Deleting a bar whose two pieces a Move lifts now says the Move fails, as it does (#760 item 3).
- Pasting a body a Combine used up since it was copied pastes nothing instead of a red copy (B-4).
- TestLab: no "Held here" or load tag over the body with nothing under it; Run's reasons are listed below "Not run" (D-6).
- A body handed to another workspace only as a mesh is named, not shown by its raw id.

public:
- Combine's "Undo puts it back" note now disappears as soon as you do something else.
- A sketch with several separate closed shapes now says how many regions you can extrude, instead of saying it is not closed.
- Laser: two parts touching only at a corner are now described correctly.
- Deleting a body that a Move needs now says exactly what will happen to the Move.
- Pasting a body that a Combine has since used up no longer adds a broken copy.
