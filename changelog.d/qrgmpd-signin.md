fix

- Signing out while the app was renewing the sign-in in the background no longer signs the person straight back in, and a late renewal in one tab can no longer replace a different person's sign-in made in another tab.
- A computer clock that is slow or fast no longer leaves the account stuck after the first hour or renewing on every request; a request the service refuses as unauthorised is renewed once and tried again.
- A Google name whose 100th character is a space no longer signs the person out the moment sign-in finishes.
- Two requests or two tabs needing a renewal at the same moment now share one, so neither is told it is signed out.
- Starting a sign-in in two tabs, or pressing Sign in again after going back, no longer makes the sign-in fail.
- Signing out the day after signing in now ends the session at the sign-in service too, and when it can't, the message says why without claiming the session ends by itself.
- A problem at the sign-in service on the way back is reported as the service's trouble, not as "Sign-in was cancelled", including when the service gives it after the # in the address.

public:
- Signing out while your designs or settings are being sent no longer signs you back in.
- Your account keeps working after the first hour even when your computer's clock is off.
- People whose Google name is very long can sign in again.
- Signing in from two tabs at once, or trying again after going back, now works.
- Signing out the next day now fully ends the session, and the message says what happened.
- A problem at the sign-in service is no longer shown as "Sign-in was cancelled".
