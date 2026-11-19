// Helpers for the browser checks of the Slice page's print panel (SP5b2b; the checks moved here from the dialog).

/**
 * Shows the Slice page and waits for its Slice and download button (the design's bodies are listed by then). On a phone the
 * print panel is in the Properties sheet, which its toggle opens.
 */
export async function openSlice(page, tap = false) {
  await page.evaluate(() => (location.hash = "#slice"));
  await page.waitForFunction(() => document.body.dataset.activeWorkspace === "slice", null, { timeout: 30000 });
  const button = page.locator("#slice-page-download");
  if (!(await button.isVisible())) {
    const toggle = page.locator("#properties-toggle");
    if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) !== "true") await (tap ? toggle.tap() : toggle.click());
  }
  await button.waitFor({ state: "visible", timeout: 30000 });
}

/**
 * Chooses the option of a Slice page menu (`id` without `slice-page-`, e.g. "walls") by its words: the option whose label is
 * exactly `text`, else the first containing it. The menus' values are positions, so a check names the words it sees.
 */
export async function pick(page, id, text) {
  const index = await page.$eval(`#slice-page-${id}`, (select, t) => {
    const labels = [...select.options].map((o) => o.textContent);
    const at = labels.includes(t) ? labels.indexOf(t) : labels.findIndex((l) => l.includes(t));
    return at;
  }, text);
  if (index < 0) throw new Error(`no option "${text}" in #slice-page-${id}`);
  await page.selectOption(`#slice-page-${id}`, { index });
}

/** The words of the option a Slice page menu shows. */
export const picked = (page, id) => page.$eval(`#slice-page-${id}`, (s) => s.options[s.selectedIndex].textContent);
