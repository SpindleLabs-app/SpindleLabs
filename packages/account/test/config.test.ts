import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConfig, MAX_KEY_LENGTH } from "../src/config.ts";

const good = { url: "https://abcdefghijklmnopqrst.supabase.co/", anonKey: "eyJ.abc.def", redirectTo: "https://spindlelabs.app/" };

test("a good config is accepted, with the trailing slash taken off the service address", () => {
  const r = checkConfig(good);
  assert.ok(r.ok);
  assert.equal(r.config.url, "https://abcdefghijklmnopqrst.supabase.co");
  assert.equal(r.config.redirectTo, "https://spindlelabs.app/");
  assert.ok(checkConfig({ ...good, url: "http://127.0.0.1:54321", redirectTo: "http://localhost:5173/app/" }).ok);
});

test("each way a config can be wrong is refused with its own reason", () => {
  const refused = (c: unknown, why: RegExp) => {
    const r = checkConfig(c);
    assert.equal(r.ok, false, JSON.stringify(c));
    if (!r.ok) assert.match(r.reason, why);
  };
  refused(undefined, /no account settings/);
  refused(null, /no account settings/);
  refused({ ...good, url: "http://abcdefghijklmnopqrst.supabase.co" }, /service address/); // plain http off this computer
  refused({ ...good, url: "https://x.supabase.co/rest" }, /service address/); // a path
  refused({ ...good, url: "https://x.supabase.co/?a=1" }, /service address/); // a query
  refused({ ...good, url: "https://u:p@x.supabase.co" }, /service address/); // a user name and password
  refused({ ...good, url: "https://u@x.supabase.co" }, /service address/); // a user name alone
  refused({ ...good, url: "https://:p@x.supabase.co" }, /service address/); // a password alone
  refused({ ...good, url: "javascript:alert(1)" }, /service address/);
  refused({ ...good, url: "not a url" }, /service address/);
  refused({ ...good, url: 5 }, /service address/);
  refused({ ...good, anonKey: "" }, /key/);
  refused({ ...good, anonKey: "a b" }, /key/);
  refused({ ...good, anonKey: "a".repeat(MAX_KEY_LENGTH + 1) }, /key/);
  refused({ ...good, redirectTo: "http://spindlelabs.app/" }, /return address/);
  refused({ ...good, redirectTo: "https://spindlelabs.app/#x" }, /return address/);
});

test("the longest key allowed is accepted", () => {
  assert.ok(checkConfig({ ...good, anonKey: "a".repeat(MAX_KEY_LENGTH) }).ok);
});
