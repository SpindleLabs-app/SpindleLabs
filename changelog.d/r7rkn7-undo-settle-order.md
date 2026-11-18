fix

- Undo pressed after two quick actions in a row (a size typed or an OK, then straight away an eye, Insert, Rename, Suppress or an AI change) no longer lands on a design nobody made, such as an extrude shown red and missing its body.
- A size typed while the part is still rebuilding is kept at once: reloading, closing the tab or opening another project straight after typing "10" no longer keeps it as 1.
- Actions done while a typed size is still rebuilding happen in the order they were done: a Suppress keeps the whole number typed, and Undo after typing then Insert takes back the Insert.

public:
- Undo straight after two quick actions in a row now always goes back to the design you actually had.
- A size typed just before reloading or switching projects is no longer lost.
