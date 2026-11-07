# What's new

What changed in SpindleLabs that you can see or use, newest first. A version with nothing you would notice is left out, so the numbers can jump. The app shows this list in Settings, under About.

Each pull request's entry in `changelog.d/` ends with a `public:` part: the `- ` lines it adds here, or `public: none`. `.github/scripts/changelog.py fold` writes them in under the right version; until then `changelog.py public` shows this list with them.

## 0.35.41 (2026-11-07)

- Extrude any closed region of a sketch, including a shape with holes (a circle inside a rectangle makes a plate with a hole) or the inside of a hole on its own. Every region is shaded while you extrude; click the one you want.
- If the region an extrude uses is cut apart or loses a line, the extrude keeps its last shape and says why.
- Measure (Inspect menu): click a face, edge or corner to read its size, then a second to get the distance between them, along X, Y and Z, and the angle.
- With Print check on, finishing a sketch in a scene of several rounded bodies no longer freezes the app for a few seconds.

## 0.35.40 (2026-11-07)

- Solving a sketch again no longer nudges its points.

## 0.35.38 (2026-11-06)

- Saving a design, starting a new one and opening the same file again no longer says it was changed in another tab.

## 0.35.36 (2026-11-06)

- A rectangle comes with its sides held level and upright, so dragging a corner keeps it a rectangle.
- A rectangle drawn from a corner of a body or the origin no longer breaks Undo and Redo.

## 0.35.35 (2026-11-05)

- Settings > Design sets the grid size and Snap to grid that new sketches start with.
- Settings has a Mouse choice: the usual way, or one where the left button only picks and the middle button turns the view. Each shows a table of what every button does.
- The timeline, the browser and the AI preview show lengths in your chosen unit.
- Dragging a point its constraints hold still says so.
- On a phone, a tap on the middle of a short side picks the side, not its corner.

## 0.35.34 (2026-11-05)

- The sketch's size boxes show your chosen unit, and a length typed in inches is read as inches.
- Deleting a line or arc takes its own sizes and constraints with it.
- A refused constraint names the line it would shrink and draws it red.
- A refused dimension keeps its box open so it can be corrected, and picking an arc's centre and an end gives its radius.

## 0.35.33 (2026-11-05)

- The Dimension tool: click a line, arc, circle or two points, type the size, and the sketch moves to fit. Double-click a size to change it.
- Construction lines: press X (or Construction) to turn lines, circles or arcs into dashed helper lines that are left out of the shape.
- Report a bug (Settings > About) opens a filled-in issue for you to check and send.
- Move and Rotate boxes show your chosen unit.

## 0.35.32 (2026-11-05)

- Settings has a Units choice: millimetres or inches.
- Print check (Inspect menu) colours what would go wrong printing the part as you model it: where supports are needed, walls too thin for the nozzle, bridges that may sag, and the weakest spot (an estimate). Off until you turn it on.
- Sketch constraints: Horizontal, Vertical, Coincident and Fix. A constraint that fights the others is refused, with the ones that fight shown in red. Dragging a point moves the rest of the sketch with it.
- A sketch with constraints stays solved when the body it is attached to changes.
- After slicing, a badge shows the weight, cost and print time. The price per kg is yours to set.
- Printer fits: print a small test piece, measure it, and SpindleLabs learns how your printer sizes holes and pegs.
- A History button beside Undo and Redo lists every step you have taken; press one to go back to it.
- Exploded view (Inspect menu) pulls the bodies apart so you can see how they fit, without changing the design.
- File > Save picture (PNG) saves the view as a picture.
- Signed in, File > Earlier versions also lists the versions kept in your account.
- Starting a sketch on a small face zooms in on that face.
- When a phone's keyboard opens, the box you are typing in moves into view.
- In a very small window, the page no longer slides sideways.

## 0.35.31 (2026-11-05)

- Show only this body and Show all bodies, in a body's menu.
- While you draw, the sketch's plane is shown as a lightly tinted sheet, so it stays visible from the other side.
- Ctrl+S saves, Ctrl+Shift+S saves under a new name and Ctrl+O opens a file.
- Hovering a timeline item shows a card with its name, kind, key sizes and a small picture.
- Move items in the timeline have their own icon.
- The Properties panel's Fold button stays at its top while you scroll.

## 0.35.30 (2026-11-05)

- The Delete and Backspace keys delete the selected body or timeline item, asking first when something else is built from it.
- My designs: when you are signed in, your designs can be kept in your account and opened on any device. You can turn it off.
- Changes that couldn't be saved because of another tab are kept as "(kept copy)", and the note says plainly that nothing is lost.

