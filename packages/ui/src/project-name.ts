// The open project's name in the middle of the top bar (UI audit 2026-11-12, Ben's choice A): the bar's empty middle
// shows which project is open, and a click there renames it in place (until now nothing on screen could rename the open
// project). It reads as plain text until pointed at or focused. Enter or leaving the box commits the name, Escape puts the
// old one back; an empty or unchanged name changes nothing. The shell makes a rename an undo step and stores it.
// Styles: styles/project-name.css.

export interface ProjectNameParts {
  /** The open project's name now. */
  name(): string;
  /** Called with the new name (trimmed, not empty, not the old one, at most `maxLength`). */
  rename(name: string): void;
  maxLength: number;
}

export interface ProjectNameBox {
  element: HTMLInputElement;
  /** Shows the name as it is now (after an undo, or another project opened); leaves the box alone while it is being typed in. */
  refresh(): void;
}

/** The name a typed `text` gives the project now called `current`, or null when it changes nothing. */
export function nameToKeep(text: string, current: string, maxLength: number): string | null {
  const name = text.trim().slice(0, maxLength).trim();
  return name === "" || name === current ? null : name;
}

export function projectNameBox(doc: Document, parts: ProjectNameParts): ProjectNameBox {
  const input = doc.createElement("input");
  input.id = "project-name";
  input.className = "project-name";
  input.type = "text";
  input.maxLength = parts.maxLength;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Project name");
  input.title = "The project's name: click to rename it";
  const show = () => {
    input.value = parts.name();
    input.dataset.empty = String(input.value === "");
  };
  const commit = () => {
    const name = nameToKeep(input.value, parts.name(), parts.maxLength);
    if (name !== null) parts.rename(name);
    show();
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // the name's own Escape, not the workspace's
      show();
      input.blur();
    }
  });
  show();
  return {
    element: input,
    refresh() {
      if (doc.activeElement !== input) show();
    },
  };
}
