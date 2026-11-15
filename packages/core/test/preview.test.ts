// The ?all and ?community preview switches (src/preview.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { PREVIEW_ALL_KEY, PREVIEW_COMMUNITY_KEY, readPreviews } from "../src/preview.ts";

function store(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test("hand-worked addresses: what each one turns on", () => {
  // Worked from the rules: `all` on means everything (community too); `community` alone leaves `all` off; neither: off.
  const cases: [string, string, { all: boolean; community: boolean }][] = [
    ["", "", { all: false, community: false }],
    ["?all", "", { all: true, community: true }],
    ["?community", "", { all: false, community: true }],
    ["?all=on", "", { all: true, community: true }],
    ["?all=1&community=off", "", { all: true, community: true }], // ?all includes community whatever it says
    ["?ALL/", "", { all: true, community: true }], // capitals and a slash forgiven, as ?combine
    ["", "#design?community", { all: false, community: true }], // after the "#", as the app's own address ends
    ["?all=off", "#design?all", { all: false, community: false }], // before the "#" wins
    ["?all-workspaces", "", { all: false, community: false }], // a different switch, not ?all
    ["?all=maybe", "", { all: false, community: false }], // an unknown value is ignored
    ["?share", "", { all: false, community: false }], // ?share stays its own switch
  ];
  for (const [search, hash, want] of cases) assert.deepEqual(readPreviews(search, store(), hash), want, `${search} ${hash}`);
});

test("remembered for the tab until turned off", () => {
  const s = store();
  readPreviews("?all", s);
  assert.equal(s.m.get(PREVIEW_ALL_KEY), "on");
  assert.deepEqual(readPreviews("", s), { all: true, community: true });
  readPreviews("?all=off", s);
  assert.equal(s.m.has(PREVIEW_ALL_KEY), false);
  assert.deepEqual(readPreviews("", s), { all: false, community: false });
  readPreviews("?community", s);
  assert.equal(s.m.get(PREVIEW_COMMUNITY_KEY), "on");
  assert.deepEqual(readPreviews("#laser", s), { all: false, community: true });
  readPreviews("?community=false", s);
  assert.deepEqual(readPreviews("", s), { all: false, community: false });
});

test("blocked storage: the switch lasts only while the address has it", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readPreviews("?all", broken), { all: true, community: true });
  assert.deepEqual(readPreviews("", broken), { all: false, community: false });
  assert.deepEqual(readPreviews("?community", null), { all: false, community: true });
});
