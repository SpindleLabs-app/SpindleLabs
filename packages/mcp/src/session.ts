// The beta MCP server's tools: one design open at a time, every shape built
// by the kernel through the app's own rebuild (rebuild.ts), every edit one
// of Design's own commands (commands.ts `documentFor`, the same the
// assistant uses), every file read and written as the app reads and
// writes it (core's projectFromJson / projectToJson, open-format's readAny).
// No geometry is worked out here.

import {
  commandSchema, emptyProject, MAX_PROJECT_BYTES, parseCommand, projectFromJson, projectToJson,
  type CommandSpec, type Feature, type KernelCalls, type Project, type SolidReport,
} from "@fission/core";
import { readAny } from "@fission/open-format";
import { DESIGN_COMMANDS, documentFor, EXTRUDE_OP } from "../../../workspaces/design/src/commands.ts";
import { bodyHidden, bodyNumbers, readDesignDocument, type DesignDocument } from "../../../workspaces/design/src/document.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../../../workspaces/design/src/rebuild.ts";
import { designBodies, failedIds } from "../../../workspaces/design/src/browser.ts";
import { endStls } from "../../../workspaces/design/src/move-tool.ts";
import { joinStl } from "../../../workspaces/design/src/actions.ts";
import { freshDesign } from "../../../workspaces/design/src/start-fresh.ts";
import { argsProblem, argsSchema, type Args } from "./args.ts";
import type { ToolAnswer, ToolHost, ToolInfo } from "./protocol.ts";

/** The tool set's version: goes up whenever a tool is added, removed or changes what it takes or gives. */
export const TOOLS_VERSION = "0.1.0-beta";

/** The file system as the tools see it (tests pass a stand-in). */
export interface Files {
  exists(path: string): boolean;
  size(path: string): number;
  read(path: string): Uint8Array;
  /** Writes the whole file; with `overwrite` false it must fail when anything is at `path`. */
  write(path: string, bytes: Uint8Array, overwrite: boolean): void;
  /** Whether the tools may read and write `path` (an absolute path); left out, they may anywhere (tests). */
  allowed?(path: string): boolean;
}

/** The densest material a mass is worked out for, in g/cm³ (osmium is 22.6). */
export const MAX_DENSITY = 25;

/** Longest path taken, in characters. */
export const MAX_PATH = 4096;

/** Design's commands as tools: all but export_stl (export_stl here writes a file). extrude_sketch also takes the sketch by name, as the assistant is offered it. */
export const COMMAND_SPECS: readonly CommandSpec[] = DESIGN_COMMANDS.filter((c) => c.op !== "export_stl").map((c) =>
  c.op === EXTRUDE_OP ? { ...c, params: { ...c.params, sketch: { type: "text", maxLength: 200, optional: true, description: "the sketch's name in the timeline; leave it out for the newest sketch" } } } : c,
);

const PATH = { type: "string", maxLength: MAX_PATH } as const;

/** The tools that aren't Design commands, with their arguments. */
const OWN_TOOLS: Record<string, { description: string; args: Args }> = {
  open_project: {
    description: "Open a SpindleLabs project file (.spindle, either the plain JSON or the zip package) and build its design on the kernel. Replaces the design open here; unsaved changes to it are lost. Answers what describe_design answers.",
    args: { path: { ...PATH, description: "absolute path of the project file" } },
  },
  new_project: {
    description: "Start a new, empty project in memory (nothing is written until save_project). Replaces the design open here; unsaved changes to it are lost.",
    args: { name: { type: "string", maxLength: 200, optional: true, description: "the project's name; Untitled when left out" } },
  },
  describe_design: {
    description: "The open design: the timeline in build order (each item's name, kind and whether it built, with the reason when not), the timeline marker, and the bodies (name like \"Body 1\", id, which item made it, hidden or not).",
    args: {},
  },
  measure_body: {
    description: "Exact measurements of one body from the kernel: volume (mm³), surface area (mm²), bounding box and size (mm), counts of faces, edges and corners, and the mass when a density is given.",
    args: {
      body: { type: "string", maxLength: 200, description: "the body's name (\"Body 1\") or id (\"body:feature-1\")" },
      density_g_per_cm3: { type: "number", exclusiveMinimum: 0, maximum: MAX_DENSITY, optional: true, description: "material density in g/cm³ for the mass (PLA is about 1.24)" },
    },
  },
  export_stl: {
    description: "Write bodies as one binary STL file (mm), then check the written file is a closed solid. Every body shown when no bodies are named; hidden bodies are left out unless named.",
    args: {
      path: { ...PATH, description: "absolute path of the .stl file to write" },
      bodies: { type: "strings", maxItems: 256, maxLength: 200, optional: true, description: "bodies by name or id; leave out for every body shown" },
      overwrite: { type: "boolean", optional: true, description: "replace a file already there (false when left out)" },
    },
  },
  save_project: {
    description: "Save the open project as a plain .spindle file the app opens.",
    args: {
      path: { ...PATH, description: "absolute path of the .spindle file to write" },
      overwrite: { type: "boolean", optional: true, description: "replace a file already there (false when left out)" },
    },
  },
};

