step 37

- Combine (and an extrude's Join, Cut and Intersect, and Pattern's Join) works on cylinders, holes and arc extrudes: the app no longer refuses a round body itself. What the kernel still refuses (spheres, a round face touching a flat one side on, two round faces meeting) is said in the app's own plain words.
- Tests: hand-worked and seeded cylinder Combines against closed forms; a browser check of the drilled box and the slanted cut at 1280 px and the sphere refusal at 1280 and 375 px.

public:
- Round parts (cylinders, holes and arcs) can now be combined: join them, cut holes with them or keep their overlap.
