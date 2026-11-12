// Laser's saved data across versions (lost-work hunt, 2026-11-12): the version number is read when a project opens
// (the plugin's readData, asked by core's projectFromJson), an older version is brought up to date step by step, and
// data from a later Laser is refused as "newer" so nothing of it is dropped. (That a change in the page
// keeps what the data holds beside the fields the page knows is in page.test.ts.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, NewerFormatError, projectFromJson, projectToJson } from "@fission/core";
import { defaultLaserData, LASER_DATA_VERSION, laserWorkspace, readLaserProjectData } from "../src/index.ts";

const open = (laser: unknown) => projectFromJson(projectToJson({ ...emptyProject("Sign"), workspaces: { laser } }), [laserWorkspace]);

test("the version this Laser writes is 2: hand-placed parts (`placed`) came with it", () => {
  assert.equal(LASER_DATA_VERSION, 2);
  assert.equal(defaultLaserData().version, 2);
});

test("version 1 data (before parts were placed by hand) opens as version 2 with nothing placed and every choice kept", () => {
  // By hand: version 1 held bed, gap, thickness and off. Version 2 adds `placed`, empty for a project that never had it.
  const v1 = { version: 1, bed: { width: 600, height: 400 }, gap: 4, thickness: 6, off: ["sketch-2"] };
  assert.deepEqual(open(v1).workspaces.laser, { version: 2, bed: { width: 600, height: 400 }, gap: 4, thickness: 6, off: ["sketch-2"], placed: {} });
});

test("version 2 data opens as it is", () => {
  const v2 = { version: 2, bed: { width: 600, height: 400 }, gap: 4, thickness: 6, off: [], placed: { "sketch-4": { x: 120, y: 80, angle: 90 } } };
  assert.deepEqual(open(v2).workspaces.laser, v2);
});

test("data from a later Laser is refused as newer, in words, so the project is kept for a build that reads it and nothing is dropped", () => {
  const v3 = { version: 3, bed: { width: 600, height: 400 }, gap: 3, thickness: 3, off: [], placed: {}, engrave: [{ part: "sketch-4", power: 40 }] };
  assert.throws(
    () => open(v3),
    (e: unknown) => e instanceof NewerFormatError && e.message === "can't open the laser workspace's data: it was saved by a newer SpindleLabs (Laser data version 3; this one reads up to 2)",
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
