// The server as Claude runs it: a separate Node process over stdio. Only
// protocol lines on stdout, one answer per request, in order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a whole session over stdio, then a clean exit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-"));
  const main = new URL("../bin/main.ts", import.meta.url).pathname;
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", main], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "new_project", arguments: { name: "Stdio" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "set_part", arguments: { shape: "box", width: 10, depth: 20, height: 30 } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "save_project", arguments: { path: join(dir, "s.spindle") } } },
    "this is not json",
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "measure_body", arguments: { body: "Body 1" } } },
  ];
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  for (const l of lines) child.stdin.write((typeof l === "string" ? l : JSON.stringify(l)) + "\n");
  child.stdin.end();
  const code = await new Promise((r) => child.on("exit", r));
  try {
    assert.equal(code, 0, err);
    const replies = out.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(replies.map((r) => r.id), [1, 2, 3, 4, 5, null, 6]);
    assert.ok(replies[1].result.tools.length >= 13);
    assert.equal(replies[5].error.code, -32700);
    // 10 · 20 · 30 = 6000 mm³.
    assert.equal(replies[6].result.structuredContent.volume_mm3, 6000);
    assert.equal(JSON.parse(readFileSync(join(dir, "s.spindle"), "utf8")).name, "Stdio");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
