fix

- Symmetric Extrude: with two or more profiles picked the preview is drawn centred on the sketch, as OK makes it (it was drawn all on one side), and the arrow is half the thickness long with its tip on the end cap, so grabbing it no longer doubles the distance (app-wide hunt 2026-11-14, R-1 and R-2). New journey `extrude-symmetric-preview`, and the browser check presses and lets go of the arrow.

public:
- Symmetric Extrude: the preview with several profiles is now centred like the finished part, and grabbing the arrow no longer doubles the distance.
