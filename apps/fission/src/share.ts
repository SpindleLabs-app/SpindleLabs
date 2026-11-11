// Sharing links in the app (community C2c, C2d). OFF unless the address has `?share` (a link carries it: `?share=<id>`),
// until the lawyer has checked the sharing terms. Loaded with the account code only. Making a link needs a signed-in
// account; opening one needs none, and never changes the link or says who shared it. Nothing here is ever needed for CAD
// or saving.

import { type AuthClient, FAILURE_WORDS, sharesApi } from "@fission/account";
import { SHARE_REFUSALS, shareDialog, sharedView, type ShareDialog, type ShareParts } from "@fission/ui";
import { textForShare } from "./share-text.ts";

/** What the shell lends the sharing code (main.ts). */
export interface ShareHost {
  /** The open design's name and file text, or null when there is nothing to share yet. */
  current(): { name: string; text: string } | null;
  /** A small picture of what is on screen as a data: address, or null. */
  picture(): string | null;
  /** Opens file text as a new project in this browser (replacing the open one, which is kept); throws when it can't be read. */
  openText(text: string, name: string): Promise<void>;
}

export { SHARE_SWITCH } from "./share-switch.ts";
import { SHARE_SWITCH } from "./share-switch.ts";

/** The address of a link on the page `base` (origin and path). */
export const linkAddress = (base: string, id: string) => `${base}?${SHARE_SWITCH}=${id}`;

type Failed = { kind: "failed"; reason: keyof typeof FAILURE_WORDS } | { kind: "signed-out" };
const words = (r: Failed) => (r.kind === "signed-out" ? "You're signed out. Sign in again to share." : FAILURE_WORDS[r.reason]);

export function startShares(client: AuthClient, host: ShareHost, signInWords: (words: string) => void) {
  const api = sharesApi(client);
  const base = () => location.origin + location.pathname;
  let dialog: ShareDialog | null = null;
  const parts: ShareParts = {
      name: () => host.current()?.name ?? "",
      make: async () => {
        const now = host.current();
        if (!now) throw new Error("there is nothing to share yet. Make something first.");
        // Nothing personal leaves the browser in a shared copy (the open format's share export, see share-text.ts).
        const text = await textForShare(now.text);
        const r = await api.share(now.name, text, host.picture());
        if (r.kind !== "ok") throw new Error(words(r));
        if (r.value.status !== "shared") throw new Error(SHARE_REFUSALS[r.value.status]);
        return linkAddress(base(), r.value.id);
      },
      list: async () => {
        const r = await api.list();
        if (r.kind !== "ok") throw new Error(words(r));
        return r.value.map((x) => ({ id: x.id, name: x.name, picture: x.picture, createdAt: x.createdAt, removedAt: x.removedAt }));
      },
      addressOf: (id) => linkAddress(base(), id),
      turnOff: async (id) => {
        const r = await api.unshare(id);
        if (r.kind !== "ok") throw new Error(words(r));
      },
      copy: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
  };
  const dialogFor = () => (dialog ??= shareDialog(document, parts));
  let linksDialog: ShareDialog | null = null;
  const linksFor = () => (linksDialog ??= shareDialog(document, parts, { linksOnly: true }));

  /** Takes the link out of the address, keeping the switch on. */
  function cleanAddress() {
    const url = new URL(location.href);
    if (url.searchParams.get(SHARE_SWITCH)) {
      url.searchParams.set(SHARE_SWITCH, "");
      history.replaceState(history.state, "", url.href);
    }
  }

  return {
    /** File > Share…: the dialog, or Sign in when signed out. */
    show(): void {
      if (client.state().kind === "signed-in") void dialogFor().show();
      else signInWords("Sign in to make a sharing link. People opening a link don't need an account.");
    },
    /** Account dialog > My links: just the list of links that are on, or Sign in when signed out. */
    links(): void {
      if (client.state().kind === "signed-in") void linksFor().show();
      else signInWords("Sign in to see your sharing links.");
    },
    /** A link opened: its frozen copy with Open my own copy and Report, or why there is none. */
    async openLink(id: string): Promise<void> {
      const r = await api.open(id);
      const say = (w: string) => {
        cleanAddress();
        signInWords(w);
      };
      if (r.kind !== "ok") return say(`This shared design couldn't be opened right now. ${r.kind === "signed-out" ? "" : FAILURE_WORDS[r.reason]}`.trim());
      if (r.value === null) return say("This link doesn't open anything: its owner turned it off, it was taken down, or it was never made.");
      const copy = r.value;
      const view = sharedView(
        document,
        { name: copy.name, picture: copy.picture, createdAt: copy.createdAt },
        {
          openCopy: async () => {
            try {
              await host.openText(copy.body, copy.name);
            } catch (e) {
              throw new Error(`this shared file couldn't be opened (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`);
            }
          },
          report: async (kind, reason) => {
            const rr = await api.report(id, kind as never, reason);
            if (rr.kind !== "ok") throw new Error(words(rr));
            return rr.value;
          },
          closed: () => {
            cleanAddress();
            view.element.remove();
          },
        },
      );
      await view.show();
    },
  };
}

export type Shares = ReturnType<typeof startShares>;
