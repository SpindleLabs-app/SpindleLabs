// Report a bug (Ben, 2026-11-04; easier 2026-11-11): one optional box, the
// person's design attached, sent to SpindleLabs' report address when there
// is one, otherwise a filled-in GitHub issue with the design downloaded to
// drag into it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUG_REPORT_EMPTY, BUG_REPORT_ORIGINS, BUG_REPORT_SERVICE, bugReportEndpoint, MAX_DESIGN_BYTES, bugDesignFile, bugReportBody, bugReportDialog, bugReportPayload, bugReportTitle, bugReportUrl, ISSUES_NEW, MAX_REPORT_URL, sendBugReport, type BugReport } from "../src/bug-report.ts";

const { Window } = await import("happy-dom");

const report = (o: Partial<BugReport> = {}): BugReport => ({ what: "Extrude & undo lose the sketch", version: "0.35.2 (kernel v0.9.1)", browser: "Firefox 140", screen: "1280 × 800", workspace: "Design", errors: [], design: "Attached: Bracket.spindle.json (1 KB).", ...o });

test("hand-worked: the title is the first line, after Bug:, and the link carries it encoded", () => {
  assert.equal(bugReportTitle("Extrude & undo lose the sketch\nmore words", "Design"), "Bug: Extrude & undo lose the sketch");
  // encodeURIComponent: ":" is %3A, a space %20, "&" %26, so "Bug: Extrude & undo" becomes "Bug%3A%20Extrude%20%26%20undo".
  const made = bugReportUrl(report({ what: "Extrude & undo" }));
  assert.ok("url" in made);
  assert.ok(made.url.startsWith(`${ISSUES_NEW}?title=Bug%3A%20Extrude%20%26%20undo&body=`), made.url.slice(0, 120));
  // A long first line is cut at 80 characters with an ellipsis.
  assert.equal(bugReportTitle("x".repeat(100), "Design"), `Bug: ${"x".repeat(79)}…`);
  // Nothing typed: the title says where it came from instead.
  assert.equal(bugReportTitle("  \n", "Design"), "Bug report from Design");
});

test("the body has what happened, the app's facts, the design's line and the recent errors", () => {
  const body = bugReportBody(report({ errors: ["TypeError: a is undefined", "Kernel: refused"] }));
  for (const part of ["### What happened\n\nExtrude & undo lose the sketch", "- Version: 0.35.2 (kernel v0.9.1)", "- Browser: Firefox 140", "- Screen: 1280 × 800", "- Workspace: Design", "### Design\n\nAttached: Bracket.spindle.json (1 KB).", "### Recent errors\n\n```\nTypeError: a is undefined\nKernel: refused\n```"]) assert.ok(body.includes(part), `missing ${JSON.stringify(part)}`);
  // Nothing typed: it says so rather than vanish; no errors, no errors part.
  const bare = bugReportBody(report({ what: " ", errors: [] }));
  assert.ok(bare.includes("### What happened\n\n(not given)"));
  assert.ok(!bare.includes("Recent errors"));
});

test("typing is optional when the design comes along; with neither, the report is refused", () => {
  const file = bugDesignFile({ name: "Bracket", text: "{}" }, true);
  assert.ok(file.file);
  assert.ok("payload" in bugReportPayload(report({ what: "" }), file.file));
  assert.deepEqual(bugReportPayload(report({ what: "  " }), null), { refused: BUG_REPORT_EMPTY });
  assert.deepEqual(bugReportUrl(report({ what: "  " }), false), { refused: BUG_REPORT_EMPTY });
  // Words alone are enough too.
  assert.ok("payload" in bugReportPayload(report(), null));
});

test("hand-worked: the design's file name, size line and the payload sent", () => {
  // "{}" is 2 bytes, under 1 KB, shown as 1 KB (rounded up so a small file never says 0 KB).
  const small = bugDesignFile({ name: "My bracket/v2", text: "{}" }, true);
  // "/" can't be in a file name, so it becomes "-".
  assert.deepEqual(small, { file: { name: "My bracket-v2.spindle.json", text: "{}" }, note: "Attached: My bracket-v2.spindle.json (1 KB)." });
  // 3,000 bytes of "é" (2 bytes each in UTF-8, 1,500 characters) is 3,000 / 1,024 = 2.93, so 3 KB.
  assert.equal(bugDesignFile({ name: "e", text: "é".repeat(1500) }, true).note, "Attached: e.spindle.json (3 KB).");
  assert.deepEqual(bugDesignFile({ name: "Bracket", text: "{}" }, false), { file: null, note: "Not included (the person chose not to)." });
  assert.deepEqual(bugDesignFile(null, true), { file: null, note: "No design open." });
  assert.deepEqual(bugDesignFile({ name: "", text: "{}" }, true).file?.name, "Untitled.spindle.json");
  const made = bugReportPayload(report({ design: small.note }), small.file);
  assert.ok("payload" in made);
  assert.deepEqual(Object.keys(made.payload).sort(), ["body", "design", "title"]);
  assert.equal(made.payload.title, "Bug: Extrude & undo lose the sketch");
  assert.deepEqual(made.payload.design, small.file);
});

