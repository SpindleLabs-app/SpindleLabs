// The one switch for the design tabs (several designs open at once, a strip under the top bar): off in the shipped build
// until released. Flip DESIGN_TABS to true and nothing else needs to change. SPINDLE_TABS=1 at build time turns it on
// without editing this file (the tabs' browser check builds that way: `npm run e2e:tabs`, run by CI's e2e (switches) job).
// The home screen (home.config.mjs) is built with its tabs, so a build with the home screen has them too.
export const DESIGN_TABS = process.env.SPINDLE_TABS === "1" || false;
