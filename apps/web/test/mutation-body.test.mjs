import assert from "node:assert/strict";
import test from "node:test";
import { readMutationJson, MUTATION_BODY_LIMITS } from "../lib/server/mutation-body.ts";
const encode = (text) => new TextEncoder().encode(text);
function request(parts, headers = {}, options = {}) {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream(
    {
      pull(controller) {
        const part = parts[pulled++];
        if (part !== undefined) controller.enqueue(typeof part === "string" ? encode(part) : part);
        else if (!options.stall) controller.close();
      },
      cancel() {
        cancelled = true;
        return options.hangCancel ? new Promise(() => {}) : undefined;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    headers: new Headers(headers),
    body,
    signal: options.signal ?? new AbortController().signal,
    stats: () => ({ pulled, cancelled }),
  };
}
async function status(req, expected, timeout) {
  const result = await readMutationJson(req, timeout);
  assert.equal(result.ok, false);
  assert.equal(result.response.status, expected, await result.response.text());
  assert.equal(req.body.locked, false);
}

test("body reader preserves ordinary JSON, BOM, escaped maximum notes and UTF-8 compatibility", async () => {
  for (const note of ["x".repeat(4000), "雪".repeat(4000), "😀".repeat(2000), "a\0b"]) {
    const json = JSON.stringify({ note });
    const bytes = encode(json);
    const result = await readMutationJson(request([bytes.subarray(0, 12), bytes.subarray(12)]));
    assert.deepEqual(result, { ok: true, value: { note } });
  }
  assert.deepEqual(await readMutationJson(request(['\ufeff{"ok":true}'])), {
    ok: true,
    value: { ok: true },
  });
  const escaped = '{"note":"' + "\\u96ea".repeat(4000) + '"}';
  assert.equal((await readMutationJson(request([escaped]))).value.note, "雪".repeat(4000));
  const badUtf8 = Uint8Array.from([34, 255, 34]);
  assert.deepEqual(await readMutationJson(request([badUtf8])), { ok: true, value: "\ufffd" });
});

test("body bytes are bounded with no length header, false lengths and multibyte chunk boundaries", async () => {
  const exact = '"' + "x".repeat(MUTATION_BODY_LIMITS.bytes - 2) + '"';
  assert.equal(
    (
      await readMutationJson(
        request([exact], { "content-length": String(MUTATION_BODY_LIMITS.bytes) }),
      )
    ).ok,
    true,
  );
  await status(request([exact, " "]), 413);
  await status(request([exact, " "], { "content-length": "2" }), 413);
  await status(request(['"', encode("雪".repeat(22000)), '"']), 413);
  const fast = request(["{}"], { "content-length": "65537" });
  await status(fast, 413);
  assert.equal(fast.stats().pulled, 0);
  for (const length of ["-1", "1e3", "2,2", "invalid"])
    await status(request(["{}"], { "content-length": length }), 400);
  await status(request(["{}"], { "content-length": "1" }), 400);
  await status(request(["{}"], { "content-length": "3" }), 400);
});

test("rejected encoding is cancelled before reading, while identity remains supported", async () => {
  for (const encoding of ["gzip", "br", "deflate", "identity, gzip"]) {
    const req = request(["{}"], { "content-encoding": encoding });
    await status(req, 415);
    assert.equal(req.stats().pulled, 0);
  }
  assert.equal(
    (await readMutationJson(request(["{}"], { "content-encoding": "identity" }))).ok,
    true,
  );
});

test("malformed/empty JSON, stalled reads and nonsettling cancellation fail promptly", async () => {
  // Malformed JSON reaches EOF, so cancellation need not call the closed source.
  for (const text of ["", "{", "{} junk"])
    assert.equal((await readMutationJson(request([text]))).response.status, 400);
  const stalled = request([], {}, { stall: true, hangCancel: true });
  const start = performance.now();
  await status(stalled, 408, 30);
  assert.equal(stalled.stats().cancelled, true);
  assert.ok(performance.now() - start < 1000);
  assert.equal(stalled.body.locked, false);
});

test("total deadline is not reset by a slow drip and synchronous empty chunks cannot bypass it", async () => {
  let cancelled = false;
  const body = new ReadableStream(
    {
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        try {
          controller.enqueue(encode(" "));
        } catch {
          /* cancelled */
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const result = await readMutationJson(
    { body, headers: new Headers(), signal: new AbortController().signal },
    40,
  );
  assert.equal(result.response.status, 408);
  assert.equal(cancelled, true);
  const empty = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array());
    },
  });
  assert.equal(
    (
      await readMutationJson(
        { body: empty, headers: new Headers(), signal: new AbortController().signal },
        20,
      )
    ).response.status,
    408,
  );
});

test("pre-aborted and mid-read aborted requests do not wait for body completion", async () => {
  const before = new AbortController();
  before.abort();
  await status(request([], {}, { signal: before.signal, stall: true }), 400);
  const during = new AbortController();
  const req = request([], {}, { signal: during.signal, stall: true, hangCancel: true });
  const pending = status(req, 400);
  during.abort();
  await pending;
  assert.equal(req.body.locked, false);
});
