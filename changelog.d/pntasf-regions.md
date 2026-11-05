none

- An extrude can use any closed region of a sketch, including a shape with holes in it (a circle drawn inside a rectangle makes a plate with a hole) or the inside of a hole on its own. The extrude remembers its region by the lines around it, so drawing more elsewhere in the sketch never makes it switch to a different region.
- If the region an extrude uses is cut apart or loses one of its lines, the extrude keeps its last shape and says why, as it does when its sketch is lost.
- Projects with an extrude of a region use a newer design file version, which older copies of the app will say is from a newer SpindleLabs.
