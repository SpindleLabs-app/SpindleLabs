// A file of the repository outside this package (the database migrations and
// the billing function under supabase/), found by walking up from here rather
// than by a fixed "../../../": mutation testing runs these tests from a copy
// of the package in packages/account/.stryker-tmp/sandbox-*/, where a fixed
// path points inside the copy and the file isn't there.
import { existsSync } from "node:fs";

export function repoFile(path: string): URL {
  for (let dir = new URL("./", import.meta.url); ; dir = new URL("../", dir)) {
    const url = new URL(path, dir);
    if (existsSync(url)) return url;
    if (dir.pathname === "/") throw new Error(`${path} isn't in any folder above ${import.meta.url}`);
  }
}