## 0.35.29 (2026-11-05)

- A shape you insert starts with the Move tool on it, so you can place it straight away.
- Escape turns Pan or Zoom off on the view bar, back to Orbit.
- The AI assistant no longer sits at 90% for ever: it gives up after 30 seconds and offers Try again. It also does only what you asked, without extra steps.

## 0.35.28 (2026-11-05)

- Double-click a face or edge to select its whole body; Shift+double-click adds a body to the selection.
- After slicing, a line says whether your part needs supports, with one button to match.
- A Custom theme in Settings: pick your own colours. A colour that would make words hard to read is nudged, and the change is explained.
- Tooltips show at once in the app's own style. Right-click an icon (or press and hold) for a quick note on how to use it.
- A star, L-bracket or plate typed too small is refused in plain words with the size that works.
- Undo or Redo pressed while a change is still being worked out pulses until it has acted.
- Warnings over the view sit at the top centre, where nothing hides them.

## 0.35.27 (2026-11-04)

- In Pan or Zoom mode, dragging the Extrude arrow or a Move or Rotate handle no longer moves the camera as well.

## 0.35.26 (2026-11-04)

- Print files are named after your project's file once it has been saved or opened.

## 0.35.25 (2026-11-04)

- Double-clicking Save, or Slice and download, saves one file instead of one per click.
- Zooming out with the mouse wheel stops at a sensible limit instead of breaking the 3D view.

## 0.35.24 (2026-11-04)

- A cylinder, sphere or slot too small to make is refused in plain words instead of being kept as a broken part.
- Pressing Undo straight after OK, while the step is still being worked out, undoes that step.
- A huge angle typed into Rotate turns the body to the right place.
- Downloading an STL of many moved bodies, or slicing them, is much faster.

## 0.35.23 (2026-11-04)

- Slice for printing offers the Cool Plate and Cool Plate SuperTack, with the right bed temperature for each.
- Slicing fixes: thin walls and ribs print their first layer, tree supports under wide parts are much faster, and the brim no longer leaves a gap.

## 0.35.22 (2026-11-04)

- File > Earlier versions…: the browser keeps how your project was as you work, and Restore puts one back.
- The workspace menu now lists Design and Slice, and choosing Slice opens Slice for printing on your design. The other workspaces, and Split view, are set aside until they are ready.
- Dropping a picture says the app can't open pictures yet.

## 0.35.21 (2026-11-04)

- Closing the keyboard shortcuts list opened from Settings takes you back to Settings.
- The highlight on the view bar slides to the mode you pick.

## 0.35.20 (2026-11-04)

- File > Projects in this browser…: every project kept in this browser, to open again or delete.

## 0.35.18 (2026-11-04)

- Fixes to Move, Extrude and the timeline: Enter presses OK after picking a body in the browser, Escape while dragging a Move arrow calls off only the drag, and a quick second timeline drag lands where it was dropped.
- A rectangle drawn from a projected corner of a face can be extruded, and a small sketch inside a bigger one can be picked in the view.

## 0.35.17 (2026-11-04)

- Slicing fixes: a body standing on another is no longer warned that it hangs in the air, Close reads Stop while slicing and really stops it, Undo and Redo keep the Slice choices, and long project names no longer cut the settings out of print file names.

## 0.35.16 (2026-11-04)

- A light theme, picked in Settings (Follow device, Light or Dark). By default the app follows your device.
- Sign in with Google if you want to. Designing, slicing and saving never need an account.
- The privacy policy is rewritten for accounts: what is kept, where, for how long, and how to download or delete your data.
- Right-click a body in the 3D view (or hold a finger on it) for its menu.

## 0.35.15 (2026-11-04)

- A design where each sketch is snapped to the bodies before it no longer freezes the app.
- An AI answer that arrives after you changed the design asks you to try again instead of being applied.
- Pressing Undo while a design was rebuilding could leave the timeline and browser stuck. Fixed.
- Save after File > New asks where to save, instead of writing over the last file.
- A sketch snapped to a body that changes so its outline crosses itself keeps its last shape with a warning.
- The build area counts the warm-up loop and brim, and says which to turn off when only they don't fit.

## 0.35.14 (2026-11-04)

- Security researchers can find how to report a problem privately, at spindlelabs.app/.well-known/security.txt.
- The orientation cube describes itself to screen readers.
- A body hidden again by Undo no longer stays selected.
- Security improvements.

