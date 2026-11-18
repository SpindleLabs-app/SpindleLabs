fix

- Extrude of several profiles: a sketch on the top of a profile after the first is no longer called lost when a side of that profile is deleted and drawn again; each later profile's caps are named by its place in the extrude (`end:2`), and files from before still find them.
- Extrude of several profiles: the preview of profiles that overlap shows the one joined body OK makes, instead of adding the overlap twice.

public:
- A sketch drawn on the top of an extrude of several profiles no longer gets lost when you redraw a side of one of them.
- The preview when extruding overlapping profiles now matches the result.
