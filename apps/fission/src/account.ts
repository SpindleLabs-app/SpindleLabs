// Optional accounts in the app: a Sign in button on the top bar and an
// Account dialog. Loaded only when accounts.config.mjs turns accounts on.
// Nothing here is ever needed for CAD, slicing or saving: with no account,
// no network or a broken service, the app works exactly as before.
// The service is contacted only when the person signs in, returns from
// signing in, or uses their session; a visit with no account sends nothing.

import { authClient, type AuthClient, checkConfig, FAILURE_WORDS, SESSION_KEY, type SmallStore } from "@fission/account";
import "./styles/account.css";

/** What signing in gives, shown beside the button. Each line must be true in the build that ships it. */
export const SIGN_IN_GIVES = [
  "SpindleLabs Pro and its AI allowance when they open, on any device you sign in on.",
  "News of new features first, if you choose to get emails.",
];

function browserStore(): SmallStore {
  try {
    return window.localStorage;
  } catch {
    // Storage blocked: every call fails, which the account code treats as "can't keep a sign-in".
    const no = () => {
      throw new Error("storage unavailable");
    };
    return { getItem: no, setItem: no, removeItem: no };
  }
}

export async function startAccounts(service: { url: string; anonKey: string }): Promise<void> {
  const redirectTo = location.origin + location.pathname;
  const checked = checkConfig({ ...service, redirectTo });
  if (!checked.ok) return; // a build with broken settings simply has no sign-in
  const client = authClient({
    config: checked.config,
    fetch: (input, init) => fetch(input, init),
    store: browserStore(),
    now: () => Date.now(),
    random: (bytes) => void crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>),
  });
  const ui = accountUi(client);
  // Back from the sign-in page: finish, and take the code out of the address straight away.
  const back = await client.finishSignIn(location.href);
  if (back.kind !== "none") history.replaceState(history.state, "", back.cleanUrl);
  ui.render();
  if (back.kind === "failed") ui.open(FAILURE_WORDS[back.reason]);
  // Another tab signing in or out shows here too.
  addEventListener("storage", (e) => {
    if (e.key === SESSION_KEY || e.key === null) ui.render();
  });
}

function accountUi(client: AuthClient) {
  const doc = document;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const button = el("button", "account-open");
  button.id = "account-open";
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  doc.getElementById("settings-open")?.before(button);

  const dialog = el("dialog", "account");
  dialog.id = "account";
  dialog.setAttribute("aria-labelledby", "account-title");
  doc.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  button.addEventListener("click", () => open());

  function render() {
    const state = client.state();
    if (state.kind === "signed-in") {
      const first = state.user.name.split(/\s+/)[0] ?? "";
      button.textContent = first || "Account";
      button.title = `Signed in as ${state.user.email || state.user.name}`;
      button.classList.add("account-signed-in");
    } else {
      button.textContent = "Sign in";
      button.title = "Sign in with Google (optional: everything works without an account)";
      button.classList.remove("account-signed-in");
    }
    if (dialog.open) fill();
  }

  let note = "";
  function fill() {
    const state = client.state();
    const header = el("header", "account-head");
    const h2 = el("h2", undefined, state.kind === "signed-in" ? "Your account" : "Sign in to SpindleLabs");
    h2.id = "account-title";
    const close = el("button", "account-close", "Close");
    close.type = "button";
    close.addEventListener("click", () => dialog.close());
    header.append(h2, close);
    const body = el("div", "account-body");
    if (note) {
      const p = el("p", "account-note", note);
      p.setAttribute("role", "status");
      body.append(p);
    }
    if (state.kind === "signed-in") {
      const who = el("p", "account-who");
      who.append(el("strong", undefined, state.user.name || state.user.email), el("span", undefined, state.user.name ? state.user.email : ""));
      const out = el("button", "account-action", "Sign out");
      out.type = "button";
      out.addEventListener("click", async () => {
        out.disabled = true;
        const { ended } = await client.signOut();
        note = ended ? "Signed out." : "Signed out on this device. The sign-in service couldn't be reached, so the old session stops working by itself within the hour.";
        render();
      });
      body.append(who, out);
    } else {
      const list = el("ul", "account-gives");
      for (const line of SIGN_IN_GIVES) list.append(el("li", undefined, line));
      const go = el("button", "account-action account-google", "Sign in with Google");
      go.type = "button";
      go.addEventListener("click", async () => {
        go.disabled = true;
        const url = await client.beginSignIn();
        if (url) return location.assign(url);
        note = FAILURE_WORDS.storage;
        fill();
      });
      body.append(list, go, el("p", "account-small", "Optional: SpindleLabs works fully without an account, and your designs stay on this device either way."));
    }
    const privacy = el("a", "account-small", "Privacy and terms");
    privacy.href = "privacy.html";
    body.append(privacy);
    dialog.replaceChildren(header, body);
  }

  function open(message = "") {
    note = message;
    fill();
    if (!dialog.open) dialog.showModal();
  }

  return { render, open };
}