## 0.35.13 (2026-11-04)

- Circles have a Diameter box while you draw them.
- The in-browser AI model asks before it checks the download size, so nothing is requested until you agree.

## 0.35.12 (2026-11-04)

- Opening a project while the Properties panel was folding away could change a body in the opened file. Fixed.

## 0.35.11 (2026-11-04)

- In a sketch you can select lines, circles and arcs and delete them: press Escape or Select to stop drawing, click a curve (Shift+click for more), then press Delete.
- Deleting part of a sketch that is already extruded never breaks the solid: it keeps its last shape and says why.
- A bad grid size followed straight away by a click on Extrude or Finish Sketch no longer loses the click.

## 0.35.10 (2026-11-04)

- Pressing AI, Guide or Community again closes it, and Community goes back to the workspace you were in.

## 0.35.9 (2026-11-04)

- Slice for printing has a cleaner look.
- Slice for printing can save its settings as named presets, kept in your browser.

## 0.35.8 (2026-11-02)

- On phones, every timeline button and item takes a full finger-sized tap.

## 0.35.7 (2026-11-01)

- With a body selected, the Width, Depth and Height boxes and the Shape choice change that body.
- Undo after typing a size for one body no longer also undoes a size typed for another.

## 0.35.6 (2026-11-01)

- Slicing is faster on thin pins and grilles, tall parts print at every layer height, seams stay on one corner, and the nozzle lifts clear of very tall parts.
- Two tabs on one project no longer lose saved work: a stale tab's last change is kept as a separate copy.
- A phone held sideways gets a usable tool card with Finish and Cancel.
- Smaller fixes: long non-English file names, folders dropped on the app, very large files, boxes that made iPhones zoom, and pinch-zoom on the toolbar.

## 0.35.5 (2026-11-01)

- Fixes to editing a Move: turning about the centre of the bodies, Snap from a body just added, and a Move whose body was deleted.
- A deleted body leaves the selection.

## 0.35.4 (2026-11-01)

- On a phone, a tap where the Length and Angle boxes stand draws the next point. Type in the sketch toolbar puts the keys in the boxes.
- An arc drawn again over the same arc is refused, and clicking twice on a point no longer draws an invisible line or circle.
- Lines and circles too small to model are refused with a note while you draw.
- Extrude's preview follows changes to the design while the panel is open, so OK makes what was shown.
- Pressing Enter twice no longer adds a line to the pointer, and a reopened sketch keeps its grid size.
- Changing a ready-made shape no longer moves a sketch on one of its sides onto a different face.

## 0.35.3 (2026-11-01)

- Better grip: a brim and a slower, hotter first layer for prints that lift.
- A warm-up loop round the first layer, so the nozzle's first plastic goes on a line you peel off.
- The bottom edge of a print no longer bulges out.
- A progress bar while slicing, and parts with supports under a lying cylinder no longer time out.
- A Build area (P1S) eye in the Origin folder shows what the printer can print, and turns red when the part won't fit.
- Right after you open a file, the top bar says "Saving…" until the file is really kept.

## 0.35.2 (2026-11-01)

- A big solid part at high infill is no longer stopped for taking too long to slice.
- Download STL of several bodies says they are separate shells in one file, and what that means for slicers.
- Slice for printing says when bodies start at different heights, and a part floating above the plate is refused in plain words that say what to do.

## 0.35.1 (2026-10-31)

- Prints stick better and slicing is faster: a wider first layer, a small gap at each wall's seam, parts with 45° edges slice, and a feature too thin to print is warned about instead of dropped.

## 0.32.74 (2026-10-31)

- Slice for printing has a Nozzle choice (Standard or High Flow).
- Bambu Studio shows the right print time for P1S files from SpindleLabs, and opens them without "Invalid configuration file".

## 0.32.73 (2026-10-31)

- The AI assistant calls each body by the number its row in the browser shows.

## 0.32.72 (2026-10-31)

- P1S print files name the nozzle, cool each layer, keep the fans running and lay the first layer gently.
- Print files are named after your project.
- The print preview shows exactly the file Slice and download saves, and gives its memory back when closed.
- Closing the Slice dialog while it slices cancels it, and a part too big for the plate says how big it is and what the P1S takes.
- On a phone, Safari or Firefox, the file name box no longer opens hidden behind the Slice dialog.

## 0.32.71 (2026-10-31)

- A device that sleeps while the geometry engine is working no longer makes a step fail with "took too long".