const BETA = "Beta: SpindleLabs' tool set may change between versions. ";

interface Open {
  project: Project;
  design: DesignDocument;
  build: TimelineBuild;
}

export class Session implements ToolHost {
  private open: Open | null = null;
  private cache: BodyCache;
  private kernel: KernelCalls;
  private files: Files;

  constructor(kernel: KernelCalls, files: Files) {
    this.kernel = kernel;
    this.files = files;
    this.cache = new BodyCache(kernel);
  }

  tools(): ToolInfo[] {
    const own = Object.entries(OWN_TOOLS).map(([name, t]) => ({ name, description: BETA + t.description, inputSchema: argsSchema(t.args) }));
    const commands = COMMAND_SPECS.map((spec) => {
      const { properties, required, ...rest } = commandSchema(spec) as { properties: Record<string, unknown>; required: string[] };
      const { op: _, ...props } = properties;
      return {
        name: spec.op,
        description: `${BETA}Design command, as in the app: ${spec.summary} Builds the design again on the kernel and is refused, changing nothing, when an item that built would no longer build. Needs a project open (open_project or new_project).`,
        inputSchema: { ...rest, properties: props, required: required.filter((r) => r !== "op") },
      };
    });
    return [...own, ...commands];
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolAnswer | null> {
    if (Object.hasOwn(OWN_TOOLS, name)) {
      const problem = argsProblem(name, OWN_TOOLS[name].args, args);
      if (problem) return { ok: false, error: problem };
    } else if (!COMMAND_SPECS.some((c) => c.op === name)) return null;
    try {
      switch (name) {
        case "open_project":
          return await this.openProject(args.path as string);
        case "new_project":
          return await this.newProject((args.name as string | undefined) ?? "Untitled");
        case "describe_design":
          return { ok: true, data: this.describe(this.needOpen()) };
        case "measure_body":
          return await this.measure(args.body as string, args.density_g_per_cm3 as number | undefined);
        case "export_stl":
          return await this.exportStl(args.path as string, args.bodies as string[] | undefined, args.overwrite === true);
        case "save_project":
          return this.save(args.path as string, args.overwrite === true);
        default:
          return await this.command(name, args);
      }
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, error: e.message };
      throw e;
    }
  }

  /** Frees every body the kernel holds for this session. */
  async close(): Promise<void> {
    await this.cache.close();
    this.open = null;
  }

  private needOpen(): Open {
    if (!this.open) throw new Refusal("no project is open: use open_project or new_project first");
    return this.open;
  }

  private async openProject(path: string): Promise<ToolAnswer> {
    readablePath(path, this.files);
    const size = this.files.size(path);
    if (size > MAX_PROJECT_BYTES) throw new Refusal(`${path} is ${size} bytes; a SpindleLabs project may be at most ${MAX_PROJECT_BYTES}`);
    let project: Project;
    try {
      const read = await readAny(readFile(this.files, path));
      project = projectFromJson(read.history, [{ id: "design", readData: readDesignDocument }]);
    } catch (e) {
      throw new Refusal(`can't open ${path}: ${fileWords(e instanceof Error ? e.message : String(e))}`);
    }
    const design = (project.workspaces.design as DesignDocument | undefined) ?? freshDesign();
    await this.replace(project, design);
    return { ok: true, data: this.describe(this.open!) };
  }

  private async newProject(name: string): Promise<ToolAnswer> {
    const project = emptyProject(name);
    await this.replace(project, freshDesign());
    return { ok: true, data: this.describe(this.open!) };
  }

