// What the app says when a sign-in doesn't finish, in plain words, for every
// reason auth.ts can give. The Record type makes a new reason without words a
// type error.

import type { FinishResult } from "./auth.ts";

export type FinishFailure = Extract<FinishResult, { kind: "failed" }>["reason"];

export const FAILURE_WORDS: Readonly<Record<FinishFailure, string>> = {
  cancelled: "Sign-in was cancelled. You can carry on without an account.",
  expired: "That sign-in took too long or was started in another browser. Please try again.",
  offline: "Couldn't reach the sign-in service. Check your internet connection and try again.",
  unavailable: "The sign-in service is having trouble right now. Please try again in a few minutes.",
  rejected: "The sign-in service didn't accept that sign-in. Please try again.",
  malformed: "The sign-in service gave an answer SpindleLabs didn't understand. Please try again later.",
  storage: "This browser wouldn't keep the sign-in (private browsing, or site storage turned off).",
};
