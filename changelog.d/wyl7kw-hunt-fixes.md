fix

- The Slice page lists and prints every body Design shows after a reload, an Open or an Undo on the page, instead of guessing from the saved data (a red Combine's tool was left off with no word), and Slice no longer fails on every press after a visit to Design.
- A size typed in the Size boxes, or a Shape chosen, right after pressing OK changes the body the boxes showed when it was typed, not whichever body they show once the OK lands; if that body can't be changed any more, the panel says so.
- A sketch point snapped to a corner a Chamfer made, or an edge projected from it, now depends on the Chamfer: deleting the Chamfer asks first, the sketch can't be dragged before it, suppressing it greys the sketch, and a sketch made before the Chamfer is no longer offered its corners.
- A Chamfer on both halves of an edge split by a notch carries on when the notch is taken away, chamfering the whole edge once instead of failing.
- A Chamfer saved with no name opens as "Chamfer 1", not "Item 1".
- New project on the home screen right after pressing OK keeps that step in the project left behind.

public:
- A size typed straight after pressing OK now changes the body you typed it for.
