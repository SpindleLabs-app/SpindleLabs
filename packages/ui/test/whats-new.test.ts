// What's new (Settings > About): WHATS_NEW.md's text read into versions and
// shown as a list. The real file is read too, so a hand edit that the app
// would show wrongly fails here as well as in changelog.py's own check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { parseWhatsNew, whatsNewDate, whatsNewList, whatsNewNote } from "../src/whats-new.ts";

const SAMPLE = `# What's new

Intro, with - a dash that isn't an entry.

## 0.35.41 (2026-11-07)

- Extrude any closed region.
- Measure: click a face,
  then a second one.

## Not a version

- Never shown.

## 0.35.38 (2026-11-06)

## 0.35.36 (2026-11-06)

- A rectangle stays a rectangle.
`;

test("hand-worked: versions newest first, entries in order, a carried-on line joined, the rest left out", () => {
  assert.deepEqual(parseWhatsNew(SAMPLE), [
    { version: "0.35.41", date: "2026-11-07", entries: ["Extrude any closed region.", "Measure: click a face, then a second one."] },
    // "## Not a version" and its line are left out; 0.35.38 has no entries, so it is dropped rather than shown empty.
    { version: "0.35.36", date: "2026-11-06", entries: ["A rectangle stays a rectangle."] },
  ]);
  assert.deepEqual(parseWhatsNew(SAMPLE.replace(/\n/g, "\r\n")), parseWhatsNew(SAMPLE)); // a Windows checkout reads the same
  assert.deepEqual(parseWhatsNew(""), []);
  // A heading that only looks like one: a two-digit month, no brackets, a fourth number.
  assert.deepEqual(parseWhatsNew("## 0.1.0 2026-11-07\n- a\n## 0.1.0.1 (2026-11-07)\n- b\n## 0.1.0 (2026-1-07)\n- c\n"), []);
});

test("hand-worked dates: the calendar day, never moved by a time zone", () => {
  assert.equal(whatsNewDate("2026-11-07"), "7 Nov 2026");
  assert.equal(whatsNewDate("2026-01-31"), "31 Jan 2026");
  assert.equal(whatsNewDate("2026-12-01"), "1 Dec 2026");
  // Not a date: shown as written rather than as a wrong one.
  assert.equal(whatsNewDate("2026-13-01"), "2026-13-01");
  assert.equal(whatsNewDate("soon"), "soon");
});

test("the list: one section per version with its date, every word escaped", () => {
  const html = whatsNewList([{ version: "0.35.41", date: "2026-11-07", entries: ["Fixed <b>bold</b> & \"quotes\"."] }]);
  assert.equal(
    html,
    '<section data-version="0.35.41"><h3>0.35.41 <time datetime="2026-11-07">7 Nov 2026</time></h3><ul><li>Fixed &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;.</li></ul></section>',
  );
  const window = new Window();
  const box = window.document.createElement("div");
  box.innerHTML = whatsNewList(parseWhatsNew(SAMPLE));
  assert.deepEqual([...box.querySelectorAll("h3")].map((h) => h.textContent), ["0.35.41 7 Nov 2026", "0.35.36 6 Nov 2026"]);
  assert.equal(box.querySelectorAll("li").length, 3);
  assert.equal(box.querySelector("b"), null);
  assert.match(whatsNewList([]), /Nothing to show yet/);
});

test("the note names the version only when the build knew it", () => {
  assert.match(whatsNewNote("0.35.41"), /^You have SpindleLabs 0\.35\.41\. /);
  assert.doesNotMatch(whatsNewNote(null), /You have/);
});

test("the real WHATS_NEW.md: every version heading shows, each with its lines, newest first", () => {
  const text = readFileSync(new URL("../../../WHATS_NEW.md", import.meta.url), "utf8");
  const versions = parseWhatsNew(text);
  const headings = text.split("\n").filter((l) => l.startsWith("## "));
  assert.equal(versions.length, headings.length, "a heading the app can't read, or one with no lines");
  assert.equal(versions.reduce((n, v) => n + v.entries.length, 0), text.split("\n").filter((l) => l.startsWith("- ")).length);
  const key = (v: string) => v.split(".").map(Number);
  for (let i = 1; i < versions.length; i++) {
    const [a, b] = [key(versions[i - 1]!.version), key(versions[i]!.version)];
    assert.ok(a[0]! > b[0]! || (a[0] === b[0] && (a[1]! > b[1]! || (a[1] === b[1] && a[2]! > b[2]!))), `${versions[i - 1]!.version} before ${versions[i]!.version}`);
  }
  assert.equal(versions.at(-1)!.version, "0.0.0"); // the whole history, back to the first version
});

test("Settings > About has What's new only when the shell gives it, and Show closes Settings and opens it", async () => {
  const { fillSettings } = await import("../src/settings.ts");
  const window = new Window();
  const dialog = window.document.createElement("dialog") as unknown as HTMLDialogElement;
  window.document.body.append(dialog as unknown as Node);
  let opened = 0;
  fillSettings(dialog, { version: "kernel v1", onShortcuts: () => {}, onWhatsNew: () => opened++ });
  const show = dialog.querySelector<HTMLButtonElement>("[data-section=about] #settings-whats-new");
  assert.ok(show, "the row is in About");
  assert.equal(show.textContent, "Show");
  assert.equal(show.closest(".settings-row")!.querySelector("span")!.textContent, "What's new");
  dialog.showModal();
  show.click();
  assert.equal(opened, 1);
  assert.equal(dialog.open, false, "Settings closes first");
  fillSettings(dialog, { version: "", onShortcuts: () => {} });
  assert.equal(dialog.querySelector("#settings-whats-new"), null);
});
