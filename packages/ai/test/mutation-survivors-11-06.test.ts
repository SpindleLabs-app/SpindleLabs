// Tests written to kill the mutants StrykerJS found surviving in the AI
// assistant on the 2026-11-06 nightly (issues #391 to #396). Each test names
// the change to the code it catches. Mutants no caller can tell apart are
// listed, with the reason, in packages/testing/stryker/explained.json.
// Nothing here talks to a network: every reply comes from a stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_EXPLANATION, type CommandSpec } from "@fission/core";
import { AIError, askForCommands, systemPrompt, type AIProvider } from "../src/index.ts";
import { anthropicStream } from "../src/hosted.ts";
import { requestJson, streamLines, type PostOptions } from "../src/http.ts";
import { builtInProvider, inBrowserProvider, type BuiltInModelLike, type GpuLike, type WebLLMLike } from "../src/local.ts";
import { ollamaProvider } from "../src/ollama.ts";
import { fakeServer, streamServer } from "./fakes.ts";

const specs: CommandSpec[] = [{ op: "set_part", summary: "s", params: { width: { type: "length", description: "w" } } }];
const request = { system: "You edit a CAD part.", messages: [{ role: "user" as const, content: "make it 40 wide" }] };
const ask = { system: "S", messages: [{ role: "user" as const, content: "hi" }] };

/** An AbortController whose signal records every listener added and removed. */
function watchedSignal() {
  const c = new AbortController();
  const added: [string, unknown][] = [];
  const removed: [string, unknown][] = [];
  const add = c.signal.addEventListener.bind(c.signal);
  const remove = c.signal.removeEventListener.bind(c.signal);
  c.signal.addEventListener = ((type: string, f: EventListener, o?: AddEventListenerOptions) => {
    added.push([type, f]);
    add(type, f, o);
  }) as typeof c.signal.addEventListener;
  c.signal.removeEventListener = ((type: string, f: EventListener) => {
    removed.push([type, f]);
    remove(type, f);
  }) as typeof c.signal.removeEventListener;
  return { c, added, removed };
}

// ---------- commands.ts (#391) ----------

/** The answer so far with a working out `n` characters long, still being written. */
const writing = (n: number) => `{"commands":[{"op":"set_part","width":40}],"explanation":"${"a".repeat(n)}`;

test(`a working out of exactly ${MAX_EXPLANATION} characters goes on; one more is stopped`, async () => {
  // Kills `p.working.length > MAX_EXPLANATION` => `>=`.
  // Worked by hand: the limit is "at most MAX_EXPLANATION" (core's check refuses only length > MAX), so
  // MAX characters is allowed and MAX + 1 is the first length that is stopped.
  const seen: boolean[] = [];
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: (r) => {
      r.onText!(writing(MAX_EXPLANATION));
      seen.push(r.signal!.aborted);
      r.onText!(writing(MAX_EXPLANATION + 1));
      seen.push(r.signal!.aborted);
      return new Promise(() => {});
    },
  };
  await askForCommands(provider, request, specs, () => {});
  assert.deepEqual(seen, [false, true, false, true], "each of the two tries: going at MAX, stopped at MAX + 1");
});

test("a working out that runs on twice is reported with how long it may be", async () => {
  // Kills the message `the working out passed ${MAX_EXPLANATION} characters` => "".
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: (r) => {
      r.onText!(writing(MAX_EXPLANATION + 1));
      return new Promise(() => {});
    },
  };
  const r = await askForCommands(provider, request, specs, () => {});
  assert.ok(!r.ok);
  assert.equal(r.kind, "cut-off");
  assert.equal(r.detail, `the working out passed ${MAX_EXPLANATION} characters`);
});

// ---------- hosted.ts (#392) ----------

const post = (chunks: string[]): PostOptions => ({ fetch: streamServer(() => ({ chunks })).fetch, url: "https://api.test/v1", body: {}, timeoutMs: 1000, who: "Test API" });
const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const textDelta = (text: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });

