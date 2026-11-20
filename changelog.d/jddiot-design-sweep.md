fix

- A sketch on a face can no longer be dragged in the timeline past a Move or Combine of the body it is drawn on (which quietly moved the sketch and its pad); the refusal says why.
- A Combine or Extrude Join put in at a rolled-back marker can't use up a body a later step needs, and editing a Combine or extrude so a later step would break now asks first.
- Refusals name a deleted body in words ("Box 1 was deleted"), never by an internal id.
- Rows of older files upgraded from version 15 name a Join's own body as its body, not "a piece of" it.
- Files whose Combine words disagree with what it does are refused when opened, naming the item.
- A combined body's download is named "body", not after its first shape.
- Editing an Extrude Cut, Join or Intersect with Combine switched off now says what it does and that it stays as saved.
- New tests for an arc whose ends sit at different distances from its centre, and for a boss switched from Join to Cut.

public:
- Dragging a sketch on a face past a step that moves its body is now refused with a reason, instead of quietly moving the sketch.
- Edits that would break a later step now ask first.
- Messages never show internal ids for deleted bodies.
- A combined body's download gets a clearer file name.