## 0.32.70 (2026-10-31)

- Sketch points snap to the origin and along the sketch's axes.
- Every body keeps its number: Body 2 stays Body 2 when a body before it is suppressed, moved or deleted.
- A feature that takes too long is marked red with a Retry button, while the rest of the design is built.
- Bodies that aren't on screen use much less memory.
- Slow devices get as long as they need, and a stuck calculation is stopped sooner.
- P1S print files open in Bambu Studio, and the Slice dialog fits a laptop screen.

## 0.32.69 (2026-10-30)

- Tree supports: branches that use less plastic than columns.
- Slice for printing saves a Bambu Lab P1S print file for the build plate you pick. Plain G-code is still there for other printers.
- Drop-down lists open dark with readable words.

## 0.32.68 (2026-10-30)

- Opening SpindleLabs soon after an update opens the new version by itself, with your design kept.

## 0.32.67 (2026-10-30)

- Slice for printing can add supports under overhangs, and the print preview shows them in green.
- The print preview says roughly how long a print takes, has a Show card to switch walls, infill and travel moves on and off, and looks more like a real print.
- The time-lapse no longer jumps ahead on a slow computer or after switching tabs.
- A very large refused grid size no longer runs off the screen.

## 0.32.66 (2026-10-30)

- The print preview draws printed lines as wide as they really print.

## 0.32.65 (2026-10-29)

- Slice for printing (in the File menu): turn the bodies shown into a print file for a Bambu Lab P1S, with a choice of quality, walls and infill. A first version.
- Print preview: watch your part print in 3D before printing it. Slide through the layers, or press Play for a time-lapse of the nozzle laying it down.
- Move's Snap works on curved faces, and editing a Move lets you change which bodies it moves.
- Soft placeholders show where things will appear while the app starts, a project opens or the AI answers.
- A sketch on a face of a moved body slides and turns with that face when the Move is edited.

## 0.32.64 (2026-10-29)

- Extrude starts at 0 mm: drag the arrow or type how far.
- Opening a file you already opened, unchanged, carries on with the kept copy instead of storing another.
- After you first save your work, the app asks the browser to keep your projects when the device runs low on space.

## 0.32.63 (2026-10-29)

- A dropped file the browser can no longer read says so in the top bar.
- A drag whose button release goes missing (Alt-Tab, say) now ends instead of following the mouse.
- On phones, the Properties boxes are big enough to tap and no longer make iPhones zoom in.

## 0.32.62 (2026-10-29)

- While you drag a Move, Rotate or Extrude handle, the number it changes glows softly.
- A device clock that was wrong and then corrected no longer makes the app reopen an older project.

## 0.32.61 (2026-10-29)

- Move and Rotate are now two tools. Rotate has its own button (Shift+R) and turns bodies by a grip on each axis.
- Move and Rotate handles never sit on top of each other and are easier to grab with a finger.

## 0.32.60 (2026-10-29)

- Every row in the browser that shows something has an eye, folders included.
- A sketch hides itself once an Extrude uses it, and its eye shows it again.
- If the geometry engine stops answering in the middle of an edit, it restarts by itself and the design is rebuilt.
- If the browser's storage stops answering, the app still opens and says so.

## 0.32.59 (2026-10-29)

- New keys: E opens Extrude, and S opens a search of every command by name.
- Move, Edit and Extrude refuse sizes the app can't model as you type them.
- Saving into a file you picked says so when the file can't be written, instead of quietly downloading a copy.
- On a phone, a greyed Finish button says why it can't finish.

## 0.32.58 (2026-10-29)

- Two tabs saving the same project at once can no longer silently overwrite each other.
- A tab closed by the browser in the middle of a save no longer leaves a project missing from the list.

## 0.32.56 (2026-10-29)

- Turning a phone sideways while typing a size no longer leaves the size boxes off the screen.

## 0.32.55 (2026-10-29)

- After the geometry engine restarts, the rebuilt part no longer goes missing or stays the old size.

## 0.32.53 (2026-10-29)

- A circle that Snap to grid pulls onto its own centre says so by the pointer, and on a phone sketch messages show by your finger.
- Extrude or Finish Sketch pressed with a shape half drawn says the shape isn't finished.
- A refused size says it went back to the last size, and points to Flip for a negative distance.
- Export STL says which hidden bodies it left out.
- An outline that crosses or touches itself is explained in plain words.

## 0.32.52 (2026-10-29)

- When the browser's storage is full, a reload still shows your latest changes, Save writes what you see, and changes are stored as soon as there is room.