test("Anthropic stream: max_tokens is a cut-off only on a message_delta event, said in plain words", async () => {
  // Kills `e.type === "message_delta"` => true and the cut-off message => "".
  const other = { type: "message_start", delta: { stop_reason: "max_tokens" } };
  assert.equal(await anthropicStream(post([sse(textDelta("ab"), other)]), () => {}), "ab");
  await assert.rejects(anthropicStream(post([sse(textDelta("ab"), { type: "message_delta", delta: { stop_reason: "max_tokens" } })]), () => {}), (e: unknown) => {
    assert.ok(e instanceof AIError);
    assert.equal(e.kind, "cut-off");
    assert.equal(e.message, "the answer reached the provider's output limit");
    return true;
  });
});

test("Anthropic stream: a message_delta event with no delta is skipped", async () => {
  // Kills `(e.delta …)?.stop_reason` => `(e.delta …).stop_reason` (reading stop_reason of undefined would throw).
  assert.equal(await anthropicStream(post([sse(textDelta("ab"), { type: "message_delta" }, textDelta("c"))]), () => {}), "abc");
});

// ---------- http.ts (#393) ----------

test("a request stopped before it starts is never sent, and says so as a stalled answer", async () => {
  // Kills "stalled" => "" and its message => "".
  const c = new AbortController();
  c.abort();
  const o: PostOptions = { fetch: async () => assert.fail("nothing is sent"), url: "https://api.test/v1", body: {}, timeoutMs: 1000, who: "Test API", signal: c.signal };
  await assert.rejects(requestJson(o), (e: unknown) => {
    assert.ok(e instanceof AIError);
    assert.equal(e.kind, "stalled");
    assert.equal(e.message, "the request to Test API was stopped before it was sent");
    return true;
  });
});

test("a reply that isn't JSON is a plain error, not one of the provider error kinds", async () => {
  // Kills `e instanceof AIError` => true in the reply's catch (it would turn the plain Error into an AIError of no kind).
  const o: PostOptions = { fetch: fakeServer(() => ({ text: "hello" })).fetch, url: "https://api.test/v1", body: {}, timeoutMs: 1000, who: "Test API" };
  await assert.rejects(requestJson(o), (e: unknown) => {
    assert.ok(e instanceof Error && !(e instanceof AIError), String(e));
    assert.equal(e.message, "Test API sent a reply that isn't JSON: hello");
    return true;
  });
});

test("a request takes its listener off the caller's signal when it ends", async () => {
  // Kills removeEventListener("abort", …) => removeEventListener("", …).
  const w = watchedSignal();
  await streamLines({ ...post(["a\n"]), signal: w.c.signal }, () => {});
  assert.equal(w.added.length, 1);
  assert.equal(w.added[0][0], "abort");
  assert.deepEqual(w.removed, w.added);
});

// ---------- local.ts (#394) ----------

const gpu = {
  requestAdapter: async () => ({ features: new Set(["shader-f16"]), limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 } }),
} as unknown as GpuLike;
const model = { model_id: "Small-q4f16_1-MLC", model: "https://models.test/Small/", model_lib: "https://models.test/Small.wasm", vram_required_MB: 100, low_resource_required: true };
const engine = (reply: unknown, interrupt?: () => void): WebLLMLike => ({
  prebuiltAppConfig: { model_list: [model] },
  async CreateMLCEngine() {
    return { chat: { completions: { create: async () => reply as never } }, ...(interrupt ? { interruptGenerate: interrupt } : {}) };
  },
});
const inBrowser = (webllm: WebLLMLike) => inBrowserProvider({ model: model.model_id, gpu, loadWebLLM: async () => webllm } as never);
const chunks = (...contents: string[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const content of contents) yield { choices: [{ delta: { content } }] };
  },
});

test("in the browser: stopping the panel interrupts the model and reads no more of its answer", async () => {
  // Kills `() => running.interruptGenerate?.()` => `() => undefined`, the "abort" event name => "" and
  // `request.signal?.aborted` => false (the "c" written after the stop would be read).
  // Worked by hand: the stop comes as "ab" is reported, so the answer is "ab" and the model is interrupted once.
  let interrupted = 0;
  const w = watchedSignal();
  const seen: string[] = [];
  const text = await inBrowser(engine(chunks("ab", "c"), () => interrupted++)).complete({
    ...ask,
    signal: w.c.signal,
    onText: (s) => {
      seen.push(s);
      w.c.abort();
    },
  });
  assert.equal(text, "ab");
  assert.deepEqual(seen, ["ab"]);
  assert.equal(interrupted, 1);
  // Kills removeEventListener("abort", …) => "" and the finally block emptied.
  assert.equal(w.added.length, 1);
  assert.deepEqual(w.removed, w.added);
});