  /** Builds `design` as the one open, letting the bodies of the one before go. */
  private async replace(project: Project, design: DesignDocument): Promise<void> {
    this.open = null;
    await this.cache.close();
    this.cache = new BodyCache(this.kernel);
    const build = await rebuildTimeline(design, this.cache, this.kernel);
    this.open = { project, design, build };
  }

  private bodies(o: Open): { body: string; name: string; item: string; feature: Feature; hidden: boolean }[] {
    const numbers = bodyNumbers(o.design);
    const failed = failedIds(o.design, o.build.results, new Set(Object.keys(o.build.bodies)));
    return designBodies(o.design, failed).flatMap(({ body, feature }) =>
      o.build.bodies[body] === undefined ? [] : [{ body, name: numbers.has(body) ? `Body ${numbers.get(body)}` : body, item: feature.provenance.self.label, feature, hidden: bodyHidden(o.design, body) }],
    );
  }

  private describe(o: Open) {
    const timeline = o.design.timeline.features.map((f, i) => {
      const r = o.build.results[f.id];
      const state = r === undefined ? "not built" : r.status;
      return {
        number: i + 1,
        name: f.provenance.self.label,
        kind: f.intent.type,
        state,
        ...(r?.status === "failed" && { why: fileWords(r.message) }),
        ...(r?.status === "greyed" && { why: `built on ${r.by}, which is suppressed` }),
        ...(r?.status === "built" && r.warning && { warning: "its sketch is lost, so it keeps its last shape" }),
      };
    });
    const marker = o.design.timeline.marker;
    return {
      project: fileWords(o.project.name),
      units: o.project.units.length,
      marker: marker === undefined ? "end" : marker === "start" ? "start" : (o.design.timeline.features.find((f) => f.id === marker)?.provenance.self.label ?? marker),
      timeline,
      bodies: this.bodies(o).map(({ body, name, item, hidden }) => ({ name, id: body, madeBy: item, hidden })),
      note: "Lengths are in mm whatever the project's units.",
    };
  }

  private findBody(o: Open, wanted: string) {
    const all = this.bodies(o);
    const found = all.find((b) => b.body === wanted || b.name.toLowerCase() === wanted.trim().toLowerCase());
    if (!found) throw new Refusal(`there is no body ${JSON.stringify(wanted)}; the bodies are ${all.map((b) => b.name).join(", ") || "none"}`);
    return found;
  }

  private async measure(wanted: string, density: number | undefined): Promise<ToolAnswer> {
    const o = this.needOpen();
    const b = this.findBody(o, wanted);
    const view = await this.cache.view(o.build.bodies[b.body].handle);
    const [low, high] = view.bounds;
    return {
      ok: true,
      data: {
        body: b.name,
        id: b.body,
        volume_mm3: view.volume,
        area_mm2: view.area,
        bounds_mm: { low, high },
        size_mm: [high[0] - low[0], high[1] - low[1], high[2] - low[2]],
        faces: view.faces,
        edges: view.edges,
        corners: view.vertices,
        // 1 cm³ = 1000 mm³, so g = mm³ / 1000 × g/cm³.
        ...(density !== undefined && { density_g_per_cm3: density, mass_g: (view.volume / 1000) * density }),
      },
    };
  }

  private async exportStl(path: string, wanted: string[] | undefined, overwrite: boolean): Promise<ToolAnswer> {
    const o = this.needOpen();
    writablePath(path, ".stl", overwrite, this.files);
    const chosen = wanted === undefined ? this.bodies(o).filter((b) => !b.hidden) : [...new Map(wanted.map((w) => this.findBody(o, w)).map((b) => [b.body, b])).values()];
    if (chosen.length === 0) throw new Refusal(this.bodies(o).length === 0 ? "the design has no body to export" : "every body is hidden: name the bodies to export");
    const stls = await endStls(this.kernel, o.design, chosen.map((b) => ({ body: b.body, feature: b.feature, name: b.name })));
    const bytes = joinStl(stls.map((s) => s.bytes), o.project.name);
    const check: SolidReport = await this.kernel.call("check_solid", bytes);
    writeFile(this.files, path, bytes, overwrite);
    return {
      ok: true,
      data: {
        path,
        bodies: chosen.map((b) => b.name),
        bytes: bytes.length,
        triangles: check.triangles,
        solid: check.verdict,
        ...(check.problems.length > 0 && { problems: check.problems.map((p) => `${p.count} ${p.kind}`) }),
        warnings: stls.flatMap((s, i) => (s.warning ? [`${chosen[i].name}: ${s.warning}`] : [])),
      },
    };
  }

