// AI8a and AI8c: an answer that stalls part way is stopped and said in
// words; one that runs too long is stopped, asked again shorter once, and
// then said in words; every provider error reaches the panel as plain words
// of its kind, never the provider's own text. Fake providers and a fake
// clock (node:test's mock timers): nothing talks to a real model.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_EXPLANATION, type CommandSpec } from "@fission/core";
import { AIError, askForCommands, createProvider, kindOf, memoryKeyStore, SHORTER_RULE, STALL_MS, streamLines, troubleWords, type AIProvider, type AIRequest, type TroubleKind } from "../src/index.ts";
import { kindOfStatus } from "../src/trouble.ts";
import { fakeServer, streamServer } from "./fakes.ts";

const specs: CommandSpec[] = [{ op: "set_part", summary: "s", params: { width: { type: "length", description: "w" } } }];
const request = { system: "You edit a CAD part.", messages: [{ role: "user" as const, content: "make it 40 wide" }] };
const good = JSON.stringify({ commands: [{ op: "set_part", width: 40 }], explanation: "The part is 40 mm wide." });
/** Lets promises run (mock timers don't hold setImmediate). */
const flush = () => new Promise((r) => setImmediate(r));

/** A provider that writes `pieces` (the answer so far, one at a time, each when `next` is called) and then never finishes. */
function silentAfter(...first: string[]) {
  const asked: AIRequest[] = [];
  let write: (soFar: string) => void = () => {};
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: (r) => {
      asked.push(r);
      write = r.onText!;
      for (const t of first) r.onText!(t);
      return new Promise(() => {});
    },
  };
  return { provider, asked, write: (t: string) => write(t) };
}

test(`an answer that stops part way is given up after ${STALL_MS / 1000} s with nothing new: at 0.9× still waiting, at 1.1× stopped in plain words (AI8a)`, async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { provider, asked, write } = silentAfter('{"commands":[{"op":"set_part","width":40}],"explanation":"The part');
    let result: Awaited<ReturnType<typeof askForCommands>> | undefined;
    const stages: string[] = [];
    void askForCommands(provider, request, specs, (p) => stages.push(p.stage)).then((r) => (result = r));
    await flush();
    mock.timers.tick(0.9 * STALL_MS);
    await flush();
    assert.equal(result, undefined, "still waiting at 0.9× of the wait");
    // More text restarts the wait: the stall is counted from the last piece, not from the start.
    write('{"commands":[{"op":"set_part","width":40}],"explanation":"The part is');
    mock.timers.tick(0.9 * STALL_MS);
    await flush();
    assert.equal(result, undefined, "0.9× after the newest piece: still waiting");
    mock.timers.tick(0.2 * STALL_MS);
    await flush();
    assert.deepEqual(result, { ok: false, error: troubleWords("stalled"), kind: "stalled", detail: `nothing new for ${STALL_MS / 1000} s` });
    // 30 s, worked by hand from STALL_MS = 30 000 ms; the words say what happened and that nothing changed.
    assert.equal(troubleWords("stalled"), "The AI stopped partway through its answer: nothing new arrived for 30 s, so SpindleLabs stopped waiting. Nothing was changed.");
    assert.equal(asked.length, 1, "a stall is told to the user, not asked again on its own");
    assert.equal(asked[0].signal?.aborted, true, "the provider is told to stop");
    assert.ok(!stages.includes("checking"), "nothing was checked");
    // A piece arriving after the stop is ignored: nothing more is reported.
    const before = stages.length;
    write('{"commands":[{"op":"set_part","width":40}],"explanation":"The part is 40');
    assert.equal(stages.length, before);
  } finally {
    mock.timers.reset();
  }
});

test("before the first words the stall wait doesn't run: the provider's own time limit covers that (a model may take a minute to load)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { provider } = silentAfter();
    let result: unknown;
    void askForCommands(provider, request, specs, () => {}).then((r) => (result = r));
    await flush();
    mock.timers.tick(10 * STALL_MS);
    await flush();
    assert.equal(result, undefined);
  } finally {
    mock.timers.reset();
  }
});

test("an answer that ends is used, and its stall wait is cleared (no stop later)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const asked: AIRequest[] = [];
    const provider: AIProvider = { kind: "ollama", structuredOutput: true, check: async () => ({ ok: true }), complete: async (r) => (asked.push(r), r.onText!(good), good) };
    const r = await askForCommands(provider, request, specs, () => {});
    assert.equal(r.ok, true);
    mock.timers.tick(2 * STALL_MS);
    assert.equal(asked[0].signal?.aborted, false, "a finished answer is never aborted");
  } finally {
    mock.timers.reset();
  }
});

/** The answer so far with a working out `n` characters long, still being written. */
const writing = (n: number) => `{"commands":[{"op":"set_part","width":40}],"explanation":"${"a".repeat(n)}`;

