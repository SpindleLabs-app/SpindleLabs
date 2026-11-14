fix

- Closing or reloading the page while an OK is still being checked (a Combine, Extrude, Edit or Move) now asks before going, instead of going without a word and opening without that step (SL #708 item 1); a saved page with nothing waiting still goes without asking. Checked by e2e/ok-then-leave.mjs, which failed before the fix.

public:
- Closing or reloading the page straight after pressing OK no longer loses that step without warning: the browser asks first.
