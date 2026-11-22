// Who may call the inspector's API (runtime/server/guard.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal } from "../../runtime/server/guard.ts";

const TOKEN = "a".repeat(48);
const ask = (method, path, headers = {}) => refusal({ method, path, headers: { host: "localhost:5173", ...headers } }, TOKEN);
const json = { "content-type": "application/json", "x-inspector-token": TOKEN };

test("the panel's own requests pass", () => {
  assert.equal(ask("GET", "/__inspector/jobs", { "sec-fetch-site": "same-origin" }), null);
  assert.equal(ask("POST", "/__inspector/run", { ...json, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" }), null);
  assert.equal(ask("POST", "/__inspector/media?part=hero&name=a.png", { "content-type": "application/octet-stream", "x-inspector-token": TOKEN }), null);
  assert.equal(refusal({ method: "GET", path: "/__inspector/editor", headers: { host: "127.0.0.1:5310" } }, TOKEN), null);
  assert.equal(refusal({ method: "GET", path: "/__inspector/editor", headers: { host: "[::1]:5310" } }, TOKEN), null);
});

test("a program on this computer passes with the token (no browser headers)", () => {
  assert.equal(ask("POST", "/__inspector/run", json), null);
  assert.equal(ask("GET", "/__inspector/jobs"), null);
});

test("another website's request is refused", () => {
  // a form or a no-cors fetch from another site: no token, no JSON
  assert.match(ask("POST", "/__inspector/run", { "content-type": "text/plain", origin: "https://evil.example", "sec-fetch-site": "cross-site" }), /another website/);
  // even with JSON and a guessed token header, the origin gives it away
  assert.match(ask("POST", "/__inspector/run", { ...json, origin: "https://evil.example" }), /another website/);
  assert.match(ask("POST", "/__inspector/run", { ...json, origin: "null" }), /another website/);
  // another app on this computer, on another port
  assert.match(ask("POST", "/__inspector/save", { ...json, origin: "http://localhost:3000", "sec-fetch-site": "same-site" }), /another website/);
  assert.match(ask("GET", "/__inspector/jobs", { "sec-fetch-site": "cross-site" }), /another website/);
});

test("a change needs JSON and the token", () => {
  assert.match(ask("POST", "/__inspector/save", { "content-type": "application/json" }), /token/);
  assert.match(ask("POST", "/__inspector/save", { ...json, "x-inspector-token": "b".repeat(48) }), /token/);
  assert.match(ask("POST", "/__inspector/save", { "content-type": "text/plain", "x-inspector-token": TOKEN }), /JSON/);
  assert.match(ask("DELETE", "/__inspector/save", json), /only GET and POST/);
  assert.match(refusal({ method: "POST", path: "/__inspector/save", headers: { host: "localhost", ...json } }, ""), /token/);
});

test("a foreign name pointed at this computer is refused, unless it's allowed", () => {
  const asked = { method: "GET", path: "/__inspector/jobs", headers: { host: "evil.example:5173" } };
  assert.match(refusal(asked, TOKEN), /only on this computer/);
  assert.equal(refusal({ ...asked, headers: { host: "mysite.test:5173" } }, TOKEN, ["mysite.test"]), null);
  assert.equal(refusal({ ...asked, headers: { host: "shop.localhost:5173" } }, TOKEN), null);
  assert.match(refusal({ ...asked, headers: {} }, TOKEN), /only on this computer/);
});

test("opening the editor from a link elsewhere is fine", () => {
  assert.equal(ask("GET", "/__inspector/editor", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }), null);
  assert.match(ask("POST", "/__inspector/run", { ...json, "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }), /another website/);
});
