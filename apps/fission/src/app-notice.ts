// The app's one notice at the foot of the page (#app-update): a sentence and
// one button. Offline mode's "a new version is ready" (offline.ts) and the
// kernel lost to an update or the network (kernel-lost.ts) use it; one is
// shown at a time, the newest. Styles: styles/app-update.css.
import "./styles/app-update.css";

export type NoticeButton = { label: string; title: string; press: () => void };

/** Shows the notice `kind` with `words` and its button (and a quieter second one, such as Not now), in place of any other. */
export function showNotice(kind: string, words: string, button: NoticeButton, other?: NoticeButton) {
  hideNotice();
  const box = Object.assign(document.createElement("div"), { id: "app-update", className: "app-update" });
  box.setAttribute("role", "status");
  box.dataset.kind = kind;
  const text = Object.assign(document.createElement("span"), { textContent: words });
  const press = Object.assign(document.createElement("button"), { type: "button", id: "app-update-reload", textContent: button.label });
  press.title = button.title;
  press.addEventListener("click", () => {
    press.disabled = true;
    const second = document.getElementById("app-update-other") as HTMLButtonElement | null;
    if (second) second.disabled = true;
    button.press();
  });
  box.append(text, press);
  if (other) {
    const second = Object.assign(document.createElement("button"), { type: "button", id: "app-update-other", className: "quiet", textContent: other.label });
    second.title = other.title;
    second.addEventListener("click", () => {
      press.disabled = second.disabled = true;
      other.press();
    });
    box.append(second);
  }
  document.body.append(box);
}

/** Takes the notice away: any, or only the notice `kind`. */
export function hideNotice(kind?: string) {
  const box = document.getElementById("app-update");
  if (box && (kind === undefined || box.dataset.kind === kind)) box.remove();
}
