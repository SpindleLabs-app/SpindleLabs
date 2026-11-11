// The moderators' review page (community step C5b), served on this computer only:
//
//   node supabase/review/serve.mjs        then open http://localhost:8765/
//
// It is never part of the app or its public build: the page lives here, beside the database it works on, and only
// ever runs on a moderator's own computer. Everything it does goes through the moderation function
// (supabase/functions/moderation/index.ts), which checks on the server that the signed-in account is on the
// moderators' list; the page itself decides nothing and holds no secret (the service's public key is the app's).
// It answers only 127.0.0.1, so nobody else on the network can open it.
//
// Sign-in comes back here, so the service's redirect list must hold http://localhost:8765/ (Supabase dashboard >
// Authentication > URL Configuration > Redirect URLs).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { ACCOUNT_SERVICE } from "../../apps/fission/accounts.config.mjs";

export const PORT = 8765;
const here = new URL("./", import.meta.url);
const file = (name) => readFileSync(new URL(name, here));

/** The page's settings: where the service and the function are. Public values only. */
export function pageConfig(service = ACCOUNT_SERVICE) {
  return { url: service.url, anonKey: service.anonKey, functionUrl: `${service.url}/functions/v1/moderation` };
}

/**
 * Headers for every answer: the page may run only its own script, talk only to the account service, show pictures
 * only from data: addresses (a link's picture) and be framed by nobody, so text from a report can never run as code
 * or send the moderator's sign-in anywhere else.
 */
export function securityHeaders(service = ACCOUNT_SERVICE) {
  return {
    "content-security-policy": `default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self' ${new URL(service.url).origin}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  };
}

const PAGES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/review.js": ["review.js", "text/javascript; charset=utf-8"],
  "/review.css": ["review.css", "text/css; charset=utf-8"],
};

export function handler(req, res) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const headers = securityHeaders();
  if (req.method !== "GET") {
    res.writeHead(405, headers).end();
    return;
  }
  if (path === "/config.json") {
    res.writeHead(200, { ...headers, "content-type": "application/json" }).end(JSON.stringify(pageConfig()));
    return;
  }
  const page = PAGES[path];
  if (!page) {
    res.writeHead(404, headers).end();
    return;
  }
  res.writeHead(200, { ...headers, "content-type": page[1] }).end(file(page[0]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, "127.0.0.1", () => console.log(`Review page: http://localhost:${PORT}/  (Ctrl+C to stop)`));
}
