// The beta SpindleLabs MCP server, run locally over stdio:
//   node --experimental-strip-types --no-warnings packages/mcp/bin/main.ts --folder <a folder it may use> [--folder <another>]
// stdout carries only protocol messages; anything else goes to stderr.

import { createInterface } from "node:readline";
import { nodeKernel } from "../../testing/src/node-kernel.ts";
import { serverInfo } from "../src/info.ts";
import { handleLine } from "../src/protocol.ts";
import { foldersFrom, nodeFilesIn } from "./node-files.ts";
import { Session } from "../src/session.ts";

// The tools read and write only inside the folders named here; with none named, nowhere.
const named = foldersFrom(process.argv.slice(2));
if (named.problem !== undefined) {
  process.stderr.write(`spindlelabs mcp: ${named.problem}\n`);
  process.exit(2);
}
const session = new Session(nodeKernel(), nodeFilesIn(named.folders));
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
// One message at a time, in order: the kernel and the open design are one per server.
let queue = Promise.resolve();
lines.on("line", (line) => {
  queue = queue.then(async () => {
    const reply = await handleLine(line, session, serverInfo);
    if (reply !== null) process.stdout.write(reply + "\n");
  }).catch((e) => process.stderr.write(`spindlelabs mcp: ${e instanceof Error ? e.stack : String(e)}\n`));
});
lines.on("close", () => {
  queue.then(() => session.close()).finally(() => process.exit(0));
});
