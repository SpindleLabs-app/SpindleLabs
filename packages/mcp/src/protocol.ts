// The MCP wire protocol over stdio, by hand (no SDK, so nothing new in the
// lockfile and nothing that changes under us): one JSON-RPC 2.0 message per
// line on stdin, one per line on stdout, nothing else ever on stdout.
// Only what a tools-only server needs: initialize, ping, tools/list,
// tools/call; notifications are taken and answered with nothing.

/** The protocol versions this server speaks, newest first; a client asking for another gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** JSON-RPC error codes used here. */
export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

/** One tool as tools/list describes it. */
export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: object;
}

/** What a tool call gives back: a plain-data answer, or a refusal in words (shown to the model, isError true). */
export type ToolAnswer = { ok: true; data: unknown } | { ok: false; error: string };

export interface ToolHost {
  tools(): ToolInfo[];
  /** Runs one tool; null when no tool has that name. Never throws for bad input: refuses in words. */
  call(name: string, args: Record<string, unknown>): Promise<ToolAnswer | null>;
}

export interface ServerInfo {
  name: string;
  version: string;
  instructions: string;
}

type Id = string | number | null;
type Reply = { jsonrpc: "2.0"; id: Id; result: unknown } | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const fail = (id: Id, code: number, message: string): Reply => ({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * Answers one line of input: the reply's text, or null for a notification
 * (and a blank line). Never throws: a bad line is a JSON-RPC error.
 */
export async function handleLine(line: string, host: ToolHost, info: ServerInfo): Promise<string | null> {
  if (line.trim() === "") return null;
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return JSON.stringify(fail(null, RPC.parse, "not valid JSON"));
  }
  if (Array.isArray(msg)) return JSON.stringify(fail(null, RPC.invalidRequest, "batches are not supported"));
  if (!isObject(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    const id = isObject(msg) && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null;
    return JSON.stringify(fail(id, RPC.invalidRequest, "not a JSON-RPC 2.0 request"));
  }
  // No id: a notification (initialized, cancelled, ...), which is never answered.
  if (!Object.hasOwn(msg, "id")) return null;
  const id = msg.id;
  if (typeof id !== "string" && typeof id !== "number") return JSON.stringify(fail(null, RPC.invalidRequest, "the id must be a string or a number"));
  const params = msg.params === undefined ? {} : msg.params;
  if (!isObject(params)) return JSON.stringify(fail(id, RPC.invalidParams, "params must be an object"));
  return JSON.stringify(await answer(id, msg.method, params, host, info));
}

async function answer(id: string | number, method: string, params: Record<string, unknown>, host: ToolHost, info: ServerInfo): Promise<Reply> {
  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const version = (PROTOCOL_VERSIONS as readonly unknown[]).includes(asked) ? (asked as string) : PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: info.name, version: info.version }, instructions: info.instructions },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: host.tools() } };
    case "tools/call": {
      const { name, arguments: args } = params;
      if (typeof name !== "string") return fail(id, RPC.invalidParams, "tools/call needs the tool's name");
      if (args !== undefined && !isObject(args)) return fail(id, RPC.invalidParams, "a tool's arguments must be an object");
      let got: ToolAnswer | null;
      try {
        got = await host.call(name, (args as Record<string, unknown> | undefined) ?? {});
      } catch (e) {
        // A tool must refuse in words; anything thrown is a bug, still said, never a dead server.
        got = { ok: false, error: `internal error: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (got === null) return fail(id, RPC.invalidParams, `there is no tool ${JSON.stringify(name).slice(0, 80)}`);
      if (!got.ok) return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: got.error }], isError: true } };
      const structured = isObject(got.data) ? { structuredContent: got.data } : {};
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(got.data) }], ...structured, isError: false } };
    }
    default:
      return fail(id, RPC.methodNotFound, `method ${JSON.stringify(method).slice(0, 80)} is not supported`);
  }
}