test("in the browser: stopping a model that can't be interrupted only stops reading", async () => {
  // Kills `running.interruptGenerate?.()` => `running.interruptGenerate()` (calling a missing function throws).
  const c = new AbortController();
  const failures: unknown[] = [];
  const catchIt = (e: unknown) => failures.push(e);
  process.on("uncaughtException", catchIt);
  try {
    const text = await inBrowser(engine(chunks("ab", "c"))).complete({ ...ask, signal: c.signal, onText: () => c.abort() });
    assert.equal(text, "ab");
    await new Promise((r) => setImmediate(r));
  } finally {
    process.off("uncaughtException", catchIt);
  }
  assert.deepEqual(failures, []);
});

test("in the browser: an answer stopped by the output limit is a cut-off, said in plain words", async () => {
  // Kills `finish_reason === "length"` => false, "length" => "", "cut-off" => "" and the message => "".
  const reply = {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: '{"c' } }] };
      yield { choices: [{ delta: {}, finish_reason: "length" }] };
    },
  };
  await assert.rejects(inBrowser(engine(reply)).complete({ ...ask, onText: () => {} }), (e: unknown) => {
    assert.ok(e instanceof AIError);
    assert.equal(e.kind, "cut-off");
    assert.equal(e.message, "the in-browser model reached its output limit");
    return true;
  });
});

test("the browser's built-in model: options are passed only when there is a schema or a signal", async () => {
  // Kills `r.jsonSchema || r.signal` => true (an empty options object) and `{ signal: r.signal }` => {}.
  const given: unknown[] = [];
  const api: BuiltInModelLike = {
    availability: async () => "available",
    create: async () => ({
      prompt: async (_input, options) => {
        given.push(options);
        return "ok";
      },
      destroy() {},
    }),
  };
  const c = new AbortController();
  assert.equal(await builtInProvider({ api }).complete(ask), "ok");
  assert.equal(await builtInProvider({ api }).complete({ ...ask, signal: c.signal }), "ok");
  assert.equal(given.length, 2);
  assert.equal(given[0], undefined);
  assert.deepEqual(given[1], { signal: c.signal });
});

// ---------- ollama.ts (#395) ----------

test("Ollama: an answer stopped by the output limit says so in plain words, streamed or whole", async () => {
  // Kills both `${who}: the answer reached the model's output limit` => "".
  const streamed = ollamaProvider({ model: "m", endpoint: "http://localhost:11434", fetch: streamServer(() => ({ chunks: ['{"message":{"content":"{"},"done":true,"done_reason":"length"}\n'] })).fetch });
  const whole = ollamaProvider({ model: "m", endpoint: "http://localhost:11434", fetch: fakeServer(() => ({ json: { message: { content: "{" }, done_reason: "length" } })).fetch });
  for (const p of [() => streamed.complete({ ...request, onText: () => {} }), () => whole.complete(request)]) {
    await assert.rejects(p(), (e: unknown) => {
      assert.ok(e instanceof AIError);
      assert.equal(e.kind, "cut-off");
      assert.match(e.message, /^Ollama at http:\/\/localhost:11434: the answer reached the model's output limit$/);
      return true;
    });
  }
});

// ---------- prompt.ts (#396) ----------

test("the prompt tells the model to do only what was asked, naming the steps a small model added on its own", () => {
  // Kills ONLY_ASKED_RULE => "" (the order test in prompt.test.ts compares the rule with itself, so an empty rule passed).
  // The examples are the ones a model really added: extruding a sketch it was only asked to draw, an unasked rename, an unasked size.
  const p = systemPrompt([], specs);
  assert.match(p, /^Do only what the user asks for, nothing more: /m);
  assert.match(p, /extruding a sketch they only asked to draw/);
  assert.match(p, /renaming something they didn't name/);
  assert.match(p, /changing a size they didn't mention/);
});

