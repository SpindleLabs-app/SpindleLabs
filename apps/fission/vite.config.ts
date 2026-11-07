import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { ACCOUNT_SERVICE, ACCOUNTS } from "./accounts.config.mjs";
import { HOME_SCREEN } from "./home.config.mjs";
import { SLICE_PAGE } from "./slice-page.config.mjs";
import { licencesPlugin } from "./licences.mjs";
import { OFFLINE_MODE } from "./offline.config.mjs";
import { offlinePlugin } from "./offline.mjs";
import { whatsNew } from "./whats-new.mjs";

// The kernel's own licence (it comes with each kernel release) beside the app as
// kernel-licence.txt, so the live site carries it, not only the repository.
const kernelLicence = {
  name: "kernel-licence",
  generateBundle() {
    const source = readFileSync(new URL("../../packages/core/src/kernel/wasm/LICENSE-KERNEL.txt", import.meta.url), "utf8");
    this.emitFile({ type: "asset", fileName: "kernel-licence.txt", source });
  },
};

// What's new (Settings > About): the public list of changes and the app's version, worked out once per build.
const news = whatsNew();

export default defineConfig({
  // Relative paths so the built site works from any URL, including GitHub Pages.
  base: "./",
  // __TEST_HOOKS__: the ?test-hooks debug surface (window.fissionTest) is built in by
  // default so the browser tests can reach it; the live Pages build sets
  // FISSION_NO_TEST_HOOKS=1, which makes this false so the surface is dead code and
  // dropped from the shipped bundle (audit S12).
  define: { __OFFLINE_MODE__: JSON.stringify(OFFLINE_MODE), __HOME_SCREEN__: JSON.stringify(HOME_SCREEN), __SLICE_PAGE__: JSON.stringify(SLICE_PAGE), __ACCOUNTS__: JSON.stringify(ACCOUNTS ? ACCOUNT_SERVICE : null), __TEST_HOOKS__: JSON.stringify(process.env.FISSION_NO_TEST_HOOKS !== "1"), __WHATS_NEW__: JSON.stringify(news.text), __APP_VERSION__: JSON.stringify(news.version) },
  // The kernel worker imports the wasm-bindgen ES module.
  worker: { format: "es", plugins: () => [licencesPlugin({ emit: false })] },
  // third-party-licences.txt beside the app, checked against what is bundled (audit L2).
  // sw.js, written last: the offline worker, or the clean-up worker while offline mode is off (offline.mjs).
  plugins: [licencesPlugin({ emit: true }), kernelLicence, offlinePlugin()],
});
