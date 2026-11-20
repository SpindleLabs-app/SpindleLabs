// The bodies of a design as the slicing engine's STL files (tests only): what Design's Slice for printing dialog used to
// hand the engine, kept so the engine's tests on the shipped kernel (slice-engine.test.ts) still run through a design.
import type { BuildPlate, Feature, KernelCalls, StlFile } from "@fission/core";
import { FILE_DEFAULTS, type NozzleType, type PrintChoices, printFileOfStls, sliceStls } from "@fission/print";
import { bodyIdOf, type DesignDocument } from "../src/document.ts";
import { endStls } from "../src/move-tool.ts";

export type SliceBody = Feature | { body: string; feature: Feature };

function bodyFiles(kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[]): () => Promise<Uint8Array[]> {
  return async () => {
    if (features.length === 0) throw new Error("There is no body to slice: make or show one first.");
    const files: StlFile[] = await endStls(kernel, doc, features.map((f) => ("body" in f ? { ...f, name: "body" } : { body: bodyIdOf(f.id), feature: f, name: "body" })));
    return files.map((f) => f.bytes);
  };
}

export const sliceBodies = (kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[], choices: PrintChoices) => sliceStls(kernel, bodyFiles(kernel, doc, features), choices);

export const printFileOf = (kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[], choices: PrintChoices, plate: BuildPlate, nozzle: NozzleType = FILE_DEFAULTS.nozzle) => printFileOfStls(kernel, bodyFiles(kernel, doc, features), choices, plate, nozzle);
