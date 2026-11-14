// The wire protocol with a stand-in tool host: every kind of bad line gets
// its JSON-RPC error and the server carries on; notifications get nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleLine, PROTOCOL_VERSIONS, RPC, type ToolHost } from "../src/protocol.ts";

const info = { name: "t", version: "0", instructions: "i" };
const host: ToolHost = {
  tools: () => [{ name: "echo", description: "d", inputSchema: { type: "object" } }],
  call: async (name, args) => {
    if (name === "echo") return { ok: true, data: args };
    if (name === "no") return { ok: false, error: "refused in words" };
    if (name === "boom") throw new Error("a bug");
    return null;
  },
};
const send = async (msg: unknown) => {
  const r = await handleLine(typeof msg === "string" ? msg : JSON.stringify(msg), host, info);
  return r === null ? null : JSON.parse(r);
};

test("initialize answers the version asked when spoken, else the newest", async () => {
  for (const v of PROTOCOL_VERSIONS) assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } })).result.protocolVersion, v);
  const r = await send({ jsonrpc: "2.0", id: "a", method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(r.id, "a");
  assert.equal(r.result.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.result.serverInfo.name, "t");
});

test("notifications and blank lines get no answer", async () => {
  assert.equal(await send({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await send(""), null);
  assert.equal(await send("   "), null);
});

test("each bad line gets its own error code", async () => {
  assert.equal((await send("{not json")).error.code, RPC.parse);
  assert.equal((await send([{ jsonrpc: "2.0", id: 1, method: "ping" }])).error.code, RPC.invalidRequest);
  assert.equal((await send({ id: 1, method: "ping" })).error.code, RPC.invalidRequest);
  assert.equal((await send({ jsonrpc: "1.0", id: 1, method: "ping" })).error.code, RPC.invalidRequest);
  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: 7 })).error.code, RPC.invalidRequest);
  assert.equal((await send({ jsonrpc: "2.0", id: { x: 1 }, method: "ping" })).error.code, RPC.invalidRequest);
  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "ping", params: [1] })).error.code, RPC.invalidParams);
  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "resources/list" })).error.code, RPC.methodNotFound);
  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} })).error.code, RPC.invalidParams);
  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: [1] } })).error.code, RPC.invalidParams);
  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope" } })).error.code, RPC.invalidParams);
  assert.equal((await send("null")).error.code, RPC.invalidRequest);
});

test("ping, tools/list and tools/call", async () => {
  assert.deepEqual((await send({ jsonrpc: "2.0", id: 1, method: "ping" })).result, {});
  assert.equal((await send({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools[0].name, "echo");
  const r = await send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } });
  assert.equal(r.result.isError, false);
  assert.deepEqual(JSON.parse(r.result.content[0].text), { a: 1 });
  assert.deepEqual(r.result.structuredContent, { a: 1 });
});

test("a refusal and a thrown tool are tool errors, never a dead server", async () => {
  const no = await send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "no" } });
  assert.equal(no.result.isError, true);
  assert.equal(no.result.content[0].text, "refused in words");
  const boom = await send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "boom" } });
  assert.equal(boom.result.isError, true);
  assert.match(boom.result.content[0].text, /internal error: a bug/);
});
