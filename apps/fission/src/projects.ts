// File > Projects in this browser… (U6a; round 2 hunt A2, A3): the shell's side of the list. The dialog and its
// words are @fission/ui's (project-list.ts); deleting goes through @fission/storage's `forget`, which takes the
// project's journal entries too, so the next visit can't bring it back. Opening is main.ts's `openStored`, since it
// replaces the open project.

import { projectList, type ProjectList } from "@fission/ui";
import { forget, type JournalStorage, type ProjectStore } from "@fission/storage";

export interface ListedProjectsParts {
  store: ProjectStore;
  journal: JournalStorage | null;
  /** The project open now, when it is kept (null while a new one waits for its first change, or a file opens). */
  openId(): string | null;
  open(id: string, modified: Date | null): Promise<void>;
  /** Called once project `id` is deleted (the design tabs close its tab, tabs hunt B3). */
  removed?(id: string): void;
}

/** The dialog, in `doc`. The open project is never deleted, even if the list was read before it opened. */
export function listedProjects(doc: Document, parts: ListedProjectsParts): ProjectList {
  return projectList(doc, {
    list: () => parts.store.list(),
    openId: parts.openId,
    open: parts.open,
    remove: async (id) => {
      if (id === parts.openId()) throw new Error("the open project can't be deleted here");
      await forget(parts.store, parts.journal, id);
      parts.removed?.(id);
    },
  });
}
