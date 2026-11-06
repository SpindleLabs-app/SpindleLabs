fix

- Deleting a line or arc now takes its own sizes and Horizontal or Vertical with it, even when its corners stay with the lines next to it.
- A refused constraint names the line it would shrink in words and draws it red, instead of showing an internal name.
- A big sketch (over 2,000 points) can still take constraints and be dragged where only a few points are tied together.
- An arc pinned to a body stays a true arc when the body changes, even in a sketch with no constraints.
- A refused dimension keeps its box open with the size typed, so it can be corrected.
- Picking an arc's centre and an end, in either order, gives its radius.
- A diameter outside the allowed sizes is refused like any other dimension.
