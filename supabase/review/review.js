// The moderators' review page (community step C5b). Runs only on a moderator's own computer (serve.mjs). Every
// action goes to the moderation function, which checks the moderators' list on the server; nothing here is trusted.
//
// Safety: everything shown that came from people (link names, report reasons, claims, notes) is put on the page as
// text (textContent), never as HTML, and serve.mjs's content security policy lets only this script run, so a report
// can never run code in the moderator's browser. The sign-in is kept in this tab only (sessionStorage).

const TOKEN = "review.token";
const VERIFIER = "review.verifier";
const status = document.getElementById("status");
const main = document.getElementById("main");
let config;

/** A new element with text children only (strings become text nodes, never HTML). */
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "onclick") e.addEventListener("click", v);
    else if (k === "class") e.className = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "error" : "";
}

const when = (t) => (t ? new Date(t).toLocaleString() : "");

// ---- Signing in (Google, through the account service, with PKCE as the app does) ----

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signIn() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(VERIFIER, verifier);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({ provider: "google", redirect_to: `${location.origin}/`, code_challenge: challenge, code_challenge_method: "s256" });
  location.assign(`${config.url}/auth/v1/authorize?${q}`);
}

/** Finishes a sign-in when the page is the return from Google; true when a sign-in was kept. */
async function finishSignIn() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return false;
  history.replaceState(null, "", "/");
  const verifier = sessionStorage.getItem(VERIFIER);
  sessionStorage.removeItem(VERIFIER);
  if (!verifier) return false;
  const res = await fetch(`${config.url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { apikey: config.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!res.ok) return false;
  const s = await res.json();
  if (typeof s.access_token !== "string") return false;
  sessionStorage.setItem(TOKEN, s.access_token);
  return true;
}

function signOut() {
  sessionStorage.removeItem(TOKEN);
  location.assign("/");
}

// ---- Talking to the moderation function ----

const ERRORS = {
  "sign-in": "Your sign-in has run out. Sign in again.",
  "not-a-moderator": "This account is not on the moderators' list.",
  "not-set-up": "The moderation function is not set up yet (its MODERATORS secret).",
  origin: "The moderation function doesn't take requests from this page's address.",
  unavailable: "The database didn't answer. Try again.",
};

/** The function's answer to `ask`, or throws the words to show. */
async function call(ask) {
  const token = sessionStorage.getItem(TOKEN);
  let res;
  try {
    res = await fetch(config.functionUrl, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(ask) });
  } catch {
    throw new Error("Couldn't reach the moderation function.");
  }
  const answer = await res.json().catch(() => ({}));
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN);
    showSignIn();
  }
  if (!res.ok) throw new Error(ERRORS[answer.error] ?? `Refused: ${answer.error ?? res.status}`);
  return answer;
}

/** Runs `job`, showing its failure in the status line. */
async function guarded(job) {
  try {
    say("Working…");
    await job();
    if (status.textContent === "Working…") say("");
  } catch (e) {
    say(e instanceof Error ? e.message : "Something went wrong.", true);
  }
}

/** A decision with a required note: a text box and buttons, each sending `ask(note)` then re-showing. */
function noteForm(label, buttons) {
  const note = el("textarea", { rows: 2, maxlength: 2000, placeholder: "Why (kept in the record; the person never sees it)" });
  const row = el("div", { class: "row" });
  for (const b of buttons) {
    row.append(
      el("button", {
        class: b.danger ? "danger" : "",
        onclick: () =>
          guarded(async () => {
            if (!note.value.trim()) throw new Error("Write why first: every decision keeps its reason.");
            const r = await call(b.ask(note.value.trim()));
            say(r.done === false ? "Nothing changed (it was already that way)." : `${b.label}: done.`);
            await b.after();
          }),
      }, b.label),
    );
  }
  return el("div", { class: "form" }, el("strong", {}, label), note, row);
}

// ---- Views ----

const tabs = { queue: showQueue, claims: showClaims, log: () => showLog() };

async function showQueue() {
  const { queue } = await call({ do: "queue" });
  main.replaceChildren(
    el("section", {},
      el("h2", {}, "Links with reports nobody has looked at"),
      queue.length === 0
        ? el("p", { class: "muted" }, "Nothing to look at.")
        : el("table", {},
            el("tr", {}, el("th", {}, "Link"), el("th", {}, "Reports"), el("th", {}, "Kinds"), el("th", {}, "First report"), el("th", {}, "State")),
            queue.map((q) =>
              el("tr", { class: "pick", onclick: () => guarded(() => showLink(q.share_id)) },
                el("td", {}, q.name ?? "(link no longer exists)"),
                el("td", {}, q.open_reports),
                el("td", {}, (q.kinds ?? []).join(", ")),
                el("td", {}, when(q.first_report)),
                el("td", {}, q.removed_at ? "taken down" : q.off_at ? "turned off by its owner" : "up"),
              )),
          ),
    ),
  );
}

async function showLink(id) {
  const { link, reports, claims, record } = await call({ do: "link", share: id });
  const again = () => showLink(id);
  const parts = [el("p", {}, el("button", { onclick: () => guarded(showQueue) }, "← Reports"))];
  if (!link) {
    parts.push(el("section", {}, el("h2", {}, "This link no longer exists"), el("p", { class: "muted" }, `Its id: ${id}. Its reports are kept.`)));
  } else {
    const picture = typeof link.picture === "string" && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(link.picture) ? el("img", { class: "picture", src: link.picture, alt: "The link's picture" }) : el("p", { class: "muted" }, "No picture.");
    parts.push(
      el("section", {},
        el("h2", {}, link.name),
        picture,
        el("p", {}, `Shared ${when(link.created_at)}, ${link.bytes} bytes. `, link.removed_at ? `Taken down ${when(link.removed_at)}. ` : "", link.off_at ? `Turned off by its owner ${when(link.off_at)}.` : ""),
        el("div", { class: "row" },
          el("button", { onclick: () => guarded(() => showPerson(link.user_id)) }, "Its owner"),
          el("button", { onclick: () => guarded(() => download(id)) }, "Download its file"),
          link.removed_at ? el("button", { onclick: () => guarded(() => showNotice(id)) }, "Email the owner") : null,
        ),
        el("p", { id: "notice" }),
      ),
      el("section", {},
        el("h2", {}, "Decide"),
        noteForm("Take it down, put it back, or dismiss its reports (all open reports count as looked at)", [
          { label: "Take down", danger: true, ask: (note) => ({ do: "decide", share: id, decision: "take-down", note }), after: again },
          { label: "Put back", ask: (note) => ({ do: "decide", share: id, decision: "put-back", note }), after: again },
          { label: "Dismiss reports", ask: (note) => ({ do: "decide", share: id, decision: "dismiss", note }), after: again },
        ]),
      ),
    );
  }
  parts.push(
    el("section", {},
      el("h2", {}, `Reports (${reports.length})`),
      el("table", {},
        el("tr", {}, el("th", {}, "When"), el("th", {}, "Kind"), el("th", {}, "Reason"), el("th", {}, "From"), el("th", {}, "Looked at")),
        reports.map((r) => el("tr", {}, el("td", {}, when(r.created_at)), el("td", {}, r.kind), el("td", { class: "reason" }, r.reason ?? ""), el("td", {}, r.reporter ?? "signed out"), el("td", {}, when(r.reviewed_at) || "not yet"))),
      ),
    ),
    claimsTable(claims, again),
    recordTable(record),
  );
  main.replaceChildren(...parts);
}

async function download(id) {
  const { design } = await call({ do: "design", share: id });
  if (!design || !design.body) throw new Error("This link's file is empty (turned off, or never there).");
  const url = URL.createObjectURL(new Blob([design.body], { type: "application/octet-stream" }));
  const a = el("a", { href: url, download: "shared-design.spindle.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  say("Downloaded. Open it in the app to look at it.");
}

// The words of the takedown email: a PLACEHOLDER until the legal check (kernel repo, docs/plans/legal.md).
function noticeText(name) {
  return `Hello,\n\nYour SpindleLabs sharing link "${name}" has been taken down after a review, because it was found to break the sharing rules. People opening the link now see that it isn't available. Your design itself is untouched in your account.\n\nIf you think this is a mistake, reply to this email and say why, and we will look at it again.\n\nSpindleLabs\n\n[PLACEHOLDER wording until the legal check]`;
}

