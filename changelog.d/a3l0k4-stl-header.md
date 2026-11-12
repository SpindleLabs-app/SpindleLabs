fix

- The name written at the top of an STL file the app joins or marks as checked keeps to plain letters: any other character, a line break or an accented letter or emoji alike, becomes one "?", so the file never holds half a character or a stray control character.

public:
- STL files no longer hold a broken character when a part or project name has accents, emoji or line breaks.
