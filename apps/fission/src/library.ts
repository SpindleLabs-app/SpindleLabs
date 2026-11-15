// The public library in the app (community C3c): File ▾ > Publish to the library… and My library in the account dialog.
// OFF unless the address has `?share`, with the rest of sharing, until the lawyer has checked the terms. Loaded with the
// account code only. Publishing needs a signed-in account; the open design's text goes through the open format's share
// export first (share-text.ts), so nothing personal is ever in a published copy. Nothing here is ever needed for CAD or
// saving.

import { type AuthClient, draftProblem, FAILURE_WORDS, LICENCE_WORDS, LICENCES, libraryApi, PUBLISH_WORDS } from "@fission/account";
import { type LibraryRow, myLibraryDialog, type MyLibraryParts, publishDialog, type PublishForm, type PublishParts, type ShareDialog } from "@fission/ui";
import type { ShareHost } from "./share.ts";
import { textForShare } from "./share-text.ts";

type Client = Pick<AuthClient, "asPerson" | "asAnyone" | "asPersonStorage" | "getSignedFile">;
type Failed = { kind: "failed"; reason: keyof typeof FAILURE_WORDS } | { kind: "signed-out" };
const words = (r: Failed) => (r.kind === "signed-out" ? "You're signed out. Sign in again to publish." : FAILURE_WORDS[r.reason]);

/** The two dialogs' requests (pure of the page, so test/library-app.test.ts in @fission/account drives them on the fake). */
export function libraryParts(client: Client, host: Pick<ShareHost, "current" | "picture">): { publish: PublishParts; mine: MyLibraryParts } {
  const api = libraryApi(client);
  const publish: PublishParts = {
    name: () => host.current()?.name ?? "",
    picture: () => host.picture(),
    licences: LICENCES.map((id) => ({ id, name: LICENCE_WORDS[id].name, says: LICENCE_WORDS[id].says })),
    // The size is checked when publishing (the text isn't read on every key): a stand-in body here.
    problem: (f) => {
      const p = draftProblem({ ...f, body: "{}" });
      return p ? PUBLISH_WORDS.bad[p] : null;
    },
    async publish(f: PublishForm) {
      const now = host.current();
      if (!now) throw new Error("there is nothing to publish yet. Make something first.");
      const text = await textForShare(now.text);
      const r = await api.publish({ ...f, body: text });
      if (r.kind !== "ok") throw new Error(words(r));
      const a = r.value;
      if (a.status === "published") return;
      throw new Error(a.status === "bad" ? PUBLISH_WORDS.bad[a.problem] : PUBLISH_WORDS[a.status]);
    },
  };
  const mine: MyLibraryParts = {
    async list() {
      const r = await api.mine();
      if (r.kind !== "ok") throw new Error(words(r));
      const rows: LibraryRow[] = [];
      for (const e of r.value) {
        // Off with its file still there (taken down here before its file went, or a publish that never finished): the
        // file is deleted now, quietly, so it never counts against the person's space. The row isn't shown.
        if (e.state === "off") {
          if (e.bytes !== null) await api.deleteFile(e.id);
          continue;
        }
        rows.push({ id: e.id, title: e.title, picture: e.picture, state: e.removedAt ? "removed" : e.state === "live" ? "live" : "waiting", at: e.publishedAt ?? e.createdAt });
      }
      return rows;
    },
    async takeDown(id) {
      const r = await api.remove(id);
      if (r.kind !== "ok") throw new Error(words(r));
    },
  };
  return { publish, mine };
}

export function startLibrary(client: AuthClient, host: ShareHost, signInWords: (words: string) => void) {
  const parts = libraryParts(client, host);
  let publishing: ShareDialog | null = null;
  let listing: ShareDialog | null = null;
  return {
    /** File > Publish to the library…: the dialog, or Sign in when signed out. */
    publish(): void {
      if (client.state().kind === "signed-in") void (publishing ??= publishDialog(document, parts.publish)).show();
      else signInWords("Sign in to publish a design to the library. Browsing it doesn't need an account.");
    },
    /** Account dialog > My library: the person's published designs, or Sign in when signed out. */
    mine(): void {
      if (client.state().kind === "signed-in") void (listing ??= myLibraryDialog(document, parts.mine)).show();
      else signInWords("Sign in to see the designs you have published.");
    },
  };
}

export type Library = ReturnType<typeof startLibrary>;