test("a design at 0.9× the size limit is attached; at 1.1× it is left out, saying so", () => {
  const under = bugDesignFile({ name: "a", text: "a".repeat(Math.floor(0.9 * MAX_DESIGN_BYTES)) }, true);
  assert.ok(under.file, "0.9×: attached");
  const over = bugDesignFile({ name: "a", text: "a".repeat(Math.ceil(1.1 * MAX_DESIGN_BYTES)) }, true);
  assert.equal(over.file, null, "1.1×: left out");
  // 1.1 × 5 MiB = 5.5 MiB.
  assert.equal(over.note, "Too big to send (5.5 MB; the limit is 5 MB).");
});

test("a link at 0.9× the limit is kept whole; one at 1.1× is cut to fit, saying so, never past the limit", () => {
  const base = bugReportUrl(report({ what: "a" }));
  assert.ok("url" in base);
  const per = encodeURIComponent("a").length; // one plain letter is one character in the link
  const fill = (target: number) => "a".repeat(Math.round((target - base.url.length) / per) + 1);
  const small = bugReportUrl(report({ what: fill(0.9 * MAX_REPORT_URL) }));
  assert.ok("url" in small && !small.cut, "0.9×: kept whole");
  const big = bugReportUrl(report({ what: fill(1.1 * MAX_REPORT_URL) }));
  assert.ok("url" in big && big.cut, "1.1×: cut");
  assert.ok(big.url.length <= MAX_REPORT_URL, `${big.url.length} > ${MAX_REPORT_URL}`);
  assert.ok(decodeURIComponent(big.url.split("&body=")[1]).includes("(cut to fit the link: paste the rest into the issue)"));
});

const okFetch = (answer: unknown, status = 200) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
};

test("sending posts the payload as JSON and reads back the report's number", async () => {
  const { f, calls } = okFetch({ issue: 12 });
  const payload = { title: "Bug: x", body: "b", design: null };
  assert.deepEqual(await sendBugReport("https://example.org/report", payload, f), { sent: 12 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), payload);
});

test("a refused, broken or unreachable send fails in words, never throws", async () => {
  const payload = { title: "Bug: x", body: "b", design: null };
  assert.deepEqual(await sendBugReport("https://example.org/report", payload, okFetch({ error: "slow down" }, 429).f), { failed: "Too many reports from here just now." });
  assert.deepEqual(await sendBugReport("https://example.org/report", payload, okFetch({}, 500).f), { failed: "The report service had a problem (500)." });
  assert.deepEqual(await sendBugReport("https://example.org/report", payload, okFetch({ issue: "twelve" }).f), { failed: "The report service gave an answer we couldn't read." });
  const down = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  assert.deepEqual(await sendBugReport("https://example.org/report", payload, down), { failed: "Couldn't reach the report service." });
});

function dialogIn(o: { endpoint: string; fetch?: typeof fetch; design?: { name: string; text: string } | null }) {
  const window = new Window({ url: "https://example.org/" });
  const doc = window.document as unknown as Document;
  const opened: string[] = [];
  const downloads: { name: string; text: string }[] = [];
  const d = bugReportDialog(doc, {
    facts: () => ({ version: "0.35.2", browser: "Firefox 140", screen: "1280 × 800", workspace: "Design", errors: ["Kernel: refused"] }),
    design: () => (o.design === undefined ? { name: "Bracket", text: '{"kind":"project"}' } : o.design),
    open: (url) => opened.push(url),
    download: (name, text) => downloads.push({ name, text }),
    endpoint: o.endpoint,
    fetch: o.fetch,
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  return { d, doc, opened, downloads, $ };
}

test("the dialog: one optional box and the design ticked; Send with nothing typed sends the design", async () => {
  const { f, calls } = okFetch({ issue: 7 });
  const { d, $, opened } = dialogIn({ endpoint: "https://example.org/report", fetch: f });
  d.show();
  assert.equal(d.dialog.querySelectorAll("textarea").length, 1, "one box");
  assert.equal($<HTMLInputElement>("bug-report-design").checked, true, "the design is ticked");
  assert.equal($("bug-report-go").textContent, "Send");
  await d.send();
  assert.equal(calls.length, 1);
  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.title, "Bug report from Design");
  assert.deepEqual(sent.design, { name: "Bracket.spindle.json", text: '{"kind":"project"}' });
  assert.ok(sent.body.includes("Kernel: refused"), "recent errors go along");
  assert.equal($("bug-report-status").textContent, "Sent as report 7. Thank you!");
  assert.equal(opened.length, 0, "no GitHub tab");
});

test("the dialog: unticking the design with nothing typed is refused in words, nothing sent", async () => {
  const { f, calls } = okFetch({ issue: 7 });
  const { d, $ } = dialogIn({ endpoint: "https://example.org/report", fetch: f });
  d.show();
  $<HTMLInputElement>("bug-report-design").checked = false;
  await d.send();
  assert.equal(calls.length, 0);
  assert.equal($("bug-report-status").textContent, BUG_REPORT_EMPTY);
});

test("the dialog: a failed send keeps the words and offers GitHub, which opens the issue and downloads the design", async () => {
  const down = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const { d, $, opened, downloads } = dialogIn({ endpoint: "https://example.org/report", fetch: down });
  d.show();
  $<HTMLTextAreaElement>("bug-report-what").value = "Fillet vanished";
  await d.send();
  assert.equal(opened.length, 0, "nothing opened after a wait: a browser would block a tab opened late");
  assert.ok($("bug-report-status").textContent?.startsWith("Couldn't reach the report service."));
  assert.equal($("bug-report-go").textContent, "Open on GitHub");
  assert.equal(d.dialog.open, true, "the form stays");
  await d.send();
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0]).searchParams.get("title"), "Bug: Fillet vanished");
  assert.deepEqual(downloads, [{ name: "Bracket.spindle.json", text: '{"kind":"project"}' }]);
  assert.ok(new URL(opened[0]).searchParams.get("body")?.includes("drag it into this issue"));
});

