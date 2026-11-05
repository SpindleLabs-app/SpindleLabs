// What can go wrong while the AI answers, sorted into kinds, each with the
// words the panel shows (AI8a, AI8c). The panel never shows a provider's
// own error text ("The response exceeded output limits and was
// truncated." reached it raw, Ben 2026-11-03): a provider's words can be
// in any language, name things the user never chose, or echo the request.
// They are kept in `detail`, for the browser's console only.

/**
 * - stalled: the answer had started, then nothing new arrived for STALL_MS.
 * - cut-off: the answer was cut short (the provider's output limit) or ran past what can be used (a working out over MAX_EXPLANATION).
 * - unreachable: the request never got there (offline, Ollama not running).
 * - timeout: no whole answer within the provider's time limit.
 * - key: the provider refused the API key (HTTP 401 or 403).
 * - busy: too many requests, or the account is out of credit (HTTP 429, 529).
 * - declined: the user chose not to send it.
 * - failed: anything else the provider reported.
 */
export type TroubleKind = "stalled" | "cut-off" | "unreachable" | "timeout" | "key" | "busy" | "declined" | "failed";

/** An error of a known kind. `message` is the detail (it may hold a provider's own words): never shown in the panel. */
export class AIError extends Error {
  readonly kind: TroubleKind;
  constructor(kind: TroubleKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Provider words that mean the answer was cut short by its output limit,
 * where a provider says so only in words (an error event, the browser's
 * built-in model): "exceeded output limits", "max_tokens", "maximum
 * length", "truncated", "too long", "context length".
 */
const CUT_OFF_WORDS = /output limit|max[_ ]?tokens|maximum (output )?length|truncat|too long|context (length|window)/i;

/** The kind of any thrown value: an AIError's own, a cut-off said in words, else "failed". */
export function kindOf(e: unknown): TroubleKind {
  if (e instanceof AIError) return e.kind;
  const message = e instanceof Error ? e.message : String(e);
  return CUT_OFF_WORDS.test(message) ? "cut-off" : "failed";
}

/** The kind for a refused request's HTTP status and the provider's own words. */
export function kindOfStatus(status: number, words: string): TroubleKind {
  if (status === 401 || status === 403) return "key";
  if (status === 429 || status === 529) return "busy";
  return CUT_OFF_WORDS.test(words) ? "cut-off" : "failed";
}

/** How long an answer that has started may go with nothing new before the panel stops waiting (AI8a). Even a slow model on a laptop's processor writes a word every second or two. */
export const STALL_MS = 30_000;

const NOTHING = "Nothing was changed.";

/** What the panel says for each kind: plain words, what to do next, never a provider's own text. */
export function troubleWords(kind: TroubleKind): string {
  switch (kind) {
    case "stalled":
      return `The AI stopped partway through its answer: nothing new arrived for ${STALL_MS / 1000} s, so SpindleLabs stopped waiting. ${NOTHING}`;
    case "cut-off":
      return `The AI's answer ran too long and was cut off before it finished, even when it was asked again for a shorter one. Try asking for one thing at a time. ${NOTHING}`;
    case "unreachable":
      return `Couldn't reach the AI. Check that it is running, or that you are online, with Check in the AI settings. ${NOTHING}`;
    case "timeout":
      return `The AI took too long to answer, so SpindleLabs stopped waiting. ${NOTHING}`;
    case "key":
      return `The AI provider didn't accept your API key. Check the key in the AI settings. ${NOTHING}`;
    case "busy":
      return `The AI provider is busy, or your account has reached its limit. Wait a minute, then try again. ${NOTHING}`;
    case "declined":
      return "You chose not to send it, so nothing was sent.";
    case "failed":
      return `The AI provider couldn't answer this time. ${NOTHING}`;
  }
}
