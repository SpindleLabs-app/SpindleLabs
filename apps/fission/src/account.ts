// Optional accounts in the app: a Sign in button on the top bar and an
// Account dialog. Loaded only when accounts.config.mjs turns accounts on.
// Nothing here is ever needed for CAD, slicing or saving: with no account,
// no network or a broken service, the app works exactly as before.
// The service is contacted only when the person signs in, returns from
// signing in, or uses their session; a visit with no account sends nothing.

import { accountData, type AccountData, authClient, type AuthClient, checkConfig, type DataResult, FAILURE_WORDS, PENDING_EMAIL_KEY, type Plan, SESSION_KEY, type SmallStore } from "@fission/account";
import { withIcon } from "@fission/ui";
import "./styles/account.css";

/** What signing in gives, shown beside the button. Each line must be true in the build that ships it. */
export const SIGN_IN_GIVES = [
  "SpindleLabs Pro and its AI allowance when they open, on any device you sign in on.",
  "News of new features first, if you choose to get emails.",
];

/**
 * Payments are in Stripe's TEST MODE: no real money is taken, and the dialog says so.
 * Live payments wait for the lawyer's review and the hosting move (the billing function
 * refuses a live key too). Pro's features (the AI allowance) aren't built yet, so Pro
 * shows only its badge.
 */
export const PAYMENTS_TEST_MODE = true;

/** The words for each Pro price (the prices are set in Stripe; these must match them). */
export const PRO_PRICES = {
  monthly: "US$9 a month",
  yearly: "US$54 for the first year, then US$90 a year",
};

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
  const store = browserStore();
  const data = accountData(client, store);
  const ui = accountUi(client, data, store);
  // Back from the sign-in page: finish, and take the code out of the address straight away.
  const back = await client.finishSignIn(location.href);
  if (back.kind !== "none") history.replaceState(history.state, "", back.cleanUrl);
  ui.render();
  if (back.kind === "failed") ui.open(FAILURE_WORDS[back.reason]);
  // Back from Stripe's checkout page: take the marker out of the address, then say what happened.
  const paid = new URL(location.href).searchParams.get("checkout");
  if (paid === "done" || paid === "cancelled") {
    const clean = new URL(location.href);
    clean.searchParams.delete("checkout");
    history.replaceState(history.state, "", clean.href);
    if (client.state().kind === "signed-in") ui.open(paid === "done" ? PAID_WORDS : "Checkout was cancelled. Nothing was charged.", paid === "done");
  }
  // A yes to emails ticked before signing in is recorded now; a no needs nothing (it is the default).
  let pendingYes = false;
  try {
    pendingYes = store.getItem(PENDING_EMAIL_KEY) === "yes";
    store.removeItem(PENDING_EMAIL_KEY);
  } catch {
    // Storage blocked: there was no choice kept.
  }
  if (back.kind === "signed-in" && pendingYes) {
    const r = await data.setEmailChoice(true);
    if (r.kind !== "ok") ui.open("Signed in, but your yes to emails couldn't be saved. You can tick it again under your account.");
  }
  // Another tab signing in or out shows here too.
  addEventListener("storage", (e) => {
    if (e.key === SESSION_KEY || e.key === null) ui.render();
  });
}

const PAID_WORDS = "Thanks! Stripe took the test payment. Pro shows here as soon as Stripe confirms it, usually within a few seconds.";

/** The plain words for a data request that didn't work. */
function dataWords(r: Exclude<DataResult<unknown>, { kind: "ok" }>): string {
  return r.kind === "signed-out" ? "You're signed out. Sign in again to do that." : FAILURE_WORDS[r.reason];
}