test(`a working out running past ${MAX_EXPLANATION} characters is stopped as it is written and asked again shorter: ${0.9 * MAX_EXPLANATION} goes on, ${1.1 * MAX_EXPLANATION} is stopped (AI8c)`, async () => {
  const asked: AIRequest[] = [];
  const answers = [writing(1.1 * MAX_EXPLANATION), good];
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: (r) => {
      asked.push(r);
      const a = answers.shift()!;
      r.onText!(writing(0.9 * MAX_EXPLANATION));
      if (a === good) {
        r.onText!(good);
        return Promise.resolve(good);
      }
      assert.equal(r.signal?.aborted, false, `${0.9 * MAX_EXPLANATION} characters: still going`);
      r.onText!(a);
      assert.equal(r.signal?.aborted, true, `${1.1 * MAX_EXPLANATION} characters: stopped there and then`);
      return new Promise(() => {}); // a runaway model never finishes by itself
    },
  };
  const r = await askForCommands(provider, request, specs, () => {});
  assert.deepEqual(r, { ok: true, commands: [{ op: "set_part", width: 40 }], explanation: "The part is 40 mm wide.", attempts: 2 });
  assert.equal(asked.length, 2);
  assert.ok(!asked[0].system.includes(SHORTER_RULE));
  assert.ok(asked[1].system.endsWith(`\n\n${SHORTER_RULE}`), "the second try is asked to be short");
});

test("cut off twice: plain words with no provider text, asked exactly twice", async () => {
  const asked: AIRequest[] = [];
  const provider: AIProvider = {
    kind: "api-key",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: async (r) => {
      asked.push(r);
      throw new AIError("cut-off", "Anthropic's API: the answer reached the provider's output limit");
    },
  };
  const r = await askForCommands(provider, request, specs, () => {});
  assert.deepEqual(r, { ok: false, error: troubleWords("cut-off"), kind: "cut-off", detail: "Anthropic's API: the answer reached the provider's output limit" });
  assert.equal(asked.length, 2);
});

test("Ben's raw error ('The response exceeded output limits and was truncated.') is a cut-off: asked again shorter, never shown", async () => {
  const BEN = "The response exceeded output limits and was truncated.";
  assert.equal(kindOf(new Error(BEN)), "cut-off");
  const answers: (string | Error)[] = [new Error(BEN), new Error(BEN)];
  const provider: AIProvider = {
    kind: "browser-built-in",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: async () => {
      const a = answers.shift()!;
      if (a instanceof Error) throw a;
      return a;
    },
  };
  const r = await askForCommands(provider, request, specs);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && !r.error.includes("exceeded") && !r.error.includes("truncated"), "the provider's words stay out of the panel");
  assert.ok(!r.ok && r.kind === "cut-off" && r.detail === BEN);
  assert.equal(answers.length, 0, "asked twice");
});

test("every kind of provider error: the panel's words are its kind's, never the provider's; only a cut-off is asked again", async () => {
  const RAW = "RAW provider words: quota_exceeded_by_xyz";
  const kinds: TroubleKind[] = ["stalled", "cut-off", "unreachable", "timeout", "key", "busy", "declined", "failed"];
  const words = new Set<string>();
  for (const kind of kinds) {
    let asked = 0;
    const provider: AIProvider = {
      kind: "api-key",
      structuredOutput: true,
      check: async () => ({ ok: true }),
      complete: async () => {
        asked++;
        throw new AIError(kind, RAW);
      },
    };
    const r = await askForCommands(provider, request, specs);
    assert.ok(!r.ok, kind);
    if (r.ok) continue;
    assert.equal(r.kind, kind);
    assert.equal(r.error, troubleWords(kind));
    assert.ok(!r.error.includes("RAW") && !r.error.includes("xyz"), `${kind}: no provider text`);
    assert.equal(r.detail, RAW, `${kind}: the provider's words kept for the console`);
    assert.equal(asked, kind === "cut-off" ? 2 : 1, kind);
    words.add(r.error);
  }
  assert.equal(words.size, kinds.length, "each kind has its own words");
  // A plain error (not an AIError) with no cut-off words is "failed".
  assert.equal(kindOf(new Error("socket hang up")), "failed");
  assert.equal(kindOf("a string"), "failed");
});

test("a refusal's kind from its status, worked by hand: 401 and 403 the key, 429 and 529 busy, a 400 about max_tokens cut off, else failed", () => {
  assert.equal(kindOfStatus(401, "invalid x-api-key"), "key");
  assert.equal(kindOfStatus(403, "forbidden"), "key");
  assert.equal(kindOfStatus(429, "rate limited"), "busy");
  assert.equal(kindOfStatus(529, "overloaded"), "busy");
  assert.equal(kindOfStatus(400, "max_tokens: 99999 > 8192, which is the maximum allowed"), "cut-off");
  assert.equal(kindOfStatus(400, "messages: field required"), "failed");
  assert.equal(kindOfStatus(500, "internal error"), "failed");
});

// ---------- the providers say which kind ----------

