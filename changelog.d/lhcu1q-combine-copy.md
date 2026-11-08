fix

- Combine (still behind `?combine`): a body made by a Combine can now be duplicated and mirrored; the copy follows the original when an earlier step changes, and sketches and points on it follow too.
- A copy of a piece left by a Combine no longer stops the file opening once the Combine is deleted.
- Changing an extrude that cut a body in two back to a new body is refused while a copy uses one of its pieces, instead of leaving a file that won't open.

public:
- Changing an extrude back to a new body while a copy uses a piece it cut no longer leaves a file that won't open; you're told what to change first.
