// The notice under the top bar (#file-status). Two kinds: a passing one reports something that went wrong right
// then (a file refused, an undo that failed) and goes away by itself at the next change to the project, on a new
// project, or after NOTICE_SECONDS; a sticky one carries a warning the person must read (unsaved work, a project that
// didn't open) and stays until Dismiss. Test: e2e/file-notice.test.mjs.

export const NOTICE_SECONDS = 20;

export type NoticeClock = { set: (f: () => void, ms: number) => unknown; clear: (id: unknown) => void };

export function fileNotice(box: { show: (text: string) => void; read: () => string }, clock: NoticeClock) {
  let passingText: string | null = null; // the words shown as a passing notice, while they are still showing
  let timer: unknown = null;
  const stop = () => {
    if (timer !== null) clock.clear(timer);
    timer = null;
    passingText = null;
  };
  /** Takes a passing notice away, only if it is still the one showing. */
  const clearPassing = () => {
    if (passingText !== null && box.read() === passingText) box.show("");
    stop();
  };
  return {
    sticky(text: string) {
      stop();
      box.show(text);
    },
    passing(text: string) {
      stop();
      box.show(text);
      if (text === "") return;
      passingText = text;
      timer = clock.set(clearPassing, NOTICE_SECONDS * 1000);
    },
    /** The project changed (an edit, a new or opened project). */
    changed: clearPassing,
  };
}
