// What the server says about itself at initialize.
import { TOOLS_VERSION } from "./session.ts";

export const serverInfo = {
  name: "spindlelabs-beta",
  version: TOOLS_VERSION,
  instructions:
    "SpindleLabs (beta): open a .spindle project or start a new one, read its timeline and bodies, measure bodies exactly, " +
    "build with Design's own commands (set_part, create_sketch, draw_circle, draw_rectangle, draw_line, extrude_sketch, rename_item), " +
    "export STL and save the project. Every shape is built by the SpindleLabs kernel. All lengths are millimetres. " +
    "Nothing is written to disk except by export_stl and save_project, which never replace a file unless overwrite is true. " +
    "Files are read and written only inside the folders the person started the server with.",
};
