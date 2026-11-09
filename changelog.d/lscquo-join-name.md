fix

- When an extrude that joins bodies leaves a part of its own apart from them, that part is now the extrude's own body, named after the extrude, instead of a numbered piece of it (Design data version 16).
- Older files are renamed to match when they open, so anything that moved, copied, combined, cut or hid that part still finds it, and the design builds exactly as before.

public: none
