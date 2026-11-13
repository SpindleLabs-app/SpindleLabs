step 53

- Step 53a1: Extrude and Edit feature have Symmetric: the body goes half the distance each way from the sketch's plane, so a 10 mm symmetric extrude is 10 mm thick with the sketch in its middle. Flip is greyed while it is on, a negative distance turns positive, and dragging the arrow sets the whole thickness. Works on origin planes, on faces, with several profiles, with Join, Cut and Intersect, and for a sketch that was deleted (the extrude keeps its last shape). Designs with a symmetric extrude are saved as Design data version 21, which older versions of the app refuse rather than build on one side.
- Fix: Edit feature's list of bodies an extrude reaches, and other workspaces' view of an extrude, now use where a flipped or face-sketch extrude really is (they used the sketch's plane going up).

public:
- Extrude has a Symmetric button: the body grows the same distance either side of the sketch, and the number you type is the whole thickness.
