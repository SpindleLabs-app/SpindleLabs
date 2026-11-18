fix

- Ctrl+Z with the keys in a size box (or on the Shape list) is now the project's Undo. Before, the browser's own undo of typing ran instead and retyped an old size as a new step: a box typed 60 mm wide became 6 mm. The same from the command search or another box, which could reach back into a size box (#623 item 1).
- Ctrl+Z after a sketch line placed by typed sizes takes the line back; before, the keys sat in the emptied Length box and nothing happened (#623 item 2).
- Exploded view kept through Undo and Redo shows its Spread bar and lit button again; before, the bodies stayed drawn pulled apart with nothing to say why (#623 item 3).
- Paste after an Undo no longer pastes a copy of a different body that took the copied one's place (#623 item 4).
- Edit feature closes when a size is typed in the Size boxes below it, so its OK can't put the old size back (#623 item 5).

public:
- Ctrl+Z after typing a size now undoes that size; before, it could change the size to a number you never typed.
- Ctrl+Z now works straight after drawing a sketch line by typed sizes.
- Exploded view no longer gets stuck on after Undo.
- Paste no longer copies the wrong body after an Undo.
