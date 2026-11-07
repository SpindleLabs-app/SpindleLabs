fix

- When a Combine cuts a body into pieces, each piece now keeps its body number when an earlier change makes the pieces bigger or smaller, so a later Combine or Move keeps working on the piece it was made on instead of quietly switching to another one.
- If a numbered piece can no longer be found after an earlier change, the Combine now shows a warning on its row saying which body may now be a different piece, instead of switching without a word.
- Saved designs now remember each piece's faces; designs saved before this open as they did and pick this up on their next rebuild.
