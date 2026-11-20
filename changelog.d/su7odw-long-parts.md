fix

- Long, skinny parts are easier to move round: zooming with the wheel closes in on the part under the pointer instead of flying through its near end, and the far end of a long part no longer disappears when zoomed in close.
- After coming back to a design tab, the Top and Front views are square again and the view no longer flips over or sticks while orbiting with the view cube.
- A view cube drag stops when the mouse button is let go, even if it was let go outside the window.
- TestLab draws a bend too big for its small-bend estimate smaller than worked out and says so, instead of drawing a part far past breaking stretched to many times its length.

public:
- Zooming in on long, skinny parts now heads for the part under the pointer, and the far end no longer vanishes close up.
- The view cube no longer gets stuck, and Top and Front stay square after switching design tabs.
- TestLab no longer draws a part that would break stretched to many times its size; a very big bend is drawn smaller, and the panel says so.
