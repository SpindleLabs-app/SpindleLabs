export { type AccountConfig, checkConfig } from "./config.ts";
export {
  type AccountState,
  type AuthClient,
  type AuthDeps,
  type Failure,
  type FinishResult,
  type SmallStore,
  type TokenResult,
  authClient,
  PENDING_KEY,
  PENDING_MAX_MS,
  REFRESH_MARGIN_S,
  SESSION_KEY,
} from "./auth.ts";
export { type AccountUser, type Session } from "./session.ts";
export { FAILURE_WORDS, type FinishFailure } from "./words.ts";
export { type PersonReply } from "./auth.ts";
export { accountData, type AccountData, type DataResult, PENDING_EMAIL_KEY, SEEN_EMAIL_KEY } from "./data.ts";
