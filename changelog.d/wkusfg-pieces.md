fix

- A Cut that goes right through a body a later Move holds: OK now gives the new piece to that Move before numbering it, so both ends stay moved (one end dropped back to where it was before the Move, with nothing red and no warning; app-wide hunt 2026-11-14, T-2, brought in by the piece-number fix for SL #622 item 7). Journeys `piece-numbered-move` and `piece-numbered-combine-move`.

public:
- Cutting right through a part you had moved no longer leaves one half behind at its old place.
