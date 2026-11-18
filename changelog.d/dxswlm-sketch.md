fix

- Sketch arcs can be dragged past a half turn, and tilted slots drag both ways; editing a body a slot is pinned to no longer warns that an arc would turn inside out. Dragging an arc's end across its start is still refused.
- The Rectangle and Line tools no longer take a construction line as one of their sides, nor refuse to draw over one.
- Giving a size to a rectangle's top or left side keeps the corner it was started from in place.
- A thin centre rectangle is no longer pulled flat onto its centre's row.
- A polygon refused as already there keeps the typed sides and diameter, and Escape keeps the number of sides.

public:
- Sketch arcs and slots can be dragged freely, including past a half circle.
- Rectangles and lines drawn over construction lines now come out whole.
- Sizing a rectangle's top or left side keeps its first corner where you put it.
- Thin centre rectangles draw as clicked.
- A polygon that couldn't be drawn keeps the sizes you typed, and Escape keeps its number of sides.
