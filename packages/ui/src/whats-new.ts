// What's new (Settings > About): the public list of what changed for the
// person using SpindleLabs, from WHATS_NEW.md at the repository root (the
// app's build passes its text in, with every public line not folded in yet
// numbered by .github/scripts/changelog.py public). Pure: parse the text,
// then build the list's HTML; the shell owns the dialog.

export interface WhatsNewVersion {
  /** "0.35.41". */
  version: string;
  /** "2026-11-07", the day it reached main. */
  date: string;
  /** One plain-words line per change. */
  entries: string[];
}

const HEADING = /^## (\d+\.\d+\.\d+) \((\d{4})-(\d{2})-(\d{2})\)$/;

/**
 * The versions in WHATS_NEW.md's text, newest first, as written. Anything
 * before the first version heading (the title and its note) is left out, a
 * "- " line is one entry, an indented line carries on the entry above it,
 * and a version with no entries is dropped, so a bad hand edit can never
 * show an empty heading.
 */
export function parseWhatsNew(text: string): WhatsNewVersion[] {
  const out: WhatsNewVersion[] = [];
  let current: WhatsNewVersion | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const m = HEADING.exec(line);
    if (m) {
      current = { version: m[1]!, date: `${m[2]}-${m[3]}-${m[4]}`, entries: [] };
      out.push(current);
    } else if (line.startsWith("## ")) {
      current = null; // a heading that isn't a version: its lines aren't shown
    } else if (current && line.startsWith("- ")) {
      current.entries.push(line.slice(2).trim());
    } else if (current && current.entries.length && /^\s+\S/.test(line)) {
      current.entries[current.entries.length - 1] += ` ${line.trim()}`;
    }
  }
  return out.filter((v) => v.entries.length > 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-07" as "7 Nov 2026" (the date is a calendar day, so no time zone moves it). */
export function whatsNewDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** HTML for the list: one section per version, its number and date, then its changes. Every word is escaped. */
export function whatsNewList(versions: readonly WhatsNewVersion[]): string {
  if (!versions.length) return `<p class="whats-new-empty">Nothing to show yet.</p>`;
  return versions
    .map(
      (v) =>
        `<section data-version="${escape(v.version)}"><h3>${escape(v.version)} <time datetime="${escape(v.date)}">${escape(whatsNewDate(v.date))}</time></h3><ul>` +
        v.entries.map((e) => `<li>${escape(e)}</li>`).join("") +
        `</ul></section>`,
    )
    .join("");
}

/** The note under the title: which version this is, when the build knew it (a copy built without main's history doesn't). */
export function whatsNewNote(version: string | null): string {
  return version ? `You have SpindleLabs ${version}. Newest first; a version with nothing you would notice is left out.` : "Newest first; a version with nothing you would notice is left out.";
}