## 0.32.51 (2026-10-29)

- Pressing Undo or Redo quickly twice no longer leaves extra copies of shapes in memory.

## 0.32.50 (2026-10-29)

- The AI panel no longer downloads the in-browser model's code when the browser can't run it.

## 0.32.49 (2026-10-29)

- On a phone in Safari, tapping just under the Finish bar no longer finishes the sketch by accident.

## 0.32.48 (2026-10-29)

- A Settings page (the gear, behind Menu on a phone) with the keyboard shortcuts and the version.
- A body you name like an old automatic name keeps that name after you reopen the project.

## 0.32.47 (2026-10-29)

- A last project the app couldn't open is tried again on the next reload instead of being replaced by an empty one.
- Two tabs opened together both open your project.

## 0.32.46 (2026-10-29)

- A page left open while a new version went live says the app was updated and offers Reload, which keeps your design, instead of turning every part red.
- If the geometry engine fails to download, the app tries again by itself and then offers Try again.

## 0.32.45 (2026-10-29)

- Long sessions on a phone stay light: opening a new design frees the old panels.

## 0.32.44 (2026-10-29)

- On a phone, a tap on the Finish bar no longer also counts as a tap on the view.

## 0.32.43 (2026-10-29)

- Move has a Snap button: pick a face or edge of the bodies you are moving, then one on another body, and they land there.

## 0.32.42 (2026-10-29)

- Move's arrows and rings are slimmer, with a gentle glow on the one under your pointer or finger.
- A selected body, face or edge is highlighted in blue instead of bright green.
- On a phone, a bar over the 3D view holds a Finish button and Cancel while a tool is open, and Create Sketch offers the XY, XZ and YZ planes there.

## 0.32.40 (2026-10-29)

- On a phone, the Start your design card no longer covers the buttons or the view cube.

## 0.32.39 (2026-10-28)

- A size typed in the panel that is too small or too large is refused in the panel with a short message.

## 0.32.38 (2026-10-28)

- On a phone, sheets close when you drag their handle down.
- Browser and Properties open only as tall as their contents, so one tap never covers most of the view.

## 0.32.37 (2026-10-28)

- The sketch toolbar, the guide and the AI panel share the app's clean look.
- When the geometry engine runs out of memory (it happened on a phone), the app restarts it by itself and rebuilds the design, instead of turning every item red.

## 0.32.36 (2026-10-28)

- Move has drag handles in the view: arrows to slide and rings to turn, with a finger on a phone too.
- Editing a Move shows the bodies where OK will put them as you type or drag.
- Two tabs open on one project no longer lose work: a tab that is out of date says the project changed in another tab.
- The AI preview says when a shape is added as a new body, and the AI can no longer draw shapes outside the sizes the boxes allow.

## 0.32.35 (2026-10-28)

- Move: move and turn bodies by typing distances and angles (M key), with a live preview. A Move is a timeline step you can edit later.
- A cleaner look across the whole app: rounded floating cards, a dark blue backdrop in the 3D view, and a bright blue glow on what you choose.
- On a phone, Undo and Redo are round floating buttons, Browser and Properties are pill buttons over the view, and every sheet has a grab handle.
- An inserted sphere rests on the floor like every other inserted shape.

## 0.32.34 (2026-10-28)

- Hold Ctrl (Cmd on a Mac) while placing a sketch point to put it exactly where you click, with no snapping.
- A Snap button on the sketch toolbar turns snapping on and off, on a phone too.
- Sketch points snap onto a body's edges anywhere along them, and line up with the corners of the face you sketch on.
- Save asks what to call the file and where to put it, and Save As… is in the File menu. Export STL asks too.
- Project files now end in .spindle. Older files still open.

## 0.32.32 (2026-10-28)

- Offline mode is switched off for now and will come back later.
- Tooltips on Extrude's OK and Copy as SVG show their keys.

## 0.32.31 (2026-10-28)

- SpindleLabs has its own address: spindlelabs.app.
- After Download STL, a short note says what was saved, and STL files are named spindlelabs-….
- On a phone, Extrude and Body facts open the Properties sheet by themselves.

## 0.32.30 (2026-10-28)

