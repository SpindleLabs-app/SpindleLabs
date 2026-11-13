fix

- SL #707: a sketch on the top of a Join whose inputs' tops were level now follows the body it was drawn on when a Move before the Join moves one input, and a sketch on that top stays on the right piece when the top is later split. Designs are saved as Design data version 22; sketches drawn before keep where they were (marked `first` as they are opened), and older versions of the app refuse version 22 files.

public:
- A sketch on a face that a Join merged from two level faces now moves with the part it was drawn on, and stays with it when that face is split later.