test("the dialog: with no report address it goes straight to GitHub, the design downloaded", async () => {
  const { d, $, opened, downloads } = dialogIn({ endpoint: "" });
  d.show();
  assert.equal($("bug-report-go").textContent, "Open on GitHub");
  assert.ok($("bug-report-note").textContent?.includes("public"), "the note says GitHub issues are public");
  await d.send();
  assert.equal(opened.length, 1);
  assert.equal(downloads.length, 1);
  assert.equal(d.dialog.open, false, "closes once opened");
});

test("reports go to the service only from SpindleLabs' own pages; elsewhere to a test's fake service, else GitHub", async () => {
  assert.equal(bugReportEndpoint("https://spindlelabs.app"), BUG_REPORT_SERVICE);
  assert.equal(bugReportEndpoint("https://spindlelabs-app.github.io", "https://fake.test"), BUG_REPORT_SERVICE, "a page of ours never takes an override");
  assert.equal(bugReportEndpoint("http://localhost:4303"), "", "a dev server or test build: GitHub");
  assert.equal(bugReportEndpoint("http://localhost:4303", "https://fake.test/send"), "https://fake.test/send");
  assert.equal(bugReportEndpoint("https://spindlelabs.app.evil.example"), "", "only exact origins");
  // The service takes reports from exactly these pages, or it would refuse ours.
  // Found by walking up, so the test also runs from mutation testing's copy of the package.
  const { existsSync, readFileSync } = await import("node:fs");
  let dir = new URL("./", import.meta.url);
  while (!existsSync(new URL("supabase/functions/bug-report/index.ts", dir)) && dir.pathname !== "/") dir = new URL("../", dir);
  const fn = readFileSync(new URL("supabase/functions/bug-report/index.ts", dir), "utf8");
  assert.equal(fn.match(/export const APP_ORIGINS = (\[[^\]]*\]);/)?.[1], JSON.stringify(BUG_REPORT_ORIGINS).replaceAll(",", ", "));
});

test("the dialog: a moving bar shows while a report is sending, and goes when it is sent or fails", async () => {
  let answer!: (r: Response) => void;
  const slow = (() => new Promise<Response>((r) => (answer = r))) as unknown as typeof fetch;
  const { d, $ } = dialogIn({ endpoint: "https://example.org/report", fetch: slow });
  d.show();
  const bar = $("bug-report-progress");
  assert.equal(bar.hidden, true, "no bar before Send");
  assert.equal(bar.getAttribute("role"), "progressbar");
  const sending = d.send();
  assert.equal(bar.hidden, false, "the bar shows while sending");
  assert.equal($("bug-report-status").textContent, "Sending… this can take a few seconds.");
  assert.ok($("bug-report-status").classList.contains("bug-report-calm"), "sending isn't shown in the warning colour");
  assert.equal($<HTMLButtonElement>("bug-report-go").disabled, true);
  answer(new Response(JSON.stringify({ issue: 3 }), { status: 200 }));
  await sending;
  assert.equal(bar.hidden, true, "gone once sent");
  // And after a failure.
  const down = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const w = dialogIn({ endpoint: "https://example.org/report", fetch: down });
  w.d.show();
  await w.d.send();
  assert.equal(w.$("bug-report-progress").hidden, true, "gone after a failure");
});
