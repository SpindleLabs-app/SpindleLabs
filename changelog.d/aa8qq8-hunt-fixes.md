fix

- A Move or Extrude cancelled while OK was still being checked is no longer recorded.
- Snap in an edited Move onto a body taken out of that Move lands on the body where it is drawn.
- Enter presses OK after a body is picked by its row in the browser.
- Escape while dragging a Move arrow calls off only the drag, not the whole Move.
- The timeline bar shows the new order straight after a drag, so a quick second drag lands where it was dropped.
- Dragging the item the timeline marker sits on leaves the marker in place, so no other item starts or stops building.
- A rectangle drawn from a projected corner of a face can be extruded.
- A small sketch inside a bigger one on the same plane can be picked in the view.
- Opening a file in a tab whose saves were refused keeps that tab's changes as a separate project instead of throwing them away.
- More valid STL files dropped on the app get the "can't open STL meshes yet" message instead of being called damaged.
