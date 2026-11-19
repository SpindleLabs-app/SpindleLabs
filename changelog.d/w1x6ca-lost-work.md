fix

- With browser storage full, a project's earlier versions are no longer thrown away when that does not make room for the save.
- With browser storage full, a file opened and changed is the project a reload opens and File > Projects lists, rather than another project marked Saved.
- Reloading a tab opens that tab's own project, not the one another tab saved last.
- A project opened from the projects list after another tab saved it no longer says "changed in another tab" with only one tab open.
- Unsaved changes this version can't read are kept for a later version instead of being deleted.
- A tab that another window has overtaken no longer writes its undo history over that window's.
- A project with no name of its own saved under a file name takes that name, inside the file too.
- Browser storage made by a newer SpindleLabs is said in plain words.

public:
- When browser storage is full, earlier versions of your project are kept, and a file you opened and changed comes back after a reload.
- Reloading a tab opens the project that tab had open.
- Opening a project from the list no longer wrongly says it was changed in another tab.
- Saving a new project under a file name gives the project that name.
