// The one switch for the home screen (U6b: the screen the app opens on, over the last project). Off until it is
// released: flip HOME_SCREEN to true and nothing else needs to change. SPINDLE_HOME=1 at build time turns it on
// without editing this file (the home screen's browser check builds that way: `npm run e2e:home`).
export const HOME_SCREEN = process.env.SPINDLE_HOME === "1" || false;
