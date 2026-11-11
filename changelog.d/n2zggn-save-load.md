fix

- A tab told the project changed in another tab now keeps its own edit as a "(kept copy)" when reloaded, instead of losing it.
- A project deleted in one tab is no longer stored again by another tab that still has it open, and a delete cut short no longer leaves a project in the list that can't be opened.
- Storage error messages no longer show internal names.
- Project files with an impossible body counter, two preset shapes sharing one outline, or a preset outline size outside 0.001 mm to 1 km are now refused or fail as that one item, instead of opening and going wrong later (a size typed for one shape changing another, or a mirrored body).
- A STEP file starting with a comment is recognised as STEP.

public:
- When the same project is open in two tabs, a change made in the older tab is kept as a separate copy instead of being lost on reload.
- A project deleted in one tab stays deleted even if another tab has it open.
- Damaged or hand-edited project files are refused clearly instead of opening and going wrong later.
