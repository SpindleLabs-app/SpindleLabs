// Tests written to kill the mutants StrykerJS found surviving in the store's
// project-list details added by U6a (when a project was last opened, and
// which workspaces hold work): readSummary's optional `touched` and `works`,
// and save's choice of `touched`. Each test names the change it catches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type DataReader, type Project } from "@fission/core";
import { memoryKeyValue, projectStore } from "../src/index.ts";

const design: DataReader = { id: "design", readData: (d) => d };
const part = (name: string): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1 } } });

/** A clock that reads `times` in turn (ISO strings, UTC), then stays on the last. */
function clock(...times: string[]) {
  let i = 0;
  return () => new Date(times[Math.min(i++, times.length - 1)]);
}

/** The list's one entry for a summary stored as `extra` on top of a readable name and save time. */
async function listed(extra: Record<string, unknown>) {
  const kv = memoryKeyValue();
  kv.entries.set("summary/p", JSON.stringify({ name: "P", modified: "2026-11-01T00:00:00.000Z", order: 1, ...extra }));
  const list = await projectStore(kv, [design]).list();
  assert.equal(list.length, 1);
  return list[0];
}

test("a summary's last-opened time is kept only when it is a readable date string", async () => {
  // Kills `typeof touched === "string"` => true / false, `at !== null && …` => `||` / true / false,
  // and `!Number.isNaN(at.getTime())` => true / false.
  // Worked by hand: "2026-11-02T03:04:05.000Z" is a date; 5 is a number (new Date(5) would be 1970, so it must not
  // be read as one); "soon" is a string that is no date; a missing time is simply left out, never a problem.
  assert.deepEqual((await listed({ touched: "2026-11-02T03:04:05.000Z" })).touched, new Date(Date.UTC(2026, 10, 2, 3, 4, 5)));
  for (const touched of [5, "soon", undefined, null]) {
    const s = await listed({ touched });
    assert.equal(s.touched, undefined, String(touched));
    assert.equal(s.problem, undefined, String(touched));
    assert.equal(s.name, "P", String(touched));
  }
});

test("a summary's workspaces with work are kept only when they are a list of names", async () => {
  // Kills `Array.isArray(works) && …` => `||` / true, the every() check => true / false, and its "string" => "".
  assert.deepEqual((await listed({ works: ["design", "slice"] })).works, ["design", "slice"]);
  assert.deepEqual((await listed({ works: [] })).works, []);
  for (const works of ["design", ["design", 3], [null], { 0: "design" }, undefined]) {
    const s = await listed({ works });
    assert.equal(s.works, undefined, JSON.stringify(works));
    assert.equal(s.problem, undefined, JSON.stringify(works));
  }
});

test("save: the last-opened time is the save time unless the state's own time was handed in, then it is now", async () => {
  // Kills `read === undefined ? modified : now()…` => true / false and `===` => `!==`.
  // Worked by hand with a clock reading 10:00 then 11:00:
  // - no read time: the save time is the clock's first reading, 10:00, and touched is that same 10:00 (the clock is
  //   not read again, so the 11:00 reading is never used);
  // - read time 09:00 handed in: the save time is 09:00 and touched is the clock's first reading, 10:00.
  const a = projectStore(memoryKeyValue(), [design], clock("2026-11-06T10:00:00.000Z", "2026-11-06T11:00:00.000Z"));
  await a.save("p", part("P"));
  const [first] = await a.list();
  assert.deepEqual([first.modified, first.touched], [new Date("2026-11-06T10:00:00.000Z"), new Date("2026-11-06T10:00:00.000Z")]);

  const b = projectStore(memoryKeyValue(), [design], clock("2026-11-06T10:00:00.000Z", "2026-11-06T11:00:00.000Z"));
  await b.save("p", part("P"), new Date("2026-11-06T09:00:00.000Z"));
  const [second] = await b.list();
  assert.deepEqual([second.modified, second.touched], [new Date("2026-11-06T09:00:00.000Z"), new Date("2026-11-06T10:00:00.000Z")]);
});