const KEY = "sk-ant-api03-trouble";
const keys = () => {
  const k = memoryKeyStore();
  k.set("https://api.anthropic.com", KEY);
  k.set("https://api.openai.com", "sk-proj-trouble");
  return k;
};
const kindOfRejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return kindOf(e);
  }
  return "resolved";
};
const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`);

test("each provider reports its output limit as a cut-off: Anthropic's max_tokens, OpenAI's length, Ollama's length, whole or streamed", async () => {
  const ant = createProvider({ kind: "api-key", vendor: "anthropic", model: "m" }, { fetch: streamServer(() => ({ chunks: sse({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"comm' } }, { type: "message_delta", delta: { stop_reason: "max_tokens" } }) })).fetch, keys: keys() });
  assert.equal(await kindOfRejection(ant.complete({ ...request, onText: () => {} })), "cut-off");
  const antWhole = createProvider({ kind: "api-key", vendor: "anthropic", model: "m" }, { fetch: fakeServer(() => ({ json: { stop_reason: "max_tokens", content: [{ type: "text", text: '{"comm' }] } })).fetch, keys: keys() });
  assert.equal(await kindOfRejection(antWhole.complete(request)), "cut-off");
  const oai = createProvider({ kind: "api-key", vendor: "openai", model: "m" }, { fetch: streamServer(() => ({ chunks: sse({ choices: [{ delta: { content: '{"c' } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }) })).fetch, keys: keys() });
  assert.equal(await kindOfRejection(oai.complete({ ...request, onText: () => {} })), "cut-off");
  const oaiWhole = createProvider({ kind: "api-key", vendor: "openai", model: "m" }, { fetch: fakeServer(() => ({ json: { choices: [{ finish_reason: "length", message: { content: '{"c' } }] } })).fetch, keys: keys() });
  assert.equal(await kindOfRejection(oaiWhole.complete(request)), "cut-off");
  const ollama = createProvider({ kind: "ollama", model: "m" }, { fetch: streamServer(() => ({ chunks: ['{"message":{"content":"{\\"c"},"done":false}\n', '{"message":{"content":""},"done":true,"done_reason":"length"}\n'] })).fetch });
  assert.equal(await kindOfRejection(ollama.complete({ ...request, onText: () => {} })), "cut-off");
  const ollamaWhole = createProvider({ kind: "ollama", model: "m" }, { fetch: fakeServer(() => ({ json: { message: { content: '{"c' }, done_reason: "length" } })).fetch });
  assert.equal(await kindOfRejection(ollamaWhole.complete(request)), "cut-off");
  // A finished answer is not one: stop_reason tool_use, finish_reason stop, done_reason stop.
  const done = createProvider({ kind: "ollama", model: "m" }, { fetch: fakeServer(() => ({ json: { message: { content: good }, done_reason: "stop" } })).fetch });
  assert.equal(await done.complete(request), good);
  const finished = createProvider({ kind: "api-key", vendor: "openai", model: "m" }, { fetch: fakeServer(() => ({ json: { choices: [{ finish_reason: "stop", message: { content: good } }] } })).fetch, keys: keys() });
  assert.equal(await finished.complete(request), good);
});

test("a request's trouble has its kind: unreachable, the key refused, busy, a timeout, and the user's no passed on as it is", async () => {
  const down = createProvider({ kind: "ollama", model: "m" }, { fetch: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(await kindOfRejection(down.complete(request)), "unreachable");
  const badKey = createProvider({ kind: "api-key", vendor: "anthropic", model: "m" }, { fetch: fakeServer(() => ({ status: 401, json: { error: { message: "invalid x-api-key" } } })).fetch, keys: keys() });
  assert.equal(await kindOfRejection(badKey.complete({ ...request, onText: () => {} })), "key");
  const busy = createProvider({ kind: "api-key", vendor: "openai", model: "m" }, { fetch: fakeServer(() => ({ status: 429, json: { error: { message: "You exceeded your current quota" } } })).fetch, keys: keys() });
  assert.equal(await kindOfRejection(busy.complete(request)), "busy");
  const no = createProvider({ kind: "api-key", vendor: "anthropic", model: "m" }, { fetch: async () => { throw new AIError("declined", "you chose not to send it, so nothing was sent"); }, keys: keys() });
  assert.equal(await kindOfRejection(no.complete({ ...request, onText: () => {} })), "declined");
  const slow = streamServer(() => ({ chunks: ["{}\n"], stall: true }));
  assert.equal(await kindOfRejection(streamLines({ fetch: slow.fetch, url: "http://x.test", body: {}, timeoutMs: 20, who: "X" }, () => {})), "timeout");
});

test("a request stops when its signal aborts (the panel stopped waiting), and one already aborted is never left running", async () => {
  const server = streamServer(() => ({ chunks: ['{"message":{"content":"{"}}\n'], stall: true }));
  const stop = new AbortController();
  const lines: string[] = [];
  const reading = streamLines({ fetch: server.fetch, url: "http://x.test", body: {}, timeoutMs: 60_000, who: "X", signal: stop.signal }, (l) => (lines.push(l), stop.abort()));
  await assert.rejects(reading);
  assert.equal(lines.length, 1);
  const already = new AbortController();
  already.abort();
  await assert.rejects(streamLines({ fetch: server.fetch, url: "http://x.test", body: {}, timeoutMs: 60_000, who: "X", signal: already.signal }, () => {}));
});
