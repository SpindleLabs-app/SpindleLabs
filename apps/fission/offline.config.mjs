// The one switch for offline mode for everyone (the installable,
// offline-capable app: service worker, install prompt, "new version is
// ready" notice). Off until it is released (around fillets): flip
// OFFLINE_MODE to true and nothing else needs to change. While it is off a
// person can still choose it for their own browser with `?offline`
// (src/offline-switch.ts; Ben 2026-11-13, for a school web filter). SPINDLE_OFFLINE=1 at build time turns it on without
// editing this file (the offline browser check builds that way).
export const OFFLINE_MODE = process.env.SPINDLE_OFFLINE === "1" || false;
