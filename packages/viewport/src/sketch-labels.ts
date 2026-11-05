// The edited sketch's dimension values (step 47e, Design's constraint-tool.ts
// `dimensionLabels`): one small label each, kept over its spot on the
// sketch's plane as the camera moves (`place`, every frame the main view
// draws). The labels only show; a workspace hears their clicks itself, by
// the `data-dimension` each carries. A spot behind the camera hides its
// label. Styles: src/styles/sketch-labels.css.

/** One label: the dimension it shows (its id), its world point, its words, and whether it fought the one just refused (drawn red). */
export interface PlacedLabel {
  id: string;
  world: readonly number[];
  text: string;
  fighting?: boolean;
}

export class SketchLabels {
  private readonly root: HTMLElement;
  private shown: PlacedLabel[] = [];
  private readonly els = new Map<string, HTMLElement>();
  /** What the labels were last placed for: the camera's state and their words, so a still view moves nothing. */
  private placedFor = "";

  constructor(host: HTMLElement) {
    this.root = host.ownerDocument.createElement("div");
    this.root.className = "sketch-labels";
    host.append(this.root);
  }

  /** Replaces the labels shown; an empty list hides them all. */
  show(labels: readonly PlacedLabel[]) {
    this.shown = [...labels];
    const keep = new Set(labels.map((l) => l.id));
    for (const [id, el] of this.els) if (!keep.has(id)) (el.remove(), this.els.delete(id));
    for (const l of labels) {
      let el = this.els.get(l.id);
      if (!el) {
        const button = this.root.ownerDocument.createElement("button");
        button.type = "button";
        el = button;
        el.className = "sketch-label";
        el.dataset.dimension = l.id;
        el.tabIndex = -1; // a label is changed by a double-click or tap, not by Tab
        this.els.set(l.id, el);
        this.root.append(el);
      }
      el.textContent = l.text;
      el.title = `${l.text}: double-click to change`;
      el.classList.toggle("sketch-label-fighting", l.fighting === true);
    }
    this.placedFor = "";
  }

  /** Puts each label over its point, `screen` giving each world point's spot in the view's pixels (null: behind the camera). */
  place(key: string, screen: (points: readonly (readonly number[])[]) => ({ x: number; y: number } | null)[]) {
    const words = this.shown.map((l) => l.text).join("|");
    if (this.placedFor === `${key}|${words}`) return;
    this.placedFor = `${key}|${words}`;
    const at = screen(this.shown.map((l) => l.world));
    this.shown.forEach((l, k) => {
      const el = this.els.get(l.id)!;
      const p = at[k];
      el.hidden = p === null || !Number.isFinite(p.x) || !Number.isFinite(p.y);
      if (p && !el.hidden) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
    });
  }
}
