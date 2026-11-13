// The Display name row of the Account dialog (community C6b). The row asks the account service for the person's name and
// shows it with the day it may change next; the service decides what a name may be, so every refusal it gives is said in words.
// A service that doesn't have the names function yet (the migration is applied by the owner) leaves the row out. Loaded with
// the account code only; nothing in CAD or saving ever needs it.

import { type AuthClient, FAILURE_WORDS, type MyName, NAME_LIMITS, nameDate, namesApi, nameWords } from "@fission/account";
import "./styles/display-name.css";

/** The row, empty and hidden until the service answers. `now` is the clock (tests move it). */
export function displayNameRow(client: Pick<AuthClient, "asPerson">, now: () => number = Date.now): HTMLElement {
  const api = namesApi(client);
  const row = document.createElement("form");
  row.className = "display-name";
  row.hidden = true;
  row.noValidate = true;
  const label = document.createElement("label");
  label.className = "display-name-label";
  label.textContent = "Display name";
  const input = document.createElement("input");
  input.className = "display-name-input";
  input.id = "display-name";
  label.htmlFor = input.id;
  input.type = "text";
  input.maxLength = NAME_LIMITS.maxLength;
  input.autocomplete = "off";
  input.spellcheck = false;
  const save = document.createElement("button");
  save.className = "account-action display-name-save";
  save.type = "submit";
  save.textContent = "Save name";
  const hint = document.createElement("p");
  hint.className = "account-small display-name-hint";
  hint.setAttribute("role", "status");
  const fields = document.createElement("div");
  fields.className = "display-name-fields";
  fields.append(input, save);
  row.append(label, fields, hint);

  let current: MyName | null = null;
  const base = "Use a name that isn't your real name. You can change it once a week.";
  function show(mine: MyName | null, note?: string): void {
    current = mine;
    input.value = mine?.name ?? input.value;
    const waiting = mine !== null && mine.nextChangeAt.getTime() > now();
    input.disabled = save.disabled = waiting;
    hint.textContent = note ?? (waiting && mine ? `You can change it again on ${nameDate(mine.nextChangeAt)}.` : base);
  }
  async function load(): Promise<void> {
    const r = await api.mine();
    if (r.kind === "failed" && r.reason === "rejected") return; // this service doesn't have display names yet
    if (r.kind === "signed-out") return;
    row.hidden = false;
    if (r.kind === "failed") {
      input.disabled = save.disabled = true;
      hint.textContent = `Your display name couldn't be read. ${FAILURE_WORDS[r.reason]}`;
      return;
    }
    show(r.value);
  }
  row.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    input.value = name;
    if (name === (current?.name ?? "")) return show(current, current ? "That's already your name." : "Type a name first.");
    input.disabled = save.disabled = true;
    const r = await api.set(name);
    input.disabled = save.disabled = false;
    if (r.kind !== "ok") return show(current, `Not saved. ${r.kind === "signed-out" ? "You're signed out. Sign in again to do that." : FAILURE_WORDS[r.reason]}`);
    // Saved or refused, read the account again so the day it may change next is the service's own.
    const again = await api.mine();
    const mine = again.kind === "ok" ? again.value : current;
    if (r.value === "saved") return show(mine, mine ? "Saved." : undefined);
    show(mine, nameWords(r.value, mine?.nextChangeAt));
    input.value = name; // a refused name stays in the box to be fixed
  });
  void load();
  return row;
}
