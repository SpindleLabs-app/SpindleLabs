// Friends (account features 6; account chunk only, and only with the ?friends switch, src/friends-switch.ts). The
// account dialog's Friends button opens this dialog: turning Friends on or off, the person's profile ID (Copy, Make a
// new ID), Add a friend by exact ID, requests asking them (Accept, Decline, Block), their friends (Remove, Block),
// requests they sent (Take back) and people they blocked (Unblock). Nobody can be searched for or suggested. The
// account service decides everything (@fission/account friends.ts); this shows what it says. Styles: styles/friends.css
// (the dialog wears the account dialog's look, `.account`, too).

import { askWords, type AuthClient, type DataResult, FAILURE_WORDS, friendCodeKey, friendCodeShown, FRIENDS_LIMITS, friendsApi, type MyFriends, nameDate, turnWords } from "@fission/account";
import "./styles/friends.css";

export const FRIENDS_TITLE = "Friends";
export const FRIENDS_ABOUT = "Add friends by their profile ID. Nobody can search for you or find you any other way: only people you give your ID to can ask. Friends see your display name, never your email or anything else.";
export const FRIENDS_LATER = "Friends is a list for now. Sharing designs with friends comes later.";
export const NO_NAME_WORDS = "No display name";

type El = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

export interface FriendsDialog {
  show(): Promise<void>;
  readonly element: HTMLDialogElement;
}

