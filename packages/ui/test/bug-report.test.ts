// Report a bug (Ben, 2026-11-04): the form's words become a new GitHub
// issue on the public SpindleLabs repo, filled in, opened in a new tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUG_REPORT_EMPTY, bugReportBody, bugReportTitle, bugReportUrl, ISSUES_NEW, MAX_REPORT_URL, type BugReport } from "../src/bug-report.ts";

const report = (o: Partial<BugReport> = {}): BugReport => ({ what: "Extrude & undo lose the sketch", steps: "1. Draw a circle\n2. Extrude\n3. Ctrl+Z", expected: "The sketch comes back", version: "0.35.2 (kernel v0.9.1)", browser: "Firefox 140", screen: "1280 × 800", workspace: "Design", ...o });

test("hand-worked: the title is the first line, after Bug:, and the link carries it encoded", () => {
  assert.equal(bugReportTitle("Extrude & undo lose the sketch\nmore words"), "Bug: Extrude & undo lose the sketch");
  // encodeURIComponent: ":" is %3A, a space %20, "&" %26, so "Bug: Extrude & undo" becomes "Bug%3A%20Extrude%20%26%20undo".
  const { url } = bugReportUrl(report({ what: "Extrude & undo" }));
  assert.ok(url.startsWith(`${ISSUES_NEW}?title=Bug%3A%20Extrude%20%26%20undo&body=`), url.slice(0, 120));
  // A long first line is cut at 80 characters with an ellipsis.
  const t = bugReportTitle("x".repeat(100));
  assert.equal(t, `Bug: ${"x".repeat(79)}…`);
});

test("the body has each part under its heading, and the app's facts the person didn't type", () => {
  const body = bugReportBody(report());
  for (const part of ["### What went wrong\n\nExtrude & undo lose the sketch", "### Steps\n\n1. Draw a circle\n2. Extrude\n3. Ctrl+Z", "### What should have happened\n\nThe sketch comes back", "- Version: 0.35.2 (kernel v0.9.1)", "- Browser: Firefox 140", "- Screen: 1280 × 800", "- Workspace: Design"]) assert.ok(body.includes(part), `missing ${JSON.stringify(part)}`);
  // Left empty, a part says so rather than vanish.
  assert.ok(bugReportBody(report({ steps: "  ", expected: "" })).includes("### Steps\n\n(not given)"));
});

test("nothing typed in What went wrong is refused", () => {
  assert.deepEqual(bugReportUrl(report({ what: "  \n " })), { refused: BUG_REPORT_EMPTY });
});

test("a link at 0.9× the limit is kept whole; one at 1.1× is cut to fit, saying so, never past the limit", () => {
  // Make the steps long enough that the whole link is 0.9× and 1.1× the limit.
  const base = bugReportUrl(report({ steps: "" }));
  assert.ok("url" in base);
  const per = encodeURIComponent("a").length; // one plain letter is one character in the link
  const fill = (target: number) => "a".repeat(Math.round((target - base.url.length) / per));
  const small = bugReportUrl(report({ steps: fill(0.9 * MAX_REPORT_URL) }));
  assert.ok("url" in small && !small.cut, "0.9×: kept whole");
  const big = bugReportUrl(report({ steps: fill(1.1 * MAX_REPORT_URL) }));
  assert.ok("url" in big && big.cut, "1.1×: cut");
  assert.ok(big.url.length <= MAX_REPORT_URL, `${big.url.length} > ${MAX_REPORT_URL}`);
  assert.ok(decodeURIComponent(big.url.split("&body=")[1]).includes("(cut to fit the link: paste the rest into the issue)"));
});
