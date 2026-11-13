fix

- A Move of a body that an earlier Cut splits in two while the Move is switched off (suppressed, or rolled back by the timeline marker) now takes the new piece too, so both pieces move when the Move is back on. Before, one piece moved and the other stayed where it was, with no warning (SL #624 item 2; found by the broken-solids hunt of 2026-11-12).
- A body made by a Combine can now be combined with a Copy of itself that still lies on it (Join and Intersect give the one body). Before, OK was refused with "a body can't be its own tool", though two bodies were picked (SL #624 item 3).

public: none
