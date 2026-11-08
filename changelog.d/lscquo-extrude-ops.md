fix

- Deleting a Combine or an extrude whose piece a later Extrude Join, Cut or Intersect works on no longer leaves a file that won't open again: the later extrude now says in words what was deleted.
- An Extrude Join keeps every body it holds under its own name: a picked body the extrude doesn't reach stays that body, and a join of several goes into the one made first, whatever the order they were picked in.
- The pieces an Extrude Cut or Intersect leaves are now found again by their faces, as a Combine's are, so an earlier edit can no longer hand a later Move a different piece without a word; when a piece really changed, the extrude warns, and editing it confirms the pieces as they are.
- An Extrude Join that takes in the last body made no longer shows the part's red "built no body" line.
- A body picked twice is named as the browser shows it ("Body 2"), and a Move of a body an extrude used up says so.

public: none
