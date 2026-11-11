// Shared by the tests: an in-memory file system and a session on the real kernel.
import { nodeKernel } from "../../testing/src/node-kernel.ts";
import { Session, type Files } from "../src/session.ts";
import type { ToolAnswer } from "../src/protocol.ts";

export const kernel = nodeKernel();

export class MemoryFiles implements Files {
  map = new Map<string, Uint8Array>();
  failWrites = false;
  exists = (p: string) => this.map.has(p);
  size = (p: string) => this.map.get(p)!.length;
  read = (p: string) => this.map.get(p)!;
  write = (p: string, b: Uint8Array) => {
    if (this.failWrites) throw new Error("EACCES: permission denied");
    this.map.set(p, b);
  };
}

export function session(files = new MemoryFiles()): { s: Session; files: MemoryFiles } {
  return { s: new Session(kernel, files), files };
}

/** The data of a tool that must work; throws with its refusal otherwise. */
export async function ok(s: Session, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const got = await s.call(name, args);
  if (got === null) throw new Error(`no tool ${name}`);
  if (!got.ok) throw new Error(`${name} refused: ${got.error}`);
  return got.data;
}

/** The words of a tool that must refuse; throws when it works. */
export async function refused(s: Session, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const got: ToolAnswer | null = await s.call(name, args);
  if (got === null) throw new Error(`no tool ${name}`);
  if (got.ok) throw new Error(`${name} worked, expected a refusal: ${JSON.stringify(got.data)}`);
  return got.error;
}

export const near = (got: number, want: number, tol = 1e-9) => {
  if (!(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)))) throw new Error(`${got}, expected ${want}`);
};
