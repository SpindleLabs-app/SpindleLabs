fix

- Lost-work hunt (issue #627): a size typed straight after opening a project from File > Projects is stored (it showed "Saved" and was lost on a reload).
- A file opened and changed before the app's engine is ready is kept; until it is, leaving the page asks first.
- When this browser's storage fails at the start, the save mark says nothing is kept for as long as that is so, and leaving the page after a change asks first.
- The History kept in this browser survives an app update, and a reload made within a second of a change.
- Steady work with changes under a second apart is now stored every five seconds at the latest, not only once it stops.

public:
- A size typed straight after opening a project is no longer lost on a reload.
- A file changed before the app has finished loading is kept.
- Undo history is no longer emptied by an app update or by reloading right after a change.
- Work is saved at least every five seconds while you keep editing.
- If your browser can't keep projects, the app says so the whole time and asks before you leave.