/** The dialog, made once and filled from the service each time it opens. `copy` puts text on the clipboard. */
export function friendsDialog(client: Pick<AuthClient, "asPerson">, doc: Document = document, copy: (text: string) => Promise<void> = (t) => navigator.clipboard.writeText(t)): FriendsDialog {
  const api = friendsApi(client);
  const el: El = (tag, className, text) => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const button = (text: string, className = "account-action", title?: string) => {
    const b = el("button", className, text);
    b.type = "button";
    if (title) b.title = title;
    return b;
  };
  const dialog = el("dialog", "account friends");
  dialog.id = "friends";
  dialog.setAttribute("aria-labelledby", "friends-title");
  doc.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  let note = "";
  let typed = "";
  /** The question asked in a row (a block, a removal, turning off, a new ID), by its key; one at a time. */
  let asking: string | null = null;

  function frame(): HTMLElement {
    const header = el("header", "account-head");
    const h2 = el("h2", undefined, FRIENDS_TITLE);
    h2.id = "friends-title";
    const close = button("Close", "account-close");
    close.addEventListener("click", () => dialog.close());
    header.append(h2, close);
    const body = el("div", "account-body friends-body");
    dialog.replaceChildren(header, body);
    if (note) {
      const p = el("p", "account-note friends-note", note);
      p.setAttribute("role", "status");
      body.append(p);
    }
    return body;
  }

  const failed = (r: Exclude<DataResult<unknown>, { kind: "ok" }>) => (r.kind === "signed-out" ? "You're signed out. Sign in again to do that." : FAILURE_WORDS[r.reason]);

  /** Runs one change, says `done` (or why it failed) at the top, and reads everything again. */
  async function act<T>(run: () => Promise<DataResult<T>>, done: (v: T) => string): Promise<void> {
    for (const b of dialog.querySelectorAll("button:not(.account-close)")) (b as HTMLButtonElement).disabled = true;
    const r = await run();
    note = r.kind === "ok" ? done(r.value) : `That didn't work. ${failed(r)}`;
    asking = null;
    await load();
  }

  /** A row's question in place of its buttons: the words, then Yes (`yes`) and Cancel. */
  function question(row: HTMLElement, key: string, words: string, yes: string, run: () => void, danger = true): void {
    if (asking !== key) return;
    const q = el("div", "friends-question");
    q.setAttribute("role", "group");
    const go = button(yes, danger ? "account-action account-danger" : "account-action");
    go.addEventListener("click", run);
    const no = button("Cancel");
    no.addEventListener("click", () => {
      asking = null;
      void load();
    });
    q.append(el("p", "account-small", words), go, no);
    row.append(q);
  }

  const shownName = (n: string | null) => n ?? NO_NAME_WORDS;

  function section(body: HTMLElement, title: string, empty: string, count: number): HTMLUListElement {
    const h = el("h3", "friends-heading", count ? `${title} (${count})` : title);
    const list = el("ul", "friends-list");
    body.append(h, list);
    if (!count) list.append(el("li", "account-small friends-empty", empty));
    return list;
  }

  function row(list: HTMLElement, name: string, when: string, ...buttons: HTMLButtonElement[]): HTMLLIElement {
    const li = el("li", "friends-row");
    const who = el("div", "friends-who");
    who.append(el("strong", undefined, name), el("span", "account-small", when));
    const acts = el("div", "friends-acts");
    acts.append(...buttons);
    li.append(who, acts);
    list.append(li);
    return li;
  }

  function off(body: HTMLElement): void {
    body.append(el("p", undefined, FRIENDS_ABOUT), el("p", "account-small", FRIENDS_LATER));
    const on = button("Turn on Friends", "account-action friends-turn-on");
    on.addEventListener("click", () =>
      void act(() => api.turn(true), (v) => (v === "on" ? "Friends is on. Give your profile ID to the people you want to add." : v === "off" ? "" : turnWords(v))),
    );
    body.append(on);
  }

  function on(body: HTMLElement, f: MyFriends): void {
    // The person's own ID.
    const mine = el("div", "friends-mine");
    const label = el("p", "friends-mine-label", "Your profile ID");
    const code = el("code", "friends-code", friendCodeShown(f.code ?? ""));
    code.id = "friends-code";
    const copyIt = button("Copy", "account-action friends-copy");
    copyIt.addEventListener("click", async () => {
      try {
        await copy(friendCodeShown(f.code ?? ""));
        note = "Copied. Send it only to people you know.";
      } catch {
        note = "It couldn't be copied here. Select it and copy it yourself.";
      }
      await load();
    });
    const fresh = button("Make a new ID", "account-action friends-new-code");
    fresh.addEventListener("click", () => {
      asking = "new-code";
      void load();
    });
    const codeRow = el("div", "friends-code-row");
    codeRow.append(code, copyIt, fresh);
    mine.append(label, codeRow, el("p", "account-small", "Give it only to people you want as friends. Making a new ID stops the old one working."));
    question(mine, "new-code", "Make a new ID? Your old one stops working at once. Friends you have stay.", "Make a new ID", () => void act(() => api.newCode(), () => "Your new profile ID is ready."), false);
    body.append(mine);

    // Add a friend.
    const add = el("form", "friends-add");
    add.noValidate = true;
    const addLabel = el("label", "friends-add-label", "Add a friend by their profile ID");
    const input = el("input", "friends-input");
    input.id = "friends-input";
    addLabel.htmlFor = input.id;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.maxLength = 20;
    input.placeholder = "7KX2M-QD9TA";
    input.value = typed;
    input.addEventListener("input", () => (typed = input.value));
    const send = el("button", "account-action friends-send", "Send request");
    send.type = "submit";
    const fields = el("div", "friends-fields");
    fields.append(input, send);
    const left = el("p", "account-small friends-left", `${f.triesLeft} of ${FRIENDS_LIMITS.triesADay} tries left today.`);
    add.append(addLabel, fields, left);
    add.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (friendCodeKey(value) === null) {
        note = askWords("bad");
        return void load();
      }
      void act(() => api.ask(value), (v) => {
        if (v === "sent" || v === "friends") typed = "";
        return askWords(v);
      });
    });
    body.append(add);

    // Asking you.
    const askingList = section(body, "Asking you", "Nobody is asking right now.", f.askingMe.length);
    for (const r of f.askingMe) {
      const yes = button("Accept", "account-action friends-accept");
      yes.addEventListener("click", () => void act(() => api.accept(r.id), (v) => (v === "friends" ? `You're friends with ${shownName(r.name)} now.` : v === "full" ? `One of you has ${FRIENDS_LIMITS.maxFriends} friends already.` : "That request has gone.")));
      const no = button("Decline", "account-action friends-decline", "They aren't told");
      no.addEventListener("click", () => void act(() => api.decline(r.id), () => "Declined. They aren't told."));
      const block = button("Block", "account-action account-danger friends-block");
      block.addEventListener("click", () => {
        asking = `block-${r.id}`;
        void load();
      });
      const li = row(askingList, shownName(r.name), `Asked ${nameDate(r.sentAt)}`, yes, no, block);
      question(li, `block-${r.id}`, `Block ${shownName(r.name)}? They can't ask you again and aren't told.`, "Block", () => void act(() => api.block(r.id), () => "Blocked."));
    }

    // Friends.
    const friendList = section(body, "Your friends", "No friends yet.", f.friends.length);
    for (const fr of f.friends) {
      const remove = button("Remove", "account-action friends-remove");
      remove.addEventListener("click", () => {
        asking = `remove-${fr.id}`;
        void load();
      });
      const block = button("Block", "account-action account-danger friends-block");
      block.addEventListener("click", () => {
        asking = `block-${fr.id}`;
        void load();
      });
      const li = row(friendList, shownName(fr.name), `Friends since ${nameDate(fr.since)}`, remove, block);
      question(li, `remove-${fr.id}`, `Remove ${shownName(fr.name)} from your friends? They aren't told.`, "Remove", () => void act(() => api.remove(fr.id), () => "Removed."));
      question(li, `block-${fr.id}`, `Block ${shownName(fr.name)}? You stop being friends, they can't ask you again, and they aren't told.`, "Block", () => void act(() => api.block(fr.id), () => "Blocked."));
    }

    // Requests sent: only the ID typed, until they say yes.
    if (f.iAsked.length) {
      const sentList = section(body, "You asked", "", f.iAsked.length);
      for (const r of f.iAsked) {
        const back = button("Take back", "account-action friends-cancel");
        back.addEventListener("click", () => void act(() => api.cancel(r.id), () => "Request taken back."));
        row(sentList, friendCodeShown(r.code), `Waiting since ${nameDate(r.sentAt)}`, back);
      }
    }

    // Blocked.
    if (f.blocked.length) {
      const blockedList = section(body, "Blocked", "", f.blocked.length);
      for (const k of f.blocked) {
        const unblock = button("Unblock", "account-action friends-unblock");
        unblock.addEventListener("click", () => void act(() => api.unblock(k.id), () => "Unblocked. They can ask you again."));
        row(blockedList, shownName(k.name), `Blocked ${nameDate(k.since)}`, unblock);
      }
    }

    const offRow = el("div", "friends-off");
    const turnOff = button("Turn off Friends", "account-action account-danger friends-turn-off");
    turnOff.addEventListener("click", () => {
      asking = "off";
      void load();
    });
    offRow.append(el("p", "account-small", FRIENDS_LATER), turnOff);
    question(offRow, "off", "Turn off Friends? Your profile ID, your friends and every request are deleted. People you blocked stay blocked.", "Turn off", () => void act(() => api.turn(false), () => "Friends is off. Your ID, friends and requests are deleted."));
    body.append(offRow);
  }

  async function load(): Promise<void> {
    const r = await api.read();
    const body = frame();
    if (r.kind !== "ok") {
      body.append(el("p", undefined, r.kind === "failed" && r.reason === "rejected" ? "Friends isn't ready on the account service yet." : `Friends couldn't be read. ${failed(r)}`));
      return;
    }
    if (r.value.on) on(body, r.value);
    else off(body);
    if (asking) (dialog.querySelector(".friends-question .account-action") as HTMLButtonElement | null)?.focus();
  }

  return {
    element: dialog,
    async show() {
      note = "";
      asking = null;
      frame().append(el("p", "account-small", "Loading…"));
      if (!dialog.open) dialog.showModal();
      await load();
    },
  };
}
