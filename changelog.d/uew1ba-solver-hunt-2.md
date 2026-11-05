fix

- A Fix that adds nothing (the sizes and constraints already hold that point) is refused, so it can no longer block a later change.
- Dragging a point its constraints hold still now says so, instead of doing nothing silently.
- With a point picked first, clicking a line no longer quietly sizes the line instead: the point waits for a second point.
- A tap on the middle of a short side picks the side on a phone, not its corner.
- A dimension's size box stays by its label, even with a message under it, instead of jumping to the view's corner.
