fix

- Combine (still hidden): deleting a Combine whose piece another item used, or whose piece was hidden, no longer leaves a project that won't open again or a Redo that fails.
- Combine: two Combines of identical bodies no longer share one result, so combining those two results works instead of being refused.
- Combine: a sketch on a face piece that disappears after an edit no longer jumps silently onto another body's face; it follows with a warning to check it.
- Combine: the pieces a Combine leaves are listed in Bodies straight away, not only after Undo and Redo.
- Combine: changing the bodies or choices while OK is still checking is no longer silently ignored; nothing is recorded and the panel asks to press OK again.
- Move: a Move of a body a Combine used up now says so, instead of saying the body isn't built.
- Combine tests: the checker that replays editing sessions now agrees with Design on the order of a face's names after combining a body with one that already holds a copy of its names (the app itself was right; no shape changes).
