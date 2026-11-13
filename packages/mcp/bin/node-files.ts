// The real file system for the tools (Node only; the entry bin/main.ts passes it to the session).
// Writes never go through a link: the name's ending is what the tools check, so the file written
// must be the one with that name. A new file is made only where nothing is (a link that points
// nowhere counts as something), in one step, so nothing can be put there between check and write.

import { closeSync, constants, lstatSync, openSync, readFileSync, realpathSync, statSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import type { Files } from "../src/session.ts";

function linkOrNothing(path: string): "link" | "other" | "nothing" {
  try {
    return lstatSync(path).isSymbolicLink() ? "link" : "other";
  } catch {
    return "nothing";
  }
}

export const nodeFiles: Files = {
  exists: (p) => linkOrNothing(p) !== "nothing",
  size: (p) => statSync(p).size,
  read: (p) => {
    if (!statSync(p).isFile()) throw new Error("it is not a file");
    return new Uint8Array(readFileSync(p));
  },
  write: (p, bytes, overwrite) => {
    if (linkOrNothing(p) === "link") throw new Error("it is a link to another file, and links are never written through");
    // O_NOFOLLOW refuses a link put there since the look above; O_EXCL makes "not there" and "made" one step.
    const flags = constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0) | (overwrite ? constants.O_TRUNC : constants.O_EXCL);
    let fd: number;
    try {
      fd = openSync(p, flags, 0o666);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "EEXIST") throw new Error("it is already there");
      if (code === "ELOOP") throw new Error("it is a link to another file, and links are never written through");
      throw e;
    }
    try {
      let done = 0;
      while (done < bytes.length) done += writeSync(fd, bytes, done);
    } finally {
      closeSync(fd);
    }
  },
};

/**
 * Where `path` really is: links followed in every part that exists (the
 * file itself too, so a link leading out of a folder is outside it), the
 * parts not made yet kept as written.
 */
function realPlace(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const up = dirname(path);
    return up === path ? path : join(realPlace(up), basename(path));
  }
}

/** The real file system, fenced: `allowed` is true only for a path really inside one of `folders`. */
export function nodeFilesIn(folders: string[]): Files {
  const roots = folders.map((f) => realPlace(f));
  return {
    ...nodeFiles,
    allowed: (p) => {
      const real = realPlace(p);
      return roots.some((root) => real.startsWith(root.endsWith(sep) ? root : root + sep));
    },
  };
}

/** The folders named on the command line (`--folder <folder>`, any number), or what is wrong with it. */
export function foldersFrom(args: string[]): { folders: string[]; problem?: undefined } | { problem: string } {
  const folders: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== "--folder") return { problem: `unknown argument ${args[i]}: the only one is --folder <folder>` };
    const folder = args[i + 1];
    if (folder === undefined) return { problem: "--folder needs a folder after it" };
    if (!isAbsolute(folder)) return { problem: `give --folder an absolute path, not ${folder}` };
    let isFolder = false;
    try {
      isFolder = statSync(folder).isDirectory();
    } catch {
      // not there
    }
    if (!isFolder) return { problem: `${folder} is not a folder` };
    folders.push(folder);
  }
  return { folders };
}
