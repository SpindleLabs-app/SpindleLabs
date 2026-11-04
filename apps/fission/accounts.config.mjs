// The one switch for optional accounts (sign in with Google), on since the
// privacy policy covering accounts went live. With it off, the build holds
// no account code at all and contacts no account service. SPINDLE_ACCOUNTS=1
// or SPINDLE_ACCOUNTS=0 at build time overrides it, with SPINDLE_ACCOUNT_URL and
// SPINDLE_ACCOUNT_KEY naming another service (e2e/account.mjs builds that way
// against a fake one). The service is SpindleLabs' Supabase project, in Sydney.
// The key is the service's public key: what each person may read is enforced
// by the service, never by keeping this key secret.
export const ACCOUNTS = process.env.SPINDLE_ACCOUNTS !== "0";
export const ACCOUNT_SERVICE = {
  url: process.env.SPINDLE_ACCOUNT_URL ?? "https://lowohzkaxhtlpfdnfaol.supabase.co",
  anonKey: process.env.SPINDLE_ACCOUNT_KEY ?? "sb_publishable_iRK2HuxI_vCdkf9y0fbmgA_n3y_HB8H",
};
