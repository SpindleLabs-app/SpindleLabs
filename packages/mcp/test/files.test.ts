// The real file system as the tools use it (bin/node-files.ts): a link is never written through
// and "not unless overwrite" holds even for a name that points nowhere (security hunt 2026-11-13, F2).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nodeFiles } from "../bin/node-files.ts";

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
