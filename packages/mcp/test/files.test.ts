// The real file system as the tools use it (bin/node-files.ts): a link is never written through
// and "not unless overwrite" holds even for a name that points nowhere (security hunt 2026-11-13, F2).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { foldersFrom, nodeFiles, nodeFilesIn } from "../bin/node-files.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

function folder(): string {
  return mkdtempSync(join(tmpdir(), "mcp-files-"));
}

test("a plain file: made, refused when there unless overwrite, replaced with overwrite", () => {
  const dir = folder();
  try {
    const p = join(dir, "part.spindle");
    assert.equal(nodeFiles.exists(p), false);
    nodeFiles.write(p, bytes("one"), false);
    assert.equal(readFileSync(p, "utf8"), "one");
    assert.equal(nodeFiles.exists(p), true);
    assert.equal(nodeFiles.size(p), 3);
    assert.throws(() => nodeFiles.write(p, bytes("two"), false), /already there/);
    assert.equal(readFileSync(p, "utf8"), "one");
    nodeFiles.write(p, bytes("2"), true);
    assert.equal(readFileSync(p, "utf8"), "2", "replaced whole, nothing of the longer old file left");
    assert.deepEqual([...nodeFiles.read(p)], [...bytes("2")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a link named .spindle is never written through, with or without overwrite", () => {
  const dir = folder();
  try {
    const victim = join(dir, "victim.txt");
    writeFileSync(victim, "mine");
    const link = join(dir, "notes.spindle");
    symlinkSync(victim, link);
    assert.equal(nodeFiles.exists(link), true);
    for (const overwrite of [false, true]) {
      assert.throws(() => nodeFiles.write(link, bytes("theirs"), overwrite), /link/, `overwrite ${overwrite}`);
      assert.equal(readFileSync(victim, "utf8"), "mine", `overwrite ${overwrite}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a link that points nowhere counts as there, and nothing is made where it points", () => {
  const dir = folder();
  try {
    const target = join(dir, "made-by-link.txt");
    const link = join(dir, "new.stl");
    symlinkSync(target, link);
    assert.equal(nodeFiles.exists(link), true, "a name that is taken is there");
    for (const overwrite of [false, true]) assert.throws(() => nodeFiles.write(link, bytes("x"), overwrite), /link/);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a folder is not a file to read", () => {
  const dir = folder();
  try {
    assert.throws(() => nodeFiles.read(dir), /not a file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The folders the server may use (security hunt 2026-11-13, F1 and F3).

test("allowed: inside a named folder, by where the path really is, never by how it is spelt", () => {
  const dir = folder();
  const other = folder();
  try {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "a.spindle"), "x");
    writeFileSync(join(other, "secret.spindle"), "x");
    symlinkSync(other, join(dir, "way-out")); // a folder link leading outside
    symlinkSync(join(other, "secret.spindle"), join(dir, "link.spindle")); // a file link leading outside
    const files = nodeFilesIn([dir]);
    assert.equal(files.allowed!(join(dir, "a.spindle")), true);
    assert.equal(files.allowed!(join(dir, "sub", "new.stl")), true, "a file not made yet, in a folder that is there");
    assert.equal(files.allowed!(join(dir, "none", "deeper", "new.stl")), true, "folders not made yet are still inside");
    assert.equal(files.allowed!(dir), false, "the folder itself is not a file in it");
    assert.equal(files.allowed!(join(other, "secret.spindle")), false);
    assert.equal(files.allowed!(join(dir, "..", other.split("/").pop()!, "secret.spindle")), false, ".. out of the folder");
    assert.equal(files.allowed!(join(dir, "way-out", "secret.spindle")), false, "through a folder link");
    assert.equal(files.allowed!(join(dir, "way-out", "new.spindle")), false, "a new file through a folder link");
    assert.equal(files.allowed!(join(dir, "link.spindle")), false, "a file link leading outside");
    assert.equal(files.allowed!(dir + "-neighbour/a.spindle"), false, "a folder whose name only begins the same");
    // No folder named: nothing is inside.
    assert.equal(nodeFilesIn([]).allowed!(join(dir, "a.spindle")), false);
    // Two folders: either.
    assert.equal(nodeFilesIn([dir, other]).allowed!(join(other, "secret.spindle")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("folders from the command line: every --folder, absolute and there, or a plain refusal", () => {
  const dir = folder();
  try {
    assert.deepEqual(foldersFrom(["--folder", dir]), { folders: [dir] });
    assert.deepEqual(foldersFrom(["--folder", dir, "--folder", tmpdir()]), { folders: [dir, tmpdir()] });
    assert.deepEqual(foldersFrom([]), { folders: [] });
    assert.match(foldersFrom(["--folder"]).problem!, /needs a folder/);
    assert.match(foldersFrom(["--folder", "relative/x"]).problem!, /absolute/);
    assert.match(foldersFrom(["--folder", join(dir, "missing")]).problem!, /not a folder/);
    assert.match(foldersFrom(["--other"]).problem!, /--other/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
