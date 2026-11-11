fix

- My designs: a design saved with an impossible save time (not a real time, or more than a day ahead of the account's clock) is now refused like a file too big to keep, instead of being kept and then making every later save over it fail.
- My designs: a design already holding such a time can be saved over again.
- My designs: a save over a design that names no revision is now answered "changed since", never "deleted", so the design is not mistaken for one deleted from the account.

public:
- My designs: a design saved on a device whose date is more than a day ahead is not kept in the account until the date is put right.