- Buttons ease their colours on hover and sink a little when pressed. Menus, phone sheets and notices fade in, and every motion switches off when your device asks for reduced motion.
- A shape typed side by side, like an equilateral triangle, now closes on its first corner instead of leaving a second point on top of it.
- A rectangle drawn beside another shares their common side instead of drawing a second line on top of it.
- Pressing Undo straight after a click in a sketch no longer shows a page error or brings the click back.
- On a phone, the AI panel and the Browser or Properties sheet no longer open on top of each other.
- A sketch started with a phone sideways keeps its plane prompt when the phone is turned upright.
- An open dropdown moves with the window when the screen turns or resizes.
- In a narrow window, the AI panel no longer covers the browser rows or the view buttons.
- If the geometry engine fails to download, the app says so in plain words.
- Names in an opened project follow the same rules as Rename, and "Café" typed two different ways counts as the same name.

## 0.32.29 (2026-10-28)

- SpindleLabs works offline: open it once and it keeps itself, so it opens, models and exports STL with no internet. It can be installed like an app, and a note says when a new version is ready.
- With no internet, the AI assistant says its provider can't be reached instead of failing when you ask.
- A centre arc whose end lands on, or almost on, its own start is refused with a note instead of drawing an invisible arc that stopped the sketch from extruding.
- A centre arc ended on a point already on its circle joins that point, so the outline closes there.
- Pressing Enter while a size box is red no longer draws a line to wherever the mouse rests.
- An arc or circle drawn exactly on top of one already there is refused with a note.

## 0.32.28 (2026-10-28)

- On a phone, the Length and Angle boxes no longer cover the corner you just placed or the first corner, so a shape can be closed by tapping its first corner again.

## 0.32.27 (2026-10-28)

- Closing the guide gives its memory back, so long sessions stay light.

## 0.32.26 (2026-10-27)

- On a phone the page no longer scrolls: the 3D view fills the screen, and Browser, Properties and the AI assistant open as sheets over the bottom of it.
- A phone held sideways is usable: the toolbar is one row, so the view keeps more of the screen.
- On a phone, a tap on the part outside a sheet puts the sheet away.
- On a phone in Safari, Edit feature's first size box takes your typing straight away.

## 0.32.25 (2026-10-27)

- A tiny, nearly closed corner far from the origin no longer crashes the app.

## 0.32.24 (2026-10-27)

- Extrude any flat face of a body, no sketch needed.
- Fixed rare cases where a failed geometry step left a body broken or moved.

## 0.32.21 (2026-10-27)

- The AI assistant can rename a timeline item.

## 0.32.20 (2026-10-27)

- The AI assistant can extrude a sketch.

## 0.32.19 (2026-10-26)

- The toolbar shows the tools still to come, greyed and marked Coming soon, so you can see what is on the way.

## 0.32.18 (2026-10-26)

- The AI assistant can draw circles, rectangles and lines in a sketch.

## 0.32.17 (2026-10-26)

- The AI assistant can start a sketch on a plane or on a flat face of a body.
- A progress bar while the AI assistant answers, with its working shown as it is written.

## 0.32.15 (2026-10-26)

- A sketch with two arcs that touch and then cross again just past a corner is refused up front, with both pieces named, instead of failing to extrude.
- Turning a body many times about a far-off point no longer makes it drift.

## 0.32.11 (2026-10-26)

- The AI assistant shows its working, and says plainly when it can't do something instead of guessing.

## 0.32.9 (2026-10-26)

- Keys pressed while a menu is open stay in that menu, and typing a letter jumps to the item that starts with it.

## 0.32.6 (2026-10-26)

- A new Extrude: click a sketch in the view, see a live preview, then drag the arrow or type the distance.
- Body edges are thinner and softer.
- Fixed: the File menu could act on a design that had already been replaced.

## 0.32.5 (2026-10-26)

- The Start fresh box has its proper colours and buttons again.

## 0.32.4 (2026-10-26)

- Body edges are drawn as smooth dark lines, so shapes are easier to read.

## 0.32.1 (2026-10-25)

- A new top bar: File menu, Save, Undo and Redo as icons, and one workspace button.
- A toolbar of icons in groups (Create, Insert, Inspect, Export), each group with its own menu.
- Body facts shows a body's volume, area and faces.
- Icons beside every row in the browser, and an eye on each body to hide or show it.
- The Length and Angle boxes by the pointer stay inside the view near its edges.

## 0.31.5 (2026-10-25)

- Every timeline item has a short name, like Box 1 or Sketch 2, and can be renamed from its menu.

## 0.31.3 (2026-10-25)

- A new project starts empty, with a Start your design card.
- Ready-made shapes moved to an Insert menu. Each one is added as a new body and never changes one already there.

## 0.31.1 (2026-10-24)