  private save(path: string, overwrite: boolean): ToolAnswer {
    const o = this.needOpen();
    writablePath(path, ".spindle", overwrite, this.files);
    const text = projectToJson({ ...o.project, workspaces: { ...o.project.workspaces, design: o.design } });
    const bytes = new TextEncoder().encode(text);
    writeFile(this.files, path, bytes, overwrite);
    return { ok: true, data: { path, bytes: bytes.length } };
  }

  private async command(op: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const o = this.needOpen();
    const parsed = parseCommand({ ...args, op }, COMMAND_SPECS);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    let design: DesignDocument;
    try {
      design = documentFor(parsed.command, o.design);
    } catch (e) {
      throw new Refusal(`${op} refused: ${e instanceof Error ? e.message : String(e)}`);
    }
    const before = new Set(Object.entries(o.build.results).filter(([, r]) => r.status !== "failed").map(([id]) => id));
    const build = await rebuildTimeline(design, this.cache, this.kernel);
    // Refused when an item that built before fails now, or the item the command added fails: nothing is recorded.
    const broke = design.timeline.features.filter((f) => build.results[f.id]?.status === "failed" && (before.has(f.id) || !(f.id in o.build.results)));
    if (broke.length > 0) {
      o.build = await rebuildTimeline(o.design, this.cache, this.kernel);
      const words = broke.map((f) => `${f.provenance.self.label}: ${fileWords((build.results[f.id] as { message: string }).message)}`).join("; ");
      throw new Refusal(`${op} refused, nothing changed: ${words}`);
    }
    this.open = { ...o, design, build };
    return { ok: true, data: this.describe(this.open) };
  }
}

/** The most characters of a file's own words (its name, an item's reason) one answer carries. */
export const FILE_WORDS = 300;

/**
 * A file's own words as an answer carries them: one line (every run of new
 * lines, tabs and spaces one space) of at most FILE_WORDS characters. The
 * answer is read by an AI client, and a design from someone else may hold
 * anything in its name or descriptions: it gets to state a short fact,
 * never to hand the client a page of text.
 */
export function fileWords(text: string): string {
  const chars = [...text.replace(/[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim()];
  return chars.length > FILE_WORDS ? chars.slice(0, FILE_WORDS).join("") + "…" : chars.join("");
}

/** A refusal in words: the tool's answer, never a crash. */
class Refusal extends Error {}

function readablePath(path: string, files: Files): void {
  if (!isAbsolute(path)) throw new Refusal(`give an absolute path, not ${JSON.stringify(path)}`);
  insideFolders(path, files);
  if (!files.exists(path)) throw new Refusal(`there is no file ${path}`);
}

function writablePath(path: string, ending: string, overwrite: boolean, files: Files): void {
  if (!isAbsolute(path)) throw new Refusal(`give an absolute path, not ${JSON.stringify(path)}`);
  if (!path.toLowerCase().endsWith(ending)) throw new Refusal(`the file's name must end in ${ending}`);
  insideFolders(path, files);
  if (files.exists(path) && !overwrite) throw new Refusal(`${path} is already there: pass overwrite true to replace it`);
}

/**
 * Refuses a path outside the folders the server was started with, in the
 * same words whether anything is there or not: a design from someone else
 * can ask the AI client for anything, and the tools must neither touch nor
 * tell about the rest of the disk.
 */
function insideFolders(path: string, files: Files): void {
  if (files.allowed && !files.allowed(path)) throw new Refusal(`${path} is outside the folders this server may use (it is started with --folder <folder> for each one)`);
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function readFile(files: Files, path: string): Uint8Array {
  try {
    return files.read(path);
  } catch (e) {
    throw new Refusal(`can't read ${path}: ${reason(e)}`);
  }
}

function writeFile(files: Files, path: string, bytes: Uint8Array, overwrite: boolean): void {
  try {
    files.write(path, bytes, overwrite);
  } catch (e) {
    throw new Refusal(`can't write ${path}: ${reason(e)}`);
  }
}

/** An absolute path on Linux, macOS or Windows ("/x", "C:\\x", "\\\\server\\x"). */
export const isAbsolute = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
