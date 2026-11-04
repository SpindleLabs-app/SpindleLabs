import { test } from "node:test";
import assert from "node:assert/strict";
import { base64url, challengeFor, isVerifier, newVerifier } from "../src/pkce.ts";

test("RFC 7636 appendix B: the published bytes give the published verifier and challenge", async () => {
  // Worked in the RFC itself (independent of this code): these 32 octets, base64url-encoded, are the verifier, and
  // base64url(SHA-256(verifier)) is the challenge.
  const octets = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
  const verifier = newVerifier((b) => b.set(octets));
  assert.equal(verifier, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(await challengeFor(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("base64url swaps + and / and drops the padding", () => {
  // By hand: 0xFB 0xFF = 11111011 11111111 -> 6-bit groups 111110 111111 1111(00) = 62, 63, 60 -> standard "+/8=".
  // base64url writes 62 as "-" and 63 as "_" and drops "=": "-_8".
  assert.equal(base64url(new Uint8Array([0xfb, 0xff])), "-_8");
  assert.equal(base64url(new Uint8Array([])), "");
});

test("verifier length: 43 and 128 characters are allowed, 42 and 129 are not", () => {
  assert.equal(isVerifier("a".repeat(42)), false);
  assert.equal(isVerifier("a".repeat(43)), true);
  assert.equal(isVerifier("a".repeat(128)), true);
  assert.equal(isVerifier("a".repeat(129)), false);
  assert.equal(isVerifier("a".repeat(42) + "+"), false); // "+" is not an unreserved character
  assert.equal(isVerifier("a".repeat(42) + "~"), true);
  assert.equal(isVerifier(undefined), false);
  assert.equal(isVerifier(43), false);
});

test("a new verifier is always one RFC 7636 allows", () => {
  for (let seed = 0; seed < 200; seed++) {
    let s = seed;
    const v = newVerifier((b) => { for (let i = 0; i < b.length; i++) b[i] = (s = (s * 1103515245 + 12345) >>> 0) >>> 24; });
    assert.ok(isVerifier(v), v);
  }
});
