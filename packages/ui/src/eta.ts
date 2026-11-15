// When each not-yet-built workspace is expected, in words ("late 2027"), shown
// instead of a bare "Coming soon" (Ben, 2026-11-15: be honest with people).
// Rough, and leaning late: they follow the roadmap order (curved booleans,
// then fillets and chamfers, then slicing, features and the beginner rework)
// and move when the plan does. Tools have theirs in design's coming-soon.ts.

/** A rough window, always "<early|mid|late> <year>" or just "<year>". */
export type Eta = string;

/** Expected windows by workspace id (and "community"). */
export const WORKSPACE_ETA: Readonly<Record<string, Eta>> = {
  render: "late 2027",
  simulate: "2028",
  manufacture: "2028",
  laser: "late 2027",
  slice: "late 2027",
  circuit: "2028",
  vector: "late 2027",
  layout: "2028",
  community: "late 2027",
};

/** "late 2027" as a label: "Late 2027". */
export const etaLabel = (eta: Eta): string => eta.charAt(0).toUpperCase() + eta.slice(1);

/** A workspace's expected window; the honest "not scheduled yet" when there is none. */
export const workspaceEta = (id: string): Eta => WORKSPACE_ETA[id] ?? "not scheduled yet";
