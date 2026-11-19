// Export hunt 2026-11-12, #643 item 6 (its second half): a project database made by a newer SpindleLabs (a higher
// IndexedDB version: the browser refuses the open with a VersionError) was said as raw browser words. It now says what
// happened and what to do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDbKeyValue } from "../src/index.ts";

/** An IDBFactory whose open fails with `name`, as the browser's does. */
const refusing = (name: string) =>
  ({
    open: () => {
      const r: Record<string, unknown> = { error: new DOMException("The requested version (1) is less than the existing version (2).", name) };
      setImmediate(() => (r.onerror as () => void)());
      return r;
    },
  }) as unknown as IDBFactory;

test("#643 item 6: a database from a newer SpindleLabs is said in words, with what to do", async () => {
  await assert.rejects(indexedDbKeyValue("x", refusing("VersionError")).get("k"), (e: Error) => {
    assert.equal(e.message, "this browser's projects were kept by a newer SpindleLabs, which this one can't read: reload the page to get the newer one");
    return true;
  });
});

test("control: another failure to open still names the browser's reason", async () => {
  await assert.rejects(indexedDbKeyValue("x", refusing("UnknownError")).get("k"), /^Error: browser storage failed: can't open the project database \(UnknownError: /);
});
