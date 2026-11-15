// The app side of the library (apps/fission/src/library.ts `libraryParts`, community C3c) against the fake library: what
// the Publish dialog sends (the open design's text through the share export), the words for each refusal, and what My
// library lists (an off design with its file left has the file deleted and isn't shown). The browser:
// apps/fission e2e/library-publish.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LICENCES, PUBLISH_WORDS } from "../src/library.ts";
import { fakeLibrary } from "./fake-library.ts";
import { repoFile } from "./repo-file.ts";

const g = globalThis as unknown as { addEventListener?: unknown };
g.addEventListener ??= () => {};
const { libraryParts } = (await import(repoFile("apps/fission/src/library.ts").href)) as typeof import("../../../apps/fission/src/library.ts");

const PROJECT = JSON.stringify({ formatVersion: 1, name: "Clip", items: [] });
const host = (text: string | null = PROJECT) => ({ current: () => (text === null ? null : { name: "Clip", text }), picture: () => null });
const form = { title: "Clip", description: "", licence: "CC-BY-4.0", tags: ["desk"], picture: null };

test("hand-worked: publishing sends the open design's text as it is; My library lists it live", async () => {
  const lib = fakeLibrary();
  const { publish, mine } = libraryParts(lib.as("ada"), host());
  assert.deepEqual(publish.licences.map((l) => l.id), [...LICENCES], "every licence, CC BY 4.0 first");
  assert.equal(publish.licences[0]!.name, "CC BY 4.0");
  await publish.publish(form);
  // One design, its file the project's text exactly (the share export changes no byte of a plain project).
  assert.equal(lib.entries.length, 1);
  assert.equal([...lib.objects.values()][0]!.text, PROJECT);
  const rows = await mine.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.state, "live");
  assert.equal(rows[0]!.title, "Clip");
});

test("the problem line is the library's own words; the size waits for publishing", () => {
  const { publish } = libraryParts(fakeLibrary().as("ada"), host());
  assert.equal(publish.problem(form), null);
  assert.equal(publish.problem({ ...form, title: "" }), PUBLISH_WORDS.bad.title);
  assert.equal(publish.problem({ ...form, tags: ["A"] }), PUBLISH_WORDS.bad.tags);
  assert.equal(publish.problem({ ...form, licence: "MIT" }), PUBLISH_WORDS.bad.licence);
});

test("every refusal is said in words: daily, held, off, too big, nothing open, offline", async () => {
  const lib = fakeLibrary();
  const { publish } = libraryParts(lib.as("ada"), host());
  for (let i = 0; i < 10; i++) await publish.publish(form);
  await assert.rejects(publish.publish(form), { message: PUBLISH_WORDS.daily });
  lib.clock += 86_400_000_000;
  lib.held.add("ada");
  await assert.rejects(publish.publish(form), { message: PUBLISH_WORDS.held });
  lib.held.delete("ada");
  lib.sharingOn = false;
  await assert.rejects(publish.publish(form), { message: PUBLISH_WORDS.off });
  lib.sharingOn = true;
  const big = JSON.stringify({ formatVersion: 1, name: "Big", items: [], pad: "x".repeat(5 * 1024 * 1024) });
  await assert.rejects(libraryParts(lib.as("ada"), host(big)).publish.publish(form), { message: PUBLISH_WORDS["too-big"] });
  await assert.rejects(libraryParts(lib.as("ada"), host(null)).publish.publish(form), /nothing to publish/);
  lib.mode = "down";
  await assert.rejects(publish.publish(form), /internet|connect|offline/i);
});

test("My library: taken down after a report says so; an off design with its file left has the file deleted, not shown", async () => {
  const lib = fakeLibrary();
  const { publish, mine } = libraryParts(lib.as("ada"), host());
  await publish.publish(form);
  await publish.publish({ ...form, title: "Hook" });
  const [clip, hook] = lib.entries;
  clip!.removedAt = lib.clock;
  // Hook taken down here before its file went (the answer to the delete lost): off, with a file.
  hook!.state = "off";
  assert.equal(lib.objects.size, 2);
  const rows = await mine.list();
  assert.deepEqual(rows.map((r) => [r.title, r.state]), [["Clip", "removed"]]);
  assert.equal(lib.objects.size, 1, "Hook's file deleted by listing");
  assert.equal(lib.objects.has(`${hook!.id}.spindle`), false);
  // Take down: off and its file gone.
  await mine.takeDown(clip!.id);
  assert.equal(lib.objects.size, 0);
  assert.deepEqual(await mine.list(), []);
});
