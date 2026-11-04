fix

- A design where each sketch is snapped to the bodies before it no longer freezes the app when it opens or changes: a stack of about 60 items used to freeze it for over 15 seconds.
- An AI answer that arrives after you opened another file or changed a size is no longer applied to the changed design: it asks you to try again.
- Accept on an AI preview after Undo and Redo no longer says "Done" while changing nothing.
- Slicer presets saved, renamed or deleted in one tab no longer wipe out changes made to the presets in another tab.
- Pressing Undo while a design was still rebuilding could leave the timeline and browser stuck, so clicks there no longer changed the view.
- Two quick timeline changes could leave an older version of the design on screen.
- After Undo, the Extrude arrow no longer stays on the view.
- Save after File > New asks where to save, instead of writing over the last file you saved.
- Files with older endings (.fission.json, .panosolid.json) are offered back under their plain name when saved.
- A sketch snapped to a body that changes so its outline crosses itself now keeps its last shape with a warning, instead of failing.
- The build area now counts the warm-up loop and brim, and says which to turn off when only they do not fit.
