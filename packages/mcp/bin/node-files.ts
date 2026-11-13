// The real file system for the tools (Node only; the entry bin/main.ts passes it to the session).
// Writes never go through a link: the name's ending is what the tools check, so the file written
// must be the one with that name. A new file is made only where nothing is (a link that points
// nowhere counts as something), in one step, so nothing can be put there between check and write.

import { closeSync, constants, lstatSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
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
