import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderHealthCache,
  HealthUnavailableError,
} from "../lib/server/provider-health-cache.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("cold/forced requests coalesce, forced refresh has a cooldown, ordinary reads retain TTL", async () => {
  let time = 0,
    calls = 0;
  let batch = deferred();
  const read = createProviderHealthCache(
    () => {
      calls++;
      return batch.promise;
    },
    () => time,
    () => time,
  );
  const requests = Array.from({ length: 20 }, (_, i) => read(false, i % 2 === 0));
  assert.equal(calls, 1);
  batch.resolve([{ providerId: "fixture" }]);
  const results = await Promise.all(requests);
  assert.equal(results.filter((r) => !r.cached).length, 1);
  assert.equal(results[0].retryAfterMs, 10000);
  await read(false, true);
  assert.equal(calls, 1);
  time = 10001;
  await read(false, false);
  assert.equal(calls, 1);
  batch = deferred();
  const refreshed = read(false, true);
  assert.equal(calls, 2);
  batch.resolve([]);
  await refreshed;
  time = 70002;
  await read(false, false);
  assert.equal(calls, 3);
});

test("failed async and synchronous batches cannot stampede and recover after cooldown", async () => {
  for (const synchronous of [false, true]) {
    let time = 0,
      calls = 0;
    const read = createProviderHealthCache(
      () => {
        calls++;
        if (calls > 1) return Promise.resolve([]);
        if (synchronous) throw new Error("synthetic private diagnostic");
        return Promise.reject(new Error("synthetic private diagnostic"));
      },
      () => time,
    );
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => read(false, true)));
    assert.equal(calls, 1);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.ok(result.reason instanceof HealthUnavailableError);
      assert.doesNotMatch(result.reason.message, /private diagnostic/);
    }
    time = 10001;
    assert.deepEqual((await read(false, false)).providers, []);
    assert.equal(calls, 2);
  }
});

test("mock transition cannot join or be overwritten by an older live batch", async () => {
  let mocked = false,
    network = 0;
  const live = deferred();
  const read = createProviderHealthCache(
    () => {
      if (mocked) return Promise.resolve([{ status: "mocked" }]);
      network++;
      return live.promise;
    },
    () => 0,
  );
  const old = read(false, true);
  mocked = true;
  assert.equal((await read(true, true)).providers[0].status, "mocked");
  assert.equal(network, 1);
  live.resolve([{ status: "connected" }]);
  await old;
  assert.equal((await read(true, true)).providers[0].status, "mocked");
  mocked = false;
  assert.equal((await read(false, true)).providers[0].status, "connected");
  assert.equal(network, 1, "mode toggles cannot reset the real cooldown");
});
