fix

- Undo and Redo no longer keep every earlier copy of the Design workspace in memory: the Body facts toggle's listener on the properties panel was added at each mount and never taken off (three long journeys ran out of memory on main).

public:
- Long sessions with many undos use less memory.
