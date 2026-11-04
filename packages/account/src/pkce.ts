// PKCE (RFC 7636): how a page with no server keeps a sign-in code useless to
// anyone else. Before going to the sign-in page the app makes a random secret
// (the verifier) and sends only its SHA-256 hash (the challenge). The code
// that comes back can be swapped for a session only together with the
// verifier, which never leaves this browser.

/** Bytes of randomness in a verifier: 32 bytes gives 43 base64url characters, the shortest RFC 7636 allows. */
export const VERIFIER_BYTES = 32;

/** RFC 7636 section 4.1: 43 to 128 characters from A-Z a-z 0-9 - . _ ~ */
const VERIFIER_SHAPE = /^[A-Za-z0-9\-._~]{43,128}$/;

/** True when `v` is a verifier RFC 7636 allows. */
export function isVerifier(v: unknown): v is string {
  return typeof v === "string" && VERIFIER_SHAPE.test(v);
}

/** Base64url without padding (RFC 4648 section 5), as RFC 7636 uses. */
export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new verifier from `random` (crypto.getRandomValues in the browser; a seeded one in tests). */
export function newVerifier(random: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  random(bytes);
  return base64url(bytes);
}

/** The S256 challenge for `verifier`: base64url(SHA-256(ASCII(verifier))). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
