fix

- Lost-work hunt, account sync (issue #628): an app update no longer makes every project look changed, so a device that was only behind makes no "(copy)" and nothing is sent again without a change.
- A project changed here after its design was deleted from the account is named in My designs, each time, instead of silently staying out of the account.
- When the account service ends the session, a notice at the foot of the page says changes are no longer kept in the account, with a Sign in button, and the account button stops showing the name.

public:
- After an app update, My designs no longer fills with "(copy)" designs nobody changed.
- My designs says when a design you are still changing was deleted from your account.
- If you get signed out, the app now tells you that your changes are no longer kept in your account.
