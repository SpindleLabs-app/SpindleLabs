fix

- Ctrl+Z pressed straight after a sketch click (the click that finishes a rectangle, a typed size, a dimension) now takes back that click. Before, the click was still being worked out when Undo ran, so Undo took back the shape drawn before it and the new one stayed (#622 item 1).
- Ctrl+Z pressed straight after a Delete that asks first ("this also removes...") leaves the step before alone and the question open. Before, it undid the step before while the question was still on its way (#622 item 2).
- An Undo that waited for an OK, a Finish or a Delete which then recorded nothing (refused, cancelled, or only a question) is dropped instead of taking back the step before (#622 items 3 and 6).
- Edit feature's OK no longer lands after the panel was cancelled and opened again while the first OK was still being checked (#622 item 5).

public:
- Undo pressed straight after a sketch click now takes back that click, not the shape before it.
- Undo pressed straight after Delete or a refused OK no longer takes back an earlier step by mistake.
