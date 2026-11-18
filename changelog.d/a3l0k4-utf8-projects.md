fix

- A project file saved in another text encoding (an editor that wrote it as Latin-1) is refused in plain words, instead of opening with its accented letters changed ("Café" as "Caf�") for the next save to keep.

public:
- A project file saved by another editor in an older text encoding now says so, instead of opening with its accented letters changed.
