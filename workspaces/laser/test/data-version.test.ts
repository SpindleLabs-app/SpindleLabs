// Laser's saved data across versions (lost-work hunt, 2026-11-12): the version number is read when a project opens
// (the plugin's readData, asked by core's projectFromJson), an older version is brought up to date step by step, and
// data from a later Laser is refused as "newer" so nothing of it is dropped. (That a change in the page
// keeps what the data holds beside the fields the page knows is in page.test.ts.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, NewerFormatError, projectFromJson, projectToJson } from "@fission/core";
import { defaultLaserData, LASER_DATA_VERSION, laserWorkspace, readLaserProjectData } from "../src/index.ts";

const open = (laser: unknown) => projectFromJson(projectToJson({ ...emptyProject("Sign"), workspaces: { laser } }), [laserWorkspace]);

test("the version this Laser writes is 4: hand-placed parts (`placed`) came with 2, layers (`ops`) with 3, flipped parts with 4", () => {
  assert.equal(LASER_DATA_VERSION, 4);
  assert.equal(defaultLaserData().version, 4);
  assert.deepEqual(defaultLaserData().ops, {});
});

test("version 1 data (before parts were placed by hand) opens as version 4 with nothing placed, every part cut and every choice kept", () => {
  // By hand: version 1 held bed, gap, thickness and off. Version 2 adds `placed`, empty for a project that never had it;
  // version 3 adds `ops`, empty: every part of an older project was cut, which is what no entry says.
  const v1 = { version: 1, bed: { width: 600, height: 400 }, gap: 4, thickness: 6, off: ["sketch-2"] };
  assert.deepEqual(open(v1).workspaces.laser, { version: 4, bed: { width: 600, height: 400 }, gap: 4, thickness: 6, off: ["sketch-2"], placed: {}, ops: {} });
});

test("version 2 data (before layers) opens as version 4 with every part cut and its places kept", () => {
  const v2 = { version: 2, bed: { width: 600, height: 400 }, gap: 4, thickness: 6, off: [], placed: { "sketch-4": { x: 120, y: 80, angle: 90 } } };
  assert.deepEqual(open(v2).workspaces.laser, { ...v2, version: 4, ops: {} });
});

test("version 3 data (before flips) opens as version 4 with nothing flipped and every choice kept", () => {
  const v3 = { version: 3, bed: { width: 600, height: 400 }, gap: 4, thickness: 6, off: [], placed: { "sketch-4": { x: 120, y: 80, angle: 90 } }, ops: { "sketch-4": "engrave", "sketch-5": "score" } };
  assert.deepEqual(open(v3).workspaces.laser, { ...v3, version: 4 });
});

test("version 4 data opens as it is, a flip kept", () => {
  const v4 = { version: 4, bed: { width: 600, height: 400 }, gap: 4, thickness: 6, off: [], placed: { "sketch-4": { x: 120, y: 80, angle: 90, flip: true } }, ops: { "sketch-4": "engrave" } };
  assert.deepEqual(open(v4).workspaces.laser, v4);
});

test("data from a later Laser is refused as newer, in words, so the project is kept for a build that reads it and nothing is dropped", () => {
  const v5 = { version: 5, bed: { width: 600, height: 400 }, gap: 3, thickness: 3, off: [], placed: {}, ops: {}, settings: [{ op: "engrave", power: 40 }] };
  assert.throws(
    () => open(v5),
    (e: unknown) => e instanceof NewerFormatError && e.message === "can't open the laser workspace's data: it was saved by a newer SpindleLabs (Laser data version 5; this one reads up to 4)",
  );
});

test("Laser data that is not an object, or has no whole version from 1 up, is refused in words (not as newer)", () => {
  for (const [bad, said] of [
    [null, "Laser data must be an object"],
    [[1, 2], "Laser data must be an object"],
    ["laser", "Laser data must be an object"],
    [{}, "Laser data has no version"],
    [{ version: "2" }, "Laser data has no version"],
    [{ version: 0 }, "Laser data version 0 is not one this SpindleLabs reads"],
    [{ version: 1.5 }, "Laser data version 1.5 is not one this SpindleLabs reads"],
    [{ version: -1 }, "Laser data version -1 is not one this SpindleLabs reads"],
  ] as const) {
    assert.throws(
      () => readLaserProjectData(bad),
      (e: unknown) => e instanceof Error && !(e instanceof NewerFormatError) && e.message === said,
      JSON.stringify(bad),
    );
  }
});