- Slimmer browser rows, with Timeline and Origin folded at the start, so a new design fits without scrolling.
- A body can be deleted from its row in the browser.
- On a wide screen the properties panel floats over the view only while it is needed, and folds to a small button otherwise.

## 0.30.8 (2026-10-24)

- The app is now called SpindleLabs. Files saved under its old names still open.

## 0.30.3 (2026-10-24)

- If the geometry engine can't start, the app now says so and asks you to reload, instead of silently stopping.

## 0.27.9 (2026-10-23)

- A drag on the timeline bar can be called off with Escape, a right-click, or by letting go away from the bar.

## 0.27.8 (2026-10-23)

- On a slow phone, tapping a circle and pressing Finish Sketch straight away no longer loses the circle.

## 0.27.7 (2026-10-23)

- Very long, thin curved shapes are much faster to build.

## 0.27.6 (2026-10-23)

- An edit made less than a second before opening another file is no longer lost.

## 0.27.5 (2026-10-23)

- On a phone, the timeline bar keeps its place when you pick an item, and refusals show just above the bar.
- Escape always closes the app's boxes and menus.
- Failed features are shown in red everywhere.

## 0.27.3 (2026-10-23)

- Fixed four problems with projected edges, including a line drawn from a projected point that made the file impossible to open.

## 0.27.2 (2026-10-22)

- Snap a sketch's points onto the corners and edges of any earlier body, on any plane. Snapped points follow that body when it changes.
- The Project tool (key P) brings a body's edges into a sketch as linked curves that follow the body.

## 0.27.1 (2026-10-22)

- Both top corners of a half disc can now be snapped to.

## 0.26.12 (2026-10-22)

- Typing a line's length and angle and pressing Enter quickly no longer places a point in the wrong place.
- An empty, zero or negative size is refused with a message, and the last size comes back.
- Fit now includes a sketch whose face was lost.

## 0.26.9 (2026-10-22)

- A sketch on a face that was moved and then lost its face stays where it last was.
- Sketches after the rollback marker are hidden.
- "Infinity" typed into a size box is refused.

## 0.26.6 (2026-10-22)

- The AI assistant no longer picks a browser's built-in model before it has downloaded.

## 0.26.4 (2026-10-22)

- A small hole close to a long straight side is no longer wrongly refused.

## 0.26.2 (2026-10-21)

- Sketch on the front and side planes, or on any flat face of a body. The face lights up under the pointer and the sketch opens square onto it.
- Flip in the Extrude and Edit feature panels sends an extrude the other way.
- A sketch on a face moves with its face. If the face goes, the sketch stays where it was and says so.
- In a sketch on a face, the pointer snaps onto the face's corners, edge middles and centres, and points placed there follow them when the body changes.
- Suppressing a feature greys everything built on it. Moving a sketch before the feature it sits on is refused, and deleting that feature asks first.
- A privacy and terms page.
- Security improvements.

## 0.26.1 (2026-10-21)

- The Extrude panel offers only sketches it can use, and says why when there are none.
- Fixed: coming back to a design with no body after switching workspaces could add a box you never made.

## 0.25.13 (2026-10-21)

- The AI assistant knows your whole timeline and says where a new body will go.
- Download STL works on any body shown, or several at once in one file.
- A sketch can be copied as SVG.

## 0.25.12 (2026-10-20)

- The camera stops when you let go of an orbit, pan or zoom.

## 0.25.11 (2026-10-20)

- Lines behind a body no longer show through it, and a selected bottom edge stays green over the ground grid.
- A line drawn on top of another line is refused with a note instead of breaking the outline.

## 0.25.10 (2026-10-19)

- The app is renamed Panosolid.

## 0.25.8 (2026-10-19)

- A line and an arc that meet almost in a straight line are no longer refused.
- Edit Sketch reopens a finished sketch, and Finish Sketch rebuilds everything after it.

## 0.25.5 (2026-10-19)

- Fixed a failure when a long side ends in a tiny arc.

## 0.25.4 (2026-10-19)

- Edit feature: change any extrude or ready-made shape from its timeline item.

## 0.25.2 (2026-10-19)

- A feature that failed no longer gets a Body row.

## 0.25.1 (2026-10-19)

- Changes are kept when the page is reloaded or closed straight after an edit.

## 0.25.0 (2026-10-18)

- Security improvements.

## 0.24.13 (2026-10-18)

