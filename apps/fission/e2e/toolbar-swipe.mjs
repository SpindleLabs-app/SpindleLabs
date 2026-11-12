// A finger's swipe along the toolbar until a button is in sight (UI audit 2026-11-12: at phone width the sketch's
// toolbar is one row that scrolls sideways, so a tool past the screen's edge is reached the way a person reaches it).
// page.tap scrolls a button into view by itself and a finger doesn't, so the browser checks that ask whether a tool is
// on screen swipe first, with real touches (CDP), and then measure.
import assert from "node:assert/strict";

/** Swipes along #toolbar (at most 8 swipes of 200 px, towards the button) until `selector` is wholly in the window; its box. */
export async function swipeIntoSight(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (let k = 0; ; k++) {
      const box = await page.locator(selector).boundingBox();
      const width = await page.evaluate(() => innerWidth);
      assert.ok(box, `${selector} is drawn`);
      if (box.x >= -1 && box.x + box.width <= width + 1) return box;
      assert.ok(k < 8, `${selector} still out of sight after 8 swipes (x ${box.x}..${box.x + box.width})`);
      const bar = await page.$eval("#toolbar", (b) => { const r = b.getBoundingClientRect(); return { y: r.top + r.height / 2, left: r.left, right: r.right }; });
      // Right of the window: the finger goes from the right towards the left, and the other way for a button off the left.
      const leftward = box.x + box.width > width;
      const from = leftward ? Math.min(bar.right, width) - 20 : bar.left + 20;
      const step = leftward ? -20 : 20;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y: bar.y }] });
      for (let s = 1; s <= 10; s++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + step * s, y: bar.y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      // Let the scroll settle (two frames, then a short wait for any momentum).
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(150);
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
}