async function showNotice(id) {
  const { email, name } = await call({ do: "notice", share: id });
  const box = document.getElementById("notice");
  if (!email) {
    box.replaceChildren("No email for the owner (the account may have gone).");
    return;
  }
  const body = noticeText(name);
  const mail = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Your SpindleLabs link was taken down")}&body=${encodeURIComponent(body)}`;
  box.replaceChildren(el("div", { class: "placeholder" }, `To: ${email}\n\n${body}`), el("p", {}, el("a", { href: mail }, "Open in my email program")));
}

async function showPerson(user) {
  const { name, hold, links, record } = await call({ do: "person", user });
  const again = () => showPerson(user);
  const reason = el("input", { maxlength: 500, placeholder: "Reason the person is shown (Download my data)" });
  const days = el("input", { type: "number", min: 1, max: 3650, value: 7 });
  const closed = el("input", { type: "checkbox" });
  const takeLinks = el("input", { type: "checkbox" });
  main.replaceChildren(
    el("p", {}, el("button", { onclick: () => guarded(showQueue) }, "← Reports")),
    el("section", {},
      el("h2", {}, name ? `Account: ${name}` : "Account (no name chosen)"),
      el("p", { class: "muted" }, `Id ${user}`),
      el("p", {}, hold ? `Held since ${when(hold.since)}, ${hold.until ? `until ${when(hold.until)}` : "closed for good"}: ${hold.reason}` : "Not held."),
    ),
    el("section", {},
      el("h2", {}, "Name"),
      noteForm("Take their name away (they pick another)", [{ label: "Take name away", danger: true, ask: (note) => ({ do: "reset-name", user, note }), after: again }]),
    ),
    el("section", {},
      el("h2", {}, "Hold"),
      el("div", { class: "form" },
        el("label", {}, "Reason they are shown ", reason),
        el("label", {}, "Days ", days, " or ", closed, " closed for good"),
        el("label", {}, takeLinks, " also take every link of theirs down"),
      ),
      noteForm("Hold the account (no new links, name changes or reports)", [
        { label: "Hold", danger: true, ask: (note) => ({ do: "hold", user, days: closed.checked ? null : Number(days.value), reason: reason.value.trim(), take_links: takeLinks.checked, note }), after: again },
        { label: "End hold", ask: (note) => ({ do: "end-hold", user, note }), after: again },
      ]),
    ),
    el("section", {},
      el("h2", {}, `Links (${links.length})`),
      el("table", {},
        el("tr", {}, el("th", {}, "Link"), el("th", {}, "Shared"), el("th", {}, "State")),
        links.map((l) => el("tr", { class: "pick", onclick: () => guarded(() => showLink(l.id)) }, el("td", {}, l.name), el("td", {}, when(l.created_at)), el("td", {}, l.removed_at ? "taken down" : l.off_at ? "off" : "up"))),
      ),
    ),
    recordTable(record),
  );
}

