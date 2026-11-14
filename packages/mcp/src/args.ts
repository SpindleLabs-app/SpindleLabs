// Checks a tool's arguments against its own small schema before anything
// runs: every key known, every type right, nothing left out that is
// needed. Untrusted input (a model's call) never reaches the design or the
// file system unchecked. Never throws.

export type ArgSpec = { description: string; optional?: boolean } & (
  | { type: "string"; maxLength: number }
  | { type: "number"; exclusiveMinimum?: number; maximum?: number }
  | { type: "boolean" }
  | { type: "strings"; maxItems: number; maxLength: number }
);

export type Args = Record<string, ArgSpec>;

/** The JSON schema tools/list shows for these arguments. */
export function argsSchema(args: Args): object {
  const prop = (a: ArgSpec): object => {
    switch (a.type) {
      case "string":
        return { type: "string", maxLength: a.maxLength, description: a.description };
      case "number":
        return { type: "number", ...(a.exclusiveMinimum !== undefined && { exclusiveMinimum: a.exclusiveMinimum }), ...(a.maximum !== undefined && { maximum: a.maximum }), description: a.description };
      case "boolean":
        return { type: "boolean", description: a.description };
      case "strings":
        return { type: "array", items: { type: "string", maxLength: a.maxLength }, maxItems: a.maxItems, description: a.description };
    }
  };
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(args).map(([k, a]) => [k, prop(a)])),
    required: Object.entries(args).filter(([, a]) => !a.optional).map(([k]) => k),
    additionalProperties: false,
  };
}

const show = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

/** What is wrong with `given` for `args`, in words, or null when it is right. */
export function argsProblem(tool: string, args: Args, given: Record<string, unknown>): string | null {
  for (const key of Object.keys(given)) if (!Object.hasOwn(args, key)) return `${tool} has no argument ${show(key)}; it takes ${Object.keys(args).join(", ") || "none"}`;
  for (const [name, a] of Object.entries(args)) {
    const v = given[name];
    if (v === undefined) {
      if (a.optional) continue;
      return `${tool} needs ${name}`;
    }
    switch (a.type) {
      case "string":
        if (typeof v !== "string" || v.length === 0 || v.length > a.maxLength) return `${tool}: ${name} must be text of 1 to ${a.maxLength} characters, got ${show(v)}`;
        break;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) return `${tool}: ${name} must be a number, got ${show(v)}`;
        if (a.exclusiveMinimum !== undefined && v <= a.exclusiveMinimum) return `${tool}: ${name} must be more than ${a.exclusiveMinimum}, got ${v}`;
        if (a.maximum !== undefined && v > a.maximum) return `${tool}: ${name} must be at most ${a.maximum}, got ${v}`;
        break;
      case "boolean":
        if (typeof v !== "boolean") return `${tool}: ${name} must be true or false, got ${show(v)}`;
        break;
      case "strings":
        if (!Array.isArray(v) || v.length > a.maxItems || !v.every((s) => typeof s === "string" && s.length > 0 && s.length <= a.maxLength))
          return `${tool}: ${name} must be a list of at most ${a.maxItems} names, got ${show(v)}`;
        break;
    }
  }
  return null;
}
