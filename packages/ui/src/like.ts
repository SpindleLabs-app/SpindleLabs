// The like button and count on a shared design (community C7b; behind the app's ?share switch with the rest of sharing).
// One button that shows whether the person likes it (aria-pressed) and the count beside it, never who liked it. The
// requests are the shell's (apps/fission src/share.ts through @fission/account likes.ts); this is the row and its words.
// Styles: styles/like.css. Used by the shared view (share.ts), and later by library entries.

/** What the row shows. `mine` is null when nobody is signed in (the count shows; pressing says to sign in). */
export interface LikeState {
  readonly count: number;
  readonly mine: boolean | null;
}

export interface LikeParts {
  /** The count and whether the person likes it; null leaves the row out (no likes at this service, or sharing off). */
  read(): Promise<LikeState | null>;
  /** Likes (true) or takes the like back (false); gives the new state, or throws the words to say when it can't. */
  set(like: boolean): Promise<LikeState>;
}

export const SIGN_IN_TO_LIKE = "Sign in to like designs. Looking at them and opening your own copy need no account.";
export const likeCountText = (n: number): string => (n === 0 ? "No likes yet" : `${n.toLocaleString("en")} ${n === 1 ? "like" : "likes"}`);

export interface LikeRow {
  readonly element: HTMLElement;
  /** Reads the state and shows the row (it stays hidden when `read` gives null or fails). */
  load(): Promise<void>;
}

/** The row, hidden until `load` has an answer. `id` prefixes the ids of its parts (`<id>-like`, `<id>-like-count`). */
export function likeRow(doc: Document, id: string, parts: LikeParts): LikeRow {
  const row = doc.createElement("div");
  row.className = "like";
  row.id = `${id}-like-row`;
  row.hidden = true;
  const button = doc.createElement("button");
  button.type = "button";
  button.id = `${id}-like`;
  button.className = "like-button";
  const heart = doc.createElement("span");
  heart.className = "like-heart";
  heart.setAttribute("aria-hidden", "true");
  const label = doc.createElement("span");
  label.className = "like-label";
  button.append(heart, label);
  const count = doc.createElement("span");
  count.id = `${id}-like-count`;
  count.className = "like-count";
  count.setAttribute("aria-live", "polite");
  const status = doc.createElement("p");
  status.id = `${id}-like-status`;
  status.className = "like-status";
  status.setAttribute("role", "status");
  row.append(button, count, status);

  let state: LikeState | null = null;
  let busy = false;
  function show(s: LikeState): void {
    state = s;
    const on = s.mine === true;
    button.setAttribute("aria-pressed", String(on));
    heart.textContent = on ? "♥" : "♡";
    label.textContent = on ? "Liked" : "Like";
    button.title = s.mine === null ? SIGN_IN_TO_LIKE : on ? "Take your like back" : "Like this design";
    count.textContent = likeCountText(s.count);
    row.hidden = false;
  }
  button.addEventListener("click", async () => {
    if (busy || !state) return;
    status.textContent = "";
    if (state.mine === null) {
      status.textContent = SIGN_IN_TO_LIKE;
      return;
    }
    busy = true;
    row.setAttribute("aria-busy", "true");
    try {
      show(await parts.set(!state.mine));
    } catch (e) {
      status.textContent = (e instanceof Error ? e.message : String(e)).replace(/^./, (c) => c.toUpperCase());
    } finally {
      busy = false;
      row.removeAttribute("aria-busy");
    }
  });
  return {
    element: row,
    async load() {
      try {
        const s = await parts.read();
        if (s) show(s);
      } catch {
        // A count that can't be read leaves the row out: the shared design itself still opens.
      }
    },
  };
}