function claimsTable(claims, after) {
  return el("section", {},
    el("h2", {}, `Copyright claims (${claims.length})`),
    claims.length === 0
      ? el("p", { class: "muted" }, "None.")
      : claims.map((c) =>
          el("div", { class: "form" },
            el("p", { class: "reason" }, `Claim ${c.id}, ${when(c.received_at)}: ${c.claimant} (${c.contact})\nWork: ${c.work}\n${c.outcome === "open" ? "Open" : `${c.outcome} ${when(c.decided_at)}`}${c.share_id ? `\nLink ${c.share_id}` : ""}`),
            c.share_id ? el("button", { onclick: () => guarded(() => showLink(c.share_id)) }, "Its link") : null,
            c.outcome === "open"
              ? noteForm("Decide the claim", [
                  { label: "Uphold (link stays down)", danger: true, ask: (note) => ({ do: "decide-claim", claim: c.id, outcome: "upheld", note }), after },
                  { label: "Reject (link back if this claim took it down)", ask: (note) => ({ do: "decide-claim", claim: c.id, outcome: "rejected", note }), after },
                ])
              : null,
          )),
  );
}

async function showClaims() {
  const { claims } = await call({ do: "claims" });
  const share = el("input", { placeholder: "The link (its whole address, or the id after ?share=)", maxlength: 500 });
  const claimant = el("input", { maxlength: 200, placeholder: "Who claims (name or company)" });
  const contact = el("input", { maxlength: 200, placeholder: "How to reach them" });
  const work = el("textarea", { rows: 3, maxlength: 2000, placeholder: "The work they say is copied" });
  main.replaceChildren(
    el("section", {},
      el("h2", {}, "Record a claim that came in by email"),
      el("p", { class: "muted" }, "The link goes down at once while the claim is looked at (the takedown process, a placeholder until the legal check)."),
      el("div", { class: "form" }, share, claimant, contact, work,
        el("button", {
          class: "danger",
          onclick: () =>
            guarded(async () => {
              const { claim } = await call({ do: "claim", share: (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(share.value) ?? [share.value.trim()])[0], claimant: claimant.value, contact: contact.value, work: work.value });
              say(claim === null ? "No link with that id." : `Claim ${claim} kept; the link is down.`);
              await showClaims();
            }),
        }, "Record claim and take the link down"),
      ),
    ),
    claimsTable(claims, showClaims),
  );
}

