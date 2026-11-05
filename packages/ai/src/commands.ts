// The AI's only output: its working out in plain words, then commands
// from the public command API, checked before anything is built. Never
// geometry, never coordinates it guessed.

import { commandListSchema, MAX_EXPLANATION, parseCommandList, type Command, type CommandSpec } from "@fission/core";
import { progressOf, waiting, type Progress } from "./progress.ts";
import type { AIProvider, AIRequest } from "./providers.ts";
import { AIError, kindOf, STALL_MS, troubleWords, type TroubleKind } from "./trouble.ts";

/**
 * `explanation` is the model's working out in plain words (docs/ai.md,
 * "Full working out"), or "" when it gave none. No commands with an
 * explanation is an honest "can't do that": the explanation says why.
 * A failure's `error` is in plain words for the panel, never a provider's
 * own text (AI8c); `kind` says what went wrong ("unusable": answers came
 * but neither could be used) and `detail` keeps the provider's words for
 * the console.
 */
export type AskResult =
  | { ok: true; commands: Command[]; explanation: string; attempts: 1 | 2 }
  | { ok: false; error: string; kind: TroubleKind | "unusable"; detail: string };

/**
 * Added to the instructions when an answer was cut off for running too
 * long (AI8c): the second try is asked to be short, so it fits.
 */
export const SHORTER_RULE = "Your last answer was cut off because it was too long. Send only the commands for what the user asked, and keep the explanation to one short sentence.";

/**
 * Whether a working out says the request can't be done: the one reason an
 * answer may send no commands. Plain words a refusal uses ("can't",
 * "cannot", "no command", "not supported"); an answer that only describes
 * a part ("The part will be a box 40 mm wide.") is not one.
 */
export function saysCannot(explanation: string): boolean {
  return /\b(can['’]?t|cannot|can not|unable|not able|not possible|isn['’]t possible|no command|not supported|isn['’]t supported|not available|isn['’]t available)\b/i.test(explanation);
}

/**
 * Asks the provider for commands. With structured output it is held to
 * the generated schema; either way the answer is checked, and a bad one
 * is retried once with the problem explained. A second bad answer fails
 * clearly. Never throws for a bad answer; a provider error is reported too.
 * An answer with no commands must say that the request can't be done
 * (`saysCannot`); otherwise it is a bad answer: small models write a right
 * working out and then close an empty list (AI5c's first evaluation run).
 * With `onProgress`, the answer is streamed and its progress reported
 * (AI5c2): asking, then each piece as it is written, then checking, for
 * each attempt, and stopped when it stalls or runs too long (answerOnce).
 * An answer cut off for its length is asked for again once, shorter
 * (SHORTER_RULE); any other trouble ends it at once, in plain words.
 */
/**
 * One answer from the provider: its text, or what went wrong. Streamed
 * (`onProgress` given), it is watched as it arrives (AI8a, AI8c): once
 * text has started, STALL_MS with nothing new stops it ("stalled"), and a
 * working out longer than MAX_EXPLANATION (which the answer's check would
 * refuse anyway) stops it at once ("cut-off") rather than letting the bar
 * creep towards 90% while it runs on. A stopped answer is aborted
 * (`signal`) and whatever the provider does after that is ignored.
 */
function answerOnce(provider: AIProvider, req: AIRequest, attempt: 1 | 2, onProgress?: (p: Progress) => void): Promise<{ text: string } | { trouble: AIError }> {
  const stop = new AbortController();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (r: { text: string } | { trouble: AIError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ("trouble" in r) stop.abort();
      resolve(r);
    };
    const onText = (soFar: string) => {
      if (settled) return;
      const p = progressOf(soFar, attempt);
      if (p.working.length > MAX_EXPLANATION) return finish({ trouble: new AIError("cut-off", `the working out passed ${MAX_EXPLANATION} characters`) });
      onProgress!(p);
      clearTimeout(timer);
      timer = setTimeout(() => finish({ trouble: new AIError("stalled", `nothing new for ${STALL_MS / 1000} s`) }), STALL_MS);
    };
    provider.complete({ ...req, signal: stop.signal, ...(onProgress ? { onText } : {}) }).then(
      (text) => finish({ text }),
      (e) => finish({ trouble: e instanceof AIError ? e : new AIError(kindOf(e), e instanceof Error ? e.message : String(e)) }),
    );
  });
}

export async function askForCommands(
  provider: AIProvider,
  request: Omit<AIRequest, "jsonSchema" | "onText">,
  specs: readonly CommandSpec[],
  onProgress?: (p: Progress) => void,
): Promise<AskResult> {
  const schema = commandListSchema(specs);
  let req: AIRequest = { ...request, jsonSchema: provider.structuredOutput ? schema : undefined };
  if (!provider.structuredOutput) req = { ...req, system: `${req.system}\n\nAnswer only with JSON matching this schema:\n${JSON.stringify(schema)}` };
  let lastError = "";
  for (const attempt of [1, 2] as const) {
    onProgress?.(waiting("asking", attempt));
    const got = await answerOnce(provider, req, attempt, onProgress);
    if ("trouble" in got) {
      const { kind, message } = got.trouble;
      if (kind === "cut-off" && attempt === 1) {
        req = { ...req, system: `${req.system}\n\n${SHORTER_RULE}` };
        continue;
      }
      return { ok: false, error: troubleWords(kind), kind, detail: message };
    }
    const text = got.text;
    onProgress?.(waiting("checking", attempt));
    const parsed = parseCommandList(text, specs);
    if (parsed.ok && (parsed.commands.length > 0 || saysCannot(parsed.explanation))) return { ok: true, commands: parsed.commands, explanation: parsed.explanation, attempts: attempt };
    lastError = !parsed.ok
      ? parsed.error
      : parsed.explanation === ""
        ? "it has no commands and doesn't say why"
        : "it has no commands, but the explanation doesn't say the request can't be done. If the commands can do it, send them; if not, say plainly what can't be done";
    req = {
      ...req,
      messages: [...req.messages, { role: "assistant", content: text }, { role: "user", content: `That answer can't be used: ${lastError}. Answer again with valid JSON only.` }],
    };
  }
  return { ok: false, error: `The AI's answer couldn't be used, even after one retry: ${lastError}. Nothing was changed.`, kind: "unusable", detail: lastError };
}
