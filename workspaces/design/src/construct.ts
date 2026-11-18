// Construction planes, axes and points (step 59a1): the item put in at the
// marker, its description and its undo step. The data and its names are
// construct-data.ts; the reader's checks document.ts `checkConstruct`; the
// rebuild rebuild.ts `constructRun`. No tool in the app yet (59a2 brings
// the Construct menu behind `?construct`).

import type { Feature } from "@fission/core";
import { answerProblem, CONSTRUCT_KINDS, constructInputs, kindNumber, readConstructRef, type ConstructAnswer, type ConstructKind } from "./construct-data.ts";
import { constructBase, constructNumberProblem, counted, freshName, insertAt, insertItem, isConstructItem, takenNames, type DesignDocument } from "./document.ts";

/** The undo step a new construction is recorded as. */
export const CONSTRUCT_STEP = "Construct";

/** What each kind is called in a description. */
export const KIND_WORDS: Record<ConstructKind, string> = {
  offset_plane: "Offset plane",
  angle_plane: "Plane at an angle",
  mid_plane: "Midplane",
  plane_through_points: "Plane through three points",
  plane_through_line_and_point: "Plane through a line and a point",
  axis_through_points: "Axis through two points",
  axis_along: "Axis along a line",
  axis_where_planes_meet: "Axis where two planes meet",
  axis_square_to_plane: "Axis square to a plane",
  point_at: "Point at a corner",
  point_midway: "Point midway along an edge",
  point_centre: "Point at a centre",
  point_where_line_crosses: "Point where a line crosses a plane",
  point_where_planes_meet: "Point where three planes meet",
};

/** A number in a description: at most three decimals, as the panels show sizes. */
const short = (x: number) => String(Number(x.toFixed(3)));

/** A construction's description: "Offset plane, 5 mm", "Plane at an angle, 30°", "Midplane". */
export function constructSummary(make: ConstructKind, number?: number): string {
  const need = kindNumber(make);
  if (need === null || number === undefined) return KIND_WORDS[make];
  return `${KIND_WORDS[make]}, ${short(number)}${need === "distance" ? " mm" : "°"}`;
}

/**
 * The design with a new construction (`make` from `inputs`, by slot, each a
 * name construct-data.ts reads, and `number`, the distance or angle its kind
 * needs) put in at the marker ("Plane 1", "Axis 2", "Point 1"; its id from
 * the counter), holding `answer`, the kernel's answer for it now, and its
 * id. Refused in words for a slot missing, extra or not a name, an earlier
 * construction that is not one before the marker, a number its kind doesn't
 * take or can't be, and an answer that is not what its kind makes.
 */
export function insertConstruct(doc: DesignDocument, make: ConstructKind, inputs: Readonly<Record<string, string>>, number: number | undefined, answer: ConstructAnswer): { doc: DesignDocument; id: string } {
  const spec = CONSTRUCT_KINDS[make];
  const slots: readonly string[] = spec.slots;
  for (const key of Object.keys(inputs)) if (!slots.includes(key)) throw new Error(`${KIND_WORDS[make]} takes no ${key}`);
  const at = insertAt(doc);
  for (const slot of slots) {
    if (!Object.hasOwn(inputs, slot)) throw new Error(`${KIND_WORDS[make]} needs its ${slot}`);
    const ref = readConstructRef(inputs[slot]);
    if (ref === null) throw new Error(`${JSON.stringify(inputs[slot])} is not a name of a plane, axis, point, face, edge or corner`);
    if (ref.kind !== "construct") continue;
    const place = doc.timeline.features.findIndex((f) => f.id === ref.item);
    if (place < 0 || place >= at || !isConstructItem(doc.timeline.features[place])) throw new Error(`${ref.item} is not a construction before the marker`);
  }
  const need = kindNumber(make);
  const numbers = need === null || number === undefined ? {} : { [need]: number };
  const problem = constructNumberProblem(make, need !== null && number === undefined ? { [need]: undefined } : numbers);
  if (problem !== null) throw new Error(`The ${KIND_WORDS[make].toLowerCase()} can't be made: ${problem}`);
  const wrong = answerProblem(answer, spec.makes);
  if (wrong !== null) throw new Error(`The kernel's answer can't be kept: ${wrong}`);
  const id = `feature-${doc.nextId}`;
  const base = { plane: "Plane", axis: "Axis", point: "Point" }[spec.makes];
  const label = freshName(base, doc.timeline.features.filter((f) => isConstructItem(f) && constructBase(f) === base).length, takenNames(doc));
  const dependsOn = constructInputs(inputs, make);
  const from = dependsOn.flatMap((d) => {
    const f = doc.timeline.features.find((x) => x.id === d);
    return f === undefined ? [] : [{ workspace: "design" as const, id: f.id, label: f.provenance.self.label }];
  });
  const feature: Feature = {
    id,
    intent: { type: "construct", parameters: { make, inputs: { ...inputs }, ...numbers, answer: { ...answer } }, summary: constructSummary(make, number) },
    provenance: { self: { workspace: "design", id, label }, from },
    dependsOn,
    suppressed: false,
  };
  return { id, doc: { ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) } };
}