function recordTable(record, more) {
  return el("section", {},
    el("h2", {}, "Record"),
    record.length === 0
      ? el("p", { class: "muted" }, "Nothing yet.")
      : el("table", {},
          el("tr", {}, el("th", {}, "When"), el("th", {}, "What"), el("th", {}, "Who"), el("th", {}, "Why")),
          record.map((r) => el("tr", {}, el("td", {}, when(r.at)), el("td", {}, r.action), el("td", {}, r.moderator), el("td", { class: "reason" }, r.note))),
        ),
    more ?? null,
  );
}

async function showLog(before) {
  const { record } = await call({ do: "log", ...(before ? { before } : {}) });
  const older = record.length === 100 ? el("button", { onclick: () => guarded(() => showLog(record[record.length - 1].id)) }, "Older") : null;
  main.replaceChildren(recordTable(record, older));
}

function showSignIn() {
  document.getElementById("tabs").hidden = true;
  document.getElementById("who").textContent = "";
  main.replaceChildren(el("section", {}, el("h2", {}, "Sign in"), el("p", {}, "Only accounts on the moderators' list can use this page."), el("button", { onclick: () => guarded(signIn) }, "Sign in with Google")));
}

async function start() {
  config = await (await fetch("/config.json")).json();
  await finishSignIn().catch(() => false);
  if (!sessionStorage.getItem(TOKEN)) return showSignIn();
  let moderator;
  try {
    ({ moderator } = await call({ do: "me" }));
  } catch (e) {
    // Not a moderator (or the function not set up): nothing to show but the way out.
    if (sessionStorage.getItem(TOKEN)) main.replaceChildren(el("section", {}, el("button", { onclick: signOut }, "Sign out")));
    throw e;
  }
  document.getElementById("who").textContent = `Signed in as ${moderator}`;
  const nav = document.getElementById("tabs");
  nav.hidden = false;
  for (const b of nav.querySelectorAll("[data-tab]")) b.addEventListener("click", () => guarded(tabs[b.dataset.tab]));
  document.getElementById("sign-out").addEventListener("click", signOut);
  await showQueue();
}

guarded(start);
