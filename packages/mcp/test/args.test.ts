// The argument checks, each type with a value that breaks it, and the
// limits at 0.9× and 1.1× (and exactly at them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { argsProblem, argsSchema, type Args } from "../src/args.ts";

const args: Args = {
  path: { type: "string", maxLength: 10, description: "p" },
  d: { type: "number", exclusiveMinimum: 0, maximum: 25, optional: true, description: "d" },
  flag: { type: "boolean", optional: true, description: "f" },
  list: { type: "strings", maxItems: 2, maxLength: 3, optional: true, description: "l" },
};
const check = (given: Record<string, unknown>) => argsProblem("t", args, given);

test("good arguments pass", () => {
  assert.equal(check({ path: "/a" }), null);
  assert.equal(check({ path: "x".repeat(10), d: 25, flag: false, list: ["abc", "a"] }), null);
});

test("each wrong argument is named", () => {
  assert.match(check({})!, /needs path/);
  assert.match(check({ path: "/a", extra: 1 })!, /no argument "extra"/);
  assert.match(check({ path: "" })!, /path must be text/);
  assert.match(check({ path: 5 })!, /path must be text/);
  assert.match(check({ path: "x".repeat(11) })!, /path must be text/);
  assert.match(check({ path: "/a", d: "1" })!, /d must be a number/);
  assert.match(check({ path: "/a", d: Number.NaN })!, /d must be a number/);
  assert.match(check({ path: "/a", d: 0 })!, /more than 0/);
  assert.match(check({ path: "/a", flag: "yes" })!, /true or false/);
  assert.match(check({ path: "/a", list: "abc" })!, /list must be a list/);
  assert.match(check({ path: "/a", list: ["a", "b", "c"] })!, /list must be a list/);
  assert.match(check({ path: "/a", list: ["abcd"] })!, /list must be a list/);
  assert.match(check({ path: "/a", list: [""] })!, /list must be a list/);
  // An inherited name is not an argument.
  assert.match(argsProblem("t", args, JSON.parse('{"path":"/a","__proto__":1}'))!, /no argument "__proto__"/);
});

test("the density limit at 0.9× and 1.1×", () => {
  assert.equal(check({ path: "/a", d: 25 * 0.9 }), null);
  assert.match(check({ path: "/a", d: 25 * 1.1 })!, /at most 25/);
});

test("the schema lists required arguments and refuses others", () => {
  const s = argsSchema(args) as { required: string[]; additionalProperties: boolean; properties: Record<string, { type: string }> };
  assert.deepEqual(s.required, ["path"]);
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties.list.type, "array");
});

test("absolute paths on every system, relative ones not", async () => {
  const { isAbsolute } = await import("../src/session.ts");
  for (const p of ["/home/ben/a.stl", "C:\\Users\\ben\\a.stl", "c:/a.stl", "\\\\server\\share\\a.stl"]) assert.equal(isAbsolute(p), true, p);
  for (const p of ["a.stl", "./a.stl", "../a.stl", "C:a.stl", "~/a.stl", "\\a"]) assert.equal(isAbsolute(p), false, p);
});
