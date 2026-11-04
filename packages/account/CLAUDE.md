# Account

Contents of `packages/account`: optional sign-in. The rules are in packages/CLAUDE.md and the root CLAUDE.md. Accounts are optional forever: nothing in CAD or slicing may ever wait for, or depend on, an account or the network. Keep this list current when you add or change a file here.

- `config.ts`: `checkConfig` checks the account service's address (https, or http only on this computer for tests; no path, query or user name), its public key and the app's return address. With no config the app has no sign-in and contacts nothing.
- `pkce.ts`: the RFC 7636 secret and its S256 challenge (checked against the RFC's own worked example).
- `session.ts`: the session kept in localStorage and the checks on every token reply. Only the user's id, email and name are kept (no picture); a damaged or wrongly shaped value is refused whole.
- `auth.ts`: `authClient(deps)`: `state()` (no network), `beginSignIn()` (the Google sign-in address), `finishSignIn(pageUrl)` (swaps the returned code once, refuses a code with no matching secret from this browser or one older than 10 minutes, and gives the address without the code), `accessToken()` (refreshes within 60 s of running out; a refused refresh signs this browser out; offline keeps the session), `signOut()` (local at once, then ends this session at the service). Plain fetch, no library; never throws.
- Tests: `test/fake-service.ts` fakes the service's four requests with its own SHA-256, so PKCE is checked independently; `test/auth.test.ts` covers forgery, cancelling, reuse, the 0.9×/1.1× boundaries of both time limits, every failure kind, broken storage, two tabs refreshing, and 60 seeded sessions against a plain model.
