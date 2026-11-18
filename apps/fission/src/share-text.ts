// The share export for a sharing link (community C2c): the project's text goes through the open format's
// `stripForShare()` before it leaves the browser, so no personal field (the author's account id, view state, local
// extensions: docs/open-format/spec.md section 16) is ever in a shared copy. Today's project is the plain JSON file, which
// the format wraps losslessly as its history part; the share export changes no byte of that part (spec section 16), so the
// text that comes out is the text that went in. If it ever isn't, this refuses rather than share something else.

import { plainToPackage, readPackage, stripForShare } from "@fission/open-format";

const decoder = new TextDecoder("utf-8");

/** The text to share for the project text `text`; throws the words to say when it can't be shared. */
export async function textForShare(text: string): Promise<string> {
  let history: string;
  try {
    const read = await readPackage(await plainToPackage(text));
    const manifestPart = read.manifest.parts.find((p) => p.role === "history");
    const stripped = stripForShare(read);
    const bytes = manifestPart && stripped.parts.get(manifestPart.path);
    if (!bytes) throw new Error("the history went missing in the share export");
    history = decoder.decode(bytes);
  } catch (e) {
    throw new Error(`this design's file can't be prepared for sharing (${e instanceof Error ? e.message : String(e)}). Nothing was shared.`);
  }
  if (history !== text) throw new Error("this design's file changed while being prepared for sharing. Nothing was shared.");
  return history;
}
