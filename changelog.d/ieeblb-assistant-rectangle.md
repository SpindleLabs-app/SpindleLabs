fix

- A rectangle drawn by the assistant now gets the same Horizontal and Vertical constraints as one drawn with the Rectangle tool, so a dimension on one side no longer leans it into a trapezoid (found in the sketch solver hunt; tested with the corners worked out by hand, on the real kernel).

public:
- A rectangle drawn by the assistant now stays a rectangle when you set the length of one side.
