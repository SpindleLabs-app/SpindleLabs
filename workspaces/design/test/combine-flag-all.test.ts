// ?all (@fission/core preview.ts) turns Combine on too (src/combine-flag.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setPreviews } from "@fission/core";
import { combineShown, setCombineShown } from "../src/combine-flag.ts";

test("?all turns Combine on; ?community alone does not; without either the address alone decides", () => {
  try {
    setPreviews({ all: true, community: true });
    setCombineShown(null);
    assert.equal(combineShown(), true); // no address here (node), so only ?all can have turned it on
    setPreviews({ all: false, community: true });
    setCombineShown(null);
    assert.equal(combineShown(), false);
  } finally {
    setPreviews(null);
    setCombineShown(null);
  }
});
