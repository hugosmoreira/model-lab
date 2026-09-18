import test from "node:test";
import assert from "node:assert/strict";
import { guardMutationRequest } from "../lib/server/mutation-guard.ts";

function request(
  origin = "http://localhost:3000",
  extra = {},
  url = "http://localhost:3000/api/runs",
) {
  const headers = new Headers({ "content-type": "application/json", ...extra });
  if (origin !== null) headers.set("origin", origin);
  return new Request(url, { method: "POST", headers, body: "{}" });
}

test("local browser JSON and explicit non-browser JSON retain their contract", () => {
  assert.equal(guardMutationRequest(request(), ""), null);
  assert.equal(
    guardMutationRequest(
      request(undefined, {
        "sec-fetch-site": "same-origin",
        "content-type": "Application/JSON; charset=utf-8",
      }),
      "",
    ),
    null,
  );
  for (const base of ["http://127.0.0.1:3000", "http://[::1]:3000"]) {
    assert.equal(guardMutationRequest(request(base, {}, `${base}/api/runs`), ""), null);
  }
});

test("foreign, opaque, absent, ambiguous and malformed origins fail closed", () => {
  for (const origin of [
    null,
    "null",
    "https://attacker.invalid",
    "http://localhost:3001",
    "https://localhost:3000",
    "http://localhost:3000.attacker.invalid",
    "http://localhost:3000/path",
    "http://user@localhost:3000",
    "http://localhost:3000#fragment",
    "http://localhost:3000?query",
    "http://localhost:3000 https://attacker.invalid",
  ]) {
    assert.equal(guardMutationRequest(request(origin), "")?.status, 403, String(origin));
  }
});

test("Next loopback normalization preserves the browser authority without trusting public hosts", () => {
  for (const host of ["127.0.0.1:3000", "[::1]:3000", "localhost:3000"]) {
    assert.equal(guardMutationRequest(request(`http://${host}`, { host }), ""), null);
  }
  for (const host of [
    "localhost:3001",
    "127.0.0.1:3001",
    "attacker.invalid:3000",
    "localhost.attacker.invalid:3000",
    "user@localhost:3000",
    "localhost:3000/path",
    "localhost:3000,attacker.invalid",
  ]) {
    assert.equal(guardMutationRequest(request(`http://${host}`, { host }), "")?.status, 403);
  }
  assert.equal(
    guardMutationRequest(request("http://localhost:3000", { host: "127.0.0.1:3000" }), "")?.status,
    403,
  );
});

test("simple media types and contradictory fetch metadata cannot cause writes", () => {
  for (const contentType of [
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/json",
    "",
  ]) {
    assert.equal(
      guardMutationRequest(request(undefined, { "content-type": contentType }), "")?.status,
      415,
    );
  }
  for (const site of ["cross-site", "same-site", "none"]) {
    assert.equal(
      guardMutationRequest(request(undefined, { "sec-fetch-site": site }), "")?.status,
      403,
    );
  }
});

test("proxy origin is explicit; host and forwarded headers cannot authorize foreign pages", () => {
  const publicOrigin = "https://models.example";
  assert.equal(guardMutationRequest(request(publicOrigin), publicOrigin), null);
  assert.equal(
    guardMutationRequest(request(publicOrigin, {}, `${publicOrigin}/api/runs`), "")?.status,
    403,
  );
  assert.equal(
    guardMutationRequest(
      request("https://attacker.invalid", {
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "https",
        forwarded: "host=attacker.invalid;proto=https",
      }),
      "",
    )?.status,
    403,
  );
  assert.equal(
    guardMutationRequest(request(undefined, { host: "attacker.invalid" }), "")?.status,
    403,
  );
  assert.equal(guardMutationRequest(request(), publicOrigin)?.status, 403);
});

test("invalid configured origins fail closed rather than reverting to localhost", () => {
  for (const origin of [
    "not a URL",
    "null",
    "https://models.example/path",
    "https://user@models.example",
    "file:///",
    "https://models.example?q=1",
  ]) {
    assert.equal(guardMutationRequest(request(), origin)?.status, 503, origin);
  }
});
