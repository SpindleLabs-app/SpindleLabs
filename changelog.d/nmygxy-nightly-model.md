fix

- The timeline fuzzing's model judges a sketch on a face that is whole again by the middle of the sketch's own points, as Design does, so the nightly fuzzing no longer reports a false disagreement there.
- The nightly monkey keeps a piece's remembered faces when it numbers a file's bodies again, and no longer calls a sketch point that follows the edited body's corner a leak of the edit.
- New tests for Design's file reader catch every change the nightly mutation testing made to its construction, Mirror and version checks; the six no file can tell apart are explained.
- When the geometry engine restarts in the middle of an action, Insert still opens its Move, Extrude's OK works the first time, and a sketch click still places its point.

public:
- When the geometry engine has to restart in the middle of an action, Insert still opens Move, Extrude's OK works on the first press, and a sketch click still places its point.