function accountUi(client: AuthClient, data: AccountData, store: SmallStore) {
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
  withIcon(button, "account", 16);
  const word = button.querySelector(".tool-word")!;
  doc.getElementById("settings-open")?.before(button);
  doc.body.classList.add("account-on"); // styles/account.css: the bar's narrow widths

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
      word.textContent = first || "Account";
      button.title = `Signed in as ${state.user.email || state.user.name}`;
      button.classList.add("account-signed-in");
    } else {
      word.textContent = "Sign in";
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
      const emails = emailBox(false);
      // The choice last seen in this browser shows at once; the service's answer then puts it right if it differs
      // (changed on another device). With none seen, the box waits for the answer.
      const seen = data.lastEmailChoice();
      if (seen === null) emails.input.disabled = true;
      else emails.input.checked = seen;
      let touched = false; // a tick or untick made before the answer came wins over it: that change is being saved
      void data.emailChoice().then((r) => {
        if (touched) return;
        if (r.kind === "ok") {
          emails.input.checked = r.value;
          emails.input.disabled = false;
        } else emails.hint.textContent = `Your email choice couldn't be read${seen === null ? "" : ", so this may be out of date"}. ${dataWords(r)}`;
      });
      emails.input.addEventListener("change", async () => {
        touched = true;
        const want = emails.input.checked;
        emails.input.disabled = true;
        const r = await data.setEmailChoice(want);
        emails.input.disabled = false;
        if (r.kind === "ok") emails.hint.textContent = want ? "Saved: you'll get emails about new features and Pro." : "Saved: no emails.";
        else {
          emails.input.checked = !want;
          emails.hint.textContent = `Not saved. ${dataWords(r)}`;
        }
      });
      const out = el("button", "account-action", "Sign out");
      out.type = "button";
      out.addEventListener("click", async () => {
        out.disabled = true;
        data.forgetEmailChoice();
        const { ended } = await client.signOut();
        note = ended ? "Signed out." : "Signed out on this device. The sign-in service couldn't be reached, so the old session stops working by itself within the hour.";
        render();
      });
      const plan = planBox();
      const yours = el("div", "account-yours");
      const copy = el("button", "account-action", "Download my data");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        copy.disabled = true;
        const r = await data.myData();
        copy.disabled = false;
        if (r.kind !== "ok") return say(dataWords(r));
        const a = el("a");
        a.href = URL.createObjectURL(new Blob([r.value], { type: "application/json" }));
        a.download = "spindlelabs-account.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      const del = el("button", "account-action account-danger", "Delete my account");
      del.type = "button";
      del.addEventListener("click", () => confirmDelete());
      yours.append(copy, del);
      body.append(who, plan, emails.row, out, yours);
    } else {
      const list = el("ul", "account-gives");
      for (const line of SIGN_IN_GIVES) list.append(el("li", undefined, line));
      const go = el("button", "account-action account-google", "Sign in with Google");
      go.type = "button";
      const emails = emailBox(true);
      go.addEventListener("click", async () => {
        go.disabled = true;
        try {
          if (emails.input.checked) store.setItem(PENDING_EMAIL_KEY, "yes");
          else store.removeItem(PENDING_EMAIL_KEY);
        } catch {
          // Storage blocked: sign-in can't finish either, and says so below.
        }
        const url = await client.beginSignIn();
        if (url) return location.assign(url);
        note = FAILURE_WORDS.storage;
        fill();
      });
      body.append(list, emails.row, go, el("p", "account-small", "Optional: SpindleLabs works fully without an account, and your designs stay on this device either way."));
    }
    const privacy = el("a", "account-small", "Privacy and terms");
    privacy.href = "privacy.html";
    body.append(privacy);
    dialog.replaceChildren(header, body);
  }

  /** The email choice: a separate box, never ticked for the person. */
  function emailBox(beforeSignIn: boolean) {
    const row = el("label", "account-emails");
    const input = el("input");
    input.type = "checkbox";
    input.checked = false;
    input.id = "account-emails";
    const words = el("span", undefined, "Email me about new features and SpindleLabs Pro. You can stop any time.");
    const hint = el("span", "account-small");
    hint.setAttribute("role", "status");
    if (beforeSignIn) hint.textContent = "Optional. Leave it unticked and we won't email you.";
    const text = el("span", "account-emails-text");
    text.append(words, hint);
    row.append(input, text);
    return { row, input, hint };
  }

  /** Waiting for Stripe's confirmation after a checkout: the plan is read again a few times. */
  let waitForPro = 0;
  /** The plan: Pro with its badge and Manage, or the Upgrade buttons (test mode says so). */
  function planBox() {
    const box = el("section", "account-plan");
    box.setAttribute("aria-label", "Your plan");
    box.append(el("p", "account-small", "Checking your plan…"));
    const show = (r: DataResult<Plan>) => {
      if (!box.isConnected) return;
      if (r.kind !== "ok") return box.replaceChildren(el("p", "account-small", `Your plan couldn't be checked. ${dataWords(r)}`));
      const p = r.value;
      if (p.plan === "free" && waitForPro > 0) {
        waitForPro--;
        setTimeout(() => void data.plan().then(show), 2000);
      } else waitForPro = 0;
      button.classList.toggle("account-is-pro", p.plan === "pro");
      if (p.plan === "pro" || p.plan === "team") return box.replaceChildren(...paidLines(p));
      box.replaceChildren(...upgradeLines());
    };
    void data.plan().then(show);
    return box;
  }

  function badgeLine(word: string) {
    const head = el("p", "account-plan-head");
    head.append(el("strong", "account-pro-badge", word));
    if (PAYMENTS_TEST_MODE) head.append(el("span", "account-test-tag", "Test mode"));
    return head;
  }

  function paidLines(p: Plan) {
    const when = p.renewsAt ? new Date(p.renewsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
    const lines: HTMLElement[] = [badgeLine(p.plan === "team" ? "Team" : "Pro")];
    if (when) lines.push(el("p", "account-small", p.cancels ? `Pro ends on ${when}. It won't renew.` : `Renews on ${when}.`));
    lines.push(el("p", "account-small", "Pro's features (the AI allowance) are on their way. For now Pro shows this badge."));
    if (p.plan === "pro") {
      const manage = el("button", "account-plan-action", "Manage or cancel Pro");
      manage.type = "button";
      manage.addEventListener("click", () => toStripe(manage, () => data.manage(location.origin + location.pathname)));
      lines.push(manage);
    }
    return lines;
  }

  function upgradeLines() {
    const lines: HTMLElement[] = [badgeLine("SpindleLabs Pro"), el("p", undefined, `${PRO_PRICES.monthly}, or ${PRO_PRICES.yearly}.`)];
    if (PAYMENTS_TEST_MODE)
      lines.push(el("p", "account-small", "Test mode: no real money is taken. Pay with Stripe's test card 4242 4242 4242 4242, any future date and any CVC. Pro's features aren't built yet, so Pro shows a badge for now."));
    const row = el("div", "account-yours");
    for (const which of ["monthly", "yearly"] as const) {
      const go = el("button", "account-plan-action account-upgrade", which === "monthly" ? "Upgrade: US$9 a month" : "Upgrade: US$54 first year");
      go.type = "button";
      go.dataset.plan = which;
      go.addEventListener("click", () => toStripe(go, () => data.checkout(which, location.origin + location.pathname)));
      row.append(go);
    }
    lines.push(row, el("p", "account-small", "Paid through Stripe, who keep the card details. SpindleLabs never sees them."));
    return lines;
  }

  /** Off to one of Stripe's pages, or a plain sentence when that can't happen. */
  async function toStripe(b: HTMLButtonElement, page: () => Promise<DataResult<string>>) {
    b.disabled = true;
    const r = await page();
    if (r.kind === "ok") return location.assign(r.value);
    b.disabled = false;
    say(r.kind === "failed" && r.reason === "rejected" ? "Payments aren't ready yet. Please try again later." : dataWords(r));
  }

  function say(message: string) {
    note = message;
    fill();
  }

  /** Deleting asks once more, in the dialog, naming what goes and what stays. */
  function confirmDelete() {
    const header = el("header", "account-head");
    const h2 = el("h2", undefined, "Delete your account?");
    h2.id = "account-title";
    header.append(h2);
    const body = el("div", "account-body");
    const yes = el("button", "account-action account-danger", "Delete my account");
    yes.type = "button";
    const no = el("button", "account-action", "Keep my account");
    no.type = "button";
    no.addEventListener("click", () => fill());
    yes.addEventListener("click", async () => {
      yes.disabled = no.disabled = true;
      const r = await data.deleteAccount();
      if (r.kind === "ok") {
        note = "Your account was deleted. Designs on this device are still here.";
        render();
        return fill();
      }
      say(`Your account was not deleted. ${dataWords(r)}`);
    });
    const row = el("div", "account-yours");
    row.append(no, yes);
    body.append(el("p", undefined, "This deletes your sign-in, your plan and your email choice from SpindleLabs' servers, straight away. If you have Pro, it is cancelled at Stripe first, so nothing more is charged. It can't be undone."), el("p", undefined, "Designs on this device are not touched."), row);
    dialog.replaceChildren(header, body);
  }

  function open(message = "", afterPayment = false) {
    note = message;
    if (afterPayment) waitForPro = 10;
    fill();
    if (!dialog.open) dialog.showModal();
  }

  return { render, open };
}
