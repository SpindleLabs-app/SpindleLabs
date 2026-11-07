// Which workspaces have work in a project (U6a): the home screen lists each project with the workspaces that hold
// something. Only Design keeps data in the project file today (the other workspaces are placeholders, or hold their
// pictures elsewhere), so a workspace with nothing saved is never claimed; a new workspace that saves into the project
// adds its rule to RULES, with its own test. A part that can't be read as a document is "no work", never an error:
// the home screen must list every project, whatever is in it.

import type { Project, WorkspaceId } from "./project.ts";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0;

/** Each workspace's rule: does its saved part (read as plain data) hold work? */
const RULES: Partial<Record<WorkspaceId, (data: unknown) => boolean>> = {
  // Design: a sketch or a timeline step. A fresh document has neither.
  design: (data) => isObject(data) && (nonEmpty(data.sketches) || (isObject(data.timeline) && nonEmpty(data.timeline.features))),
};

/** The workspaces holding work in `project`, in the app's own order (WorkspaceId's). Never throws. */
export function workspacesWithWork(project: Pick<Project, "workspaces">): WorkspaceId[] {
  const parts: unknown = project.workspaces;
  if (!isObject(parts)) return [];
  const out: WorkspaceId[] = [];
  for (const id of Object.keys(RULES) as WorkspaceId[]) {
    try {
      if (RULES[id]!(parts[id])) out.push(id);
    } catch {
      // a part that can't be read holds no work we can name
    }
  }
  return out;
}
