// The one switch for optional accounts (sign in with Google). Off until the
// privacy policy that covers accounts is live: with it off, the build holds
// no account code at all and contacts no account service. SPINDLE_ACCOUNTS=1
// at build time turns it on, with SPINDLE_ACCOUNT_URL and SPINDLE_ACCOUNT_KEY
// naming the service (e2e/account.mjs builds that way against a fake one).
// The key is the service's public key: what each person may read is enforced
// by the service, never by keeping this key secret.
export const ACCOUNTS = process.env.SPINDLE_ACCOUNTS === "1" || false;
export const ACCOUNT_SERVICE = {
  url: process.env.SPINDLE_ACCOUNT_URL ?? "",
  anonKey: process.env.SPINDLE_ACCOUNT_KEY ?? "",
};
