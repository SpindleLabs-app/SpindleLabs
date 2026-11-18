fix

- Copy as SVG of a sketch on a bottom, back or left face is the picture that was drawn, not its mirror image (export hunt 11-12, #639 item 2): the SVG writer takes how the outline's axes run on the viewer's screen, and Design gives it the sketch's side from the same rule Look At uses.

public:
- Copy as SVG of a sketch drawn on the underside or back of a part is no longer a mirror image.