- Drag a timeline item to a new place, drag the timeline marker, and use the playback buttons. Timeline rows select their body.
- Typed sizes for arc points, and a hint beside the pointer.
- A design with no body left is shown properly, and typing a size or sketching starts a new body.
- Third-party licence notices are published beside the app.
- Save and Open no longer act before your last project has reopened.
- Security improvements.

## 0.24.12 (2026-10-18)

- The app is renamed Panoshape.

## 0.24.11 (2026-10-18)

- The browser's rows float over the view, so your part shows between them.
- Fixed: the properties panel showed the last body instead of the one you selected.

## 0.24.10 (2026-10-18)

- The timeline: delete, reorder and suppress features and move the rollback marker, each one undo step, from a menu on each item.
- Design shows every body.
- A Start fresh button clears the design after asking.
- Deleting a sketch that an extrude uses asks first.
- The guide moves more smoothly and its cards fit the screen.

## 0.24.9 (2026-10-18)

- Type a length and angle while drawing lines, and a width and height for rectangles.
- The centre arc tool. The three arc tools are now under one Arc menu.
- A floating browser, the timeline along the bottom, and a Full screen button.
- An extrude whose sketch is lost keeps its last shape and shows a warning.

## 0.24.8 (2026-10-17)

- Navigation like other CAD apps: the wheel zooms to the pointer, middle-drag pans, Shift and middle-drag orbits, plus a navigation bar and a view cube you can drag.
- The AI assistant picks a working AI by itself.
- A scrolling 3D guide to how Design works.
- Sketches have their own toolbar with Finish Sketch.
- Each solid feature now makes its own body.

## 0.24.6 (2026-10-17)

- Fixed a cap that could come out inside out where a shallow arc meets a straight side.

## 0.24.4 (2026-10-17)

- Fixed a crash with very small triangles in an outline.
- Extruding a part with many holes is about 5 times faster.

## 0.24.3 (2026-10-17)

- Fixed crashes with some unusual outlines, and curved parts draw faster.
- Better answers from the AI assistant.

## 0.24.2 (2026-10-17)

- See what you draw: Look At, axes, the body faded while you sketch, and a grid that follows the zoom.
- Fixed an extrude that could come out inside out at a very sharp corner.

## 0.24.0 (2026-10-17)

- The tangent arc tool (key T), which chains on from the line tool.
- Points now go exactly where you click. Grid snap is a tickbox, off by default.

## 0.23.0 (2026-10-17)

- The 3-point arc tool.
- Sketch snapping to endpoints, midpoints, centres, and horizontal and vertical lines.

## 0.22.0 (2026-10-17)

- Rectangle and circle tools in sketches.

## 0.21.0 (2026-10-17)

- Sketches: create a sketch and draw lines click by click.
- Extrude a closed sketch into a solid.

## 0.20.2 (2026-10-16)

- The AI assistant: use Ollama, your own API key, or a model that runs inside your browser.
- The AI assistant can change your part. Every change is shown as a preview first and undoes in one step.

## 0.20.1 (2026-10-16)

- Undo and Redo keep your selection and camera where they were, and work on phones.

## 0.20.0 (2026-10-16)

- Undo and Redo, with buttons and keyboard keys.

## 0.19.0 (2026-10-16)

- Save and open project files. Your work is kept in the browser and saved automatically.

## 0.18.0 (2026-10-16)

- View controls: Fit, and the view cube.

## 0.17.0 (2026-10-16)

- Select bodies, faces and edges, with highlighting.

## 0.16.0 (2026-10-16)

- The Design workspace: a toolbar, the browser, a properties panel and the 3D view.

## 0.14.1 (2026-10-16)

- The largest part you can make is now 1 km across.

## 0.13.0 (2026-10-16)

- Download your part as an STL file.

## 0.12.0 (2026-10-16)

- Move and rotate a body. Moving a body far away and back loses no accuracy.

## 0.11.3 (2026-10-15)

- A workspace switcher, coming-soon pages for the workspaces still to be built, and a Community page.

## 0.11.0 (2026-10-15)

- A sphere shape.

## 0.10.0 (2026-10-15)

- Arcs and circles in outlines, curved side faces, and a cylinder shape.

## 0.9.2 (2026-10-15)

- Very small and very large sizes are now shown properly.

## 0.9.0 (2026-10-15)

- Extrude outlines with holes in them.

## 0.7.0 (2026-10-15)

- A box, built by SpindleLabs' own geometry engine and shown in 3D.

## 0.0.0 (2026-10-15)

- The first version: a 3D view that runs in your browser.
