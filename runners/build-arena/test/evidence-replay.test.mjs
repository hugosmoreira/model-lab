import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

register("./ts-resolve.mjs", import.meta.url);
const { FsRunStore, identitySegment, runPrefix, shortModelName, sanitizeSegment } =
  await import("../src/store-fs.ts");
const { exportBundle, withTemporaryBundle, computeFingerprint, readReplayConfiguration } =
  await import("../src/bundle.ts");
const { replayConfiguration } = await import("../src/config-fingerprint.ts");
const { captureSourceRevision } = await import("../src/provenance.ts");

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "model-lab-evidence-test-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("model-lab-evidence-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  return new FsRunStore(root);
}

function configuration(overrides = {}) {
  return {
    runId: "run_abcd0001",
    name: "Synthetic evidence test",
    mode: "build-arena",
    pack: { slug: "test", version: "v1", prompt: "Make a synthetic scene", browserCheckCount: 12 },
    endpoints: [
      {
        id: "provider/long-model-version-alpha@q4",
        providerId: "provider",
        modelId: "long-model-version-alpha",
        baseKind: "mock",
        model: "model-alias",
        priceInPerMtokUsd: null,
        priceOutPerMtokUsd: null,
        supportsSeed: true,
        quantization: "q4",
      },
    ],
    samplesPerModel: 1,
    temperature: 0.3,
    maxOutputTokens: 1234,
    seed: 42,
    concurrency: 2,
    maxBudgetUsd: 2,
    transportRetries: 1,
    ...overrides,
  };
}

function snapshot(cfg, artifact = null) {
  const endpointId = cfg.endpoints[0].id;
  const objective = cfg.mode === "verified";
  return {
    run: {
      id: cfg.runId,
      fingerprint: computeFingerprint(cfg),
      name: cfg.name,
      mode: cfg.mode,
      status: "completed",
      pack: { slug: cfg.pack.slug, version: cfg.pack.version },
      promptHash: "12345678",
      samplesPerModel: 1,
      modelCount: cfg.endpoints.length,
      startedAt: "2026-09-17T00:00:00Z",
      runnerVersion: "test-runner",
      gitCommit: null,
    },
    models: [
      {
        endpointId,
        visualScore: { value: 10, n: 1 },
        visualSource: objective ? "objective" : "browser",
        costUsd: 0,
      },
    ],
    samples: [
      {
        runId: cfg.runId,
        endpointId,
        sampleIndex: 1,
        primaryScorer: objective ? "objective" : "browser",
        status: "scored",
        score: { value: 10 },
      },
    ],
    artifacts: artifact === null ? [] : [artifact],
    config: structuredClone(cfg),
    judgePairs: [],
  };
}

function artifact(store, cfg) {
  const endpointId = cfg.endpoints[0].id;
  const written = store.writeArtifact(
    cfg.runId,
    endpointId,
    1,
    "<!doctype html><title>synthetic</title>",
  );
  const shot = store.screenshotPath(cfg.runId, endpointId, 1);
  writeFileSync(shot, Buffer.from([137, 80, 78, 71]), { flag: "wx" });
  return {
    endpointId,
    sampleIndex: 1,
    path: written.relPath,
    filename: written.filename,
    sizeKb: written.sizeKb,
    screenshotPath: shot,
    renderOk: true,
    consoleLines: [],
    checks: [{ name: "page.loads", status: "passed" }],
  };
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(join(dir, entry.name)).map((name) => `${entry.name}/${name}`)
      : [entry.name],
  );
}

test("full identities separate colliding legacy run, model, quantization and sanitized names", (t) => {
  const store = temporary(t);
  const a = configuration();
  const b = configuration({ runId: "run_abcd0002" });
  const epA = a.endpoints[0].id;
  const epB = "provider/long-model-version-beta@q8";
  assert.equal(runPrefix(a.runId), runPrefix(b.runId));
  assert.equal(shortModelName(epA), shortModelName(epB));
  const paths = [
    store.writeArtifact(a.runId, epA, 1, "A").absPath,
    store.writeArtifact(a.runId, epB, 1, "B").absPath,
    store.writeArtifact(b.runId, epA, 1, "C").absPath,
    store.writeArtifact(a.runId, "a/b", 1, "D").absPath,
    store.writeArtifact(a.runId, "a-b", 1, "E").absPath,
  ];
  assert.equal(new Set(paths).size, 5);
  assert.deepEqual(
    paths.map((path) => readFileSync(path, "utf8")),
    ["A", "B", "C", "D", "E"],
  );
  assert.notEqual(store.screenshotPath(a.runId, epA, 1), store.screenshotPath(b.runId, epA, 1));
  assert.notEqual(store.screenshotPath(a.runId, epA, 1), store.screenshotPath(a.runId, epB, 1));
  assert.notEqual(identitySegment("x".repeat(200) + "a"), identitySegment("x".repeat(200) + "b"));
  assert.throws(() => store.writeArtifact(a.runId, epA, 1, "replacement"), /EEXIST/);
  store.writeArtifact(a.runId, epA, 1, "A");
  const raw = store.writeRaw(a.runId, epA, 1, "first raw");
  assert.throws(() => store.writeRaw(a.runId, epA, 1, "changed raw"), /EEXIST/);
  assert.equal(readFileSync(raw, "utf8"), "first raw");
  assert.throws(() => store.rawPath(a.runId, epA, 0), /positive integer/);
});

test("creation configuration is immutable and credential fields never enter its serialization", (t) => {
  const store = temporary(t);
  const cfg = configuration();
  cfg.apiKey = "TOP_LEVEL_CREDENTIAL_SENTINEL";
  cfg.endpoints[0].apiKey = "ENDPOINT_CREDENTIAL_SENTINEL";
  cfg.endpoints[0].baseUrl =
    "https://name:URL_CREDENTIAL_SENTINEL@example.test/v1?api_key=QUERY_SENTINEL#FRAGMENT_SENTINEL";
  const creation = store.createRun(cfg);
  cfg.temperature = 99;
  cfg.pack.prompt = "later change";
  const stored = store.loadCreation(cfg.runId);
  assert.equal(stored.config.temperature, 0.3);
  assert.equal(stored.config.pack.prompt, "Make a synthetic scene");
  assert.equal(stored.config.endpoints[0].baseUrl, "https://example.test/v1");
  assert.equal(stored.redactedFields.length, 1);
  assert.doesNotMatch(JSON.stringify(stored), /SENTINEL/);
  assert.equal(computeFingerprint(stored.config), creation.fingerprint);
  assert.throws(() => store.createRun(cfg), /EEXIST/);
  // Fingerprint remains compatible with the original sorted-key contract for
  // ordinary supported configs that contain no credentials.
  const ordinary = configuration();
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    return value;
  }
  const { runId: _id, name: _name, ...content } = ordinary;
  assert.equal(
    computeFingerprint(ordinary),
    `fp_${hash(JSON.stringify(canonical(content))).slice(0, 12)}`,
  );
});

for (const mode of ["build-arena", "verified"]) {
  test(`${mode} replay round trip preserves creation config, exact evidence and hashes`, async (t) => {
    const store = temporary(t);
    const cfg = configuration({ mode });
    if (mode === "verified") {
      cfg.pack.browserCheckCount = 0;
      cfg.pack.tasks = [
        { id: "task1", prompt: "Return OK", scorer: "exact-match", expected: "OK" },
        {
          id: "task2",
          prompt: "Return JSON",
          scorer: "json-field",
          jsonField: { path: "result", expected: "yes" },
        },
      ];
    } else {
      cfg.judge = { model: "test-judge", priceInPerMtokUsd: 1, priceOutPerMtokUsd: 2 };
    }
    const created = store.createRun(cfg);
    const art = mode === "verified" ? null : artifact(store, cfg);
    store.writeRaw(cfg.runId, cfg.endpoints[0].id, 1, "synthetic raw output");
    const result = snapshot(cfg, art);
    // Reconstructing from later defaults would change this value; exporter
    // must prefer the immutable creation record.
    result.config.temperature = 99;
    result.config.pack.prompt = "later default";
    store.saveSnapshot(cfg.runId, result);
    if (mode === "build-arena") {
      store.appendEvent(cfg.runId, {
        runId: cfg.runId,
        type: "judge.vote",
        t: "2026-09-17T00:00:01Z",
        payload: {},
      });
    }
    // An unrelated file under the same old run prefix must never be bundled.
    const unrelated = join(
      store.root,
      "artifacts",
      runPrefix(cfg.runId),
      "unrelated",
      "private.html",
    );
    mkdirSync(dirname(unrelated), { recursive: true });
    writeFileSync(unrelated, "UNRELATED_RUN_SENTINEL");
    const output = await exportBundle(cfg.runId, store);
    const replay = json(join(output.dir, "replay.json"));
    assert.deepEqual(readReplayConfiguration(replay), replayConfiguration(cfg).config);
    assert.equal(computeFingerprint(readReplayConfiguration(replay)), created.fingerprint);
    assert.equal(replay.fingerprintMatchesRecorded, true);
    assert.equal(replay.provenance.status, "captured");
    assert.equal(replay.mode, mode);
    assert.deepEqual(
      replay.actualScorers,
      mode === "verified" ? ["objective"] : ["browser", "llm-judge"],
    );
    assert.equal(json(join(output.dir, "benchmark.json")).kind, mode);
    assert.deepEqual(replay.config.pack.tasks, cfg.pack.tasks);
    assert.deepEqual(json(join(output.dir, "manifest.json")).scorers, replay.actualScorers);
    const contents = filesIn(output.dir);
    assert.equal(
      contents.some((name) => name.includes("private.html")),
      false,
    );
    for (const item of replay.evidence) {
      assert.equal(item.status, "included");
      assert.equal(item.path.startsWith("/"), false);
      assert.equal(item.path.includes("\\"), false);
      const bytes = readFileSync(join(output.dir, item.path));
      assert.equal(item.sha256, hash(bytes));
      assert.equal(item.bytes, bytes.length);
    }
    const checksums = json(join(output.dir, "checksums.json"));
    assert.deepEqual(
      Object.keys(checksums).sort(),
      contents.filter((name) => name !== "checksums.json").sort(),
    );
    for (const [name, sum] of Object.entries(checksums))
      assert.equal(sum.sha256, hash(readFileSync(join(output.dir, name))));
    const later = await exportBundle(cfg.runId, store);
    assert.notEqual(later.dir, output.dir);
    assert.equal(
      readFileSync(join(output.dir, "events.jsonl"), "utf8").includes("export.created"),
      false,
    );
    replay.config.temperature += 0.1;
    assert.throws(() => readReplayConfiguration(replay), /fingerprint/);
  });
}

test("copied legacy storage remains readable and exports exact references with incomplete provenance", async (t) => {
  const store = temporary(t);
  const cfg = configuration();
  const endpoint = cfg.endpoints[0].id;
  const artPath = `artifacts/${runPrefix(cfg.runId)}/${shortModelName(endpoint)}/raycaster.html`;
  const shotPath = `screenshots/${runPrefix(cfg.runId)}/${shortModelName(endpoint)}-s1.png`;
  const rawPath = `raw/${sanitizeSegment(cfg.runId)}/${sanitizeSegment(endpoint)}/1.txt`;
  for (const [name, content] of [
    [artPath, "legacy html"],
    [shotPath, "legacy png"],
    [rawPath, "legacy raw"],
  ]) {
    mkdirSync(dirname(join(store.root, name)), { recursive: true });
    writeFileSync(join(store.root, name), content);
  }
  const legacy = snapshot(cfg, {
    endpointId: endpoint,
    sampleIndex: 1,
    path: artPath,
    screenshotPath: `C:\\old-machine\\private-user\\data\\${shotPath.replaceAll("/", "\\")}`,
    checks: [],
  });
  const oldDir = join(store.root, "runs", sanitizeSegment(cfg.runId));
  mkdirSync(oldDir, { recursive: true });
  writeFileSync(join(oldDir, "run.json"), JSON.stringify(legacy));
  writeFileSync(
    join(oldDir, "events.jsonl"),
    `${JSON.stringify({ runId: cfg.runId, type: "run.completed", t: "2026-09-17T00:00:00Z" })}\n{torn`,
  );
  const before = readFileSync(join(oldDir, "run.json"));
  assert.equal(store.loadSnapshot(cfg.runId).run.id, cfg.runId);
  assert.throws(() => store.createRun(cfg), /already exists/);
  const first = await exportBundle(cfg.runId, store);
  const replay = json(join(first.dir, "replay.json"));
  assert.equal(replay.provenance.status, "legacy-incomplete");
  assert.equal(replay.evidence.length, 3);
  assert.equal(
    replay.evidence.every((item) => item.status === "included"),
    true,
  );
  assert.equal(JSON.stringify(replay).includes("private-user"), false);
  assert.equal(json(join(first.dir, "artifacts.json"))[0].screenshotPath, shotPath);
  const second = await exportBundle(cfg.runId, store);
  const events = readFileSync(join(second.dir, "events.jsonl"), "utf8");
  assert.match(events, /run.completed/);
  assert.match(events, /export.created/);
  assert.deepEqual(readFileSync(join(oldDir, "run.json")), before);
  assert.throws(() => store.resolveEvidencePath("artifacts/../../secret", "artifacts"), /invalid/);
  assert.throws(() => store.resolveEvidencePath("screenshots/abc.png", "artifacts"), /invalid/);
});

test("missing raw evidence and unavailable legacy revision are explicit", async (t) => {
  const store = temporary(t);
  const cfg = configuration();
  store.saveSnapshot(cfg.runId, snapshot(cfg));
  const output = await exportBundle(cfg.runId, store);
  const replay = json(join(output.dir, "replay.json"));
  assert.equal(replay.evidence[0].status, "missing");
  assert.ok(replay.provenance.missingFields.includes("source revision"));
  assert.ok(replay.provenance.missingFields.includes("some recorded evidence files"));
});

test("a transport failure does not claim its configured scorer executed", async (t) => {
  const store = temporary(t);
  const cfg = configuration();
  const failed = snapshot(cfg);
  failed.samples[0].status = "failed";
  failed.samples[0].score = { failed: true };
  failed.samples[0].scorerTrace = [];
  store.saveSnapshot(cfg.runId, failed);
  const output = await exportBundle(cfg.runId, store);
  const replay = json(join(output.dir, "replay.json"));
  assert.deepEqual(replay.configuredScorers, ["browser"]);
  assert.deepEqual(replay.actualScorers, []);
});

test("build provenance accepts only an explicit full revision and records dirty state", () => {
  const oldRevision = process.env.MODEL_LAB_SOURCE_REVISION;
  const oldDirty = process.env.MODEL_LAB_SOURCE_DIRTY;
  try {
    process.env.MODEL_LAB_SOURCE_REVISION = "a".repeat(40);
    process.env.MODEL_LAB_SOURCE_DIRTY = "0";
    assert.deepEqual(captureSourceRevision(), {
      commit: "a".repeat(40),
      dirty: false,
      source: "build-environment",
    });
  } finally {
    if (oldRevision === undefined) delete process.env.MODEL_LAB_SOURCE_REVISION;
    else process.env.MODEL_LAB_SOURCE_REVISION = oldRevision;
    if (oldDirty === undefined) delete process.env.MODEL_LAB_SOURCE_DIRTY;
    else process.env.MODEL_LAB_SOURCE_DIRTY = oldDirty;
  }
});

test("startRun records creation config before caller mutation and exports an objective replay", async (t) => {
  const { startRun } = await import("../src/run.ts");
  const store = temporary(t);
  const cfg = configuration({
    mode: "verified",
    pack: {
      slug: "synthetic-objective",
      version: "v1",
      prompt: "Run the synthetic tasks",
      browserCheckCount: 0,
      tasks: [{ id: "one", prompt: "Return OK", scorer: "exact-match", expected: "OK" }],
    },
  });
  const original = structuredClone(cfg);
  let calls = 0;
  const handle = startRun(cfg, {
    store,
    providerFactory: () => ({
      kind: "mock",
      async *generate() {
        calls += 1;
        yield { type: "delta", text: "OK" };
        yield { type: "usage", tokensIn: 10, tokensOut: 1, servedModel: "synthetic-model-version" };
      },
    }),
    checksRunner: async () => {
      throw new Error("objective mode must not launch a browser");
    },
  });
  cfg.pack.tasks[0].expected = "mutated";
  cfg.temperature = 123;
  const outcome = await handle.done;
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.samplesScored, 1);
  assert.equal(calls, 1);
  const creation = store.loadCreation(cfg.runId);
  assert.deepEqual(creation.config, original);
  const stored = store.loadSnapshot(cfg.runId);
  assert.equal(stored.run.gitCommit, creation.sourceRevision.commit);
  const result = await exportBundle(cfg.runId, store);
  const replay = json(join(result.dir, "replay.json"));
  assert.deepEqual(readReplayConfiguration(replay), original);
  assert.equal(replay.fingerprint, computeFingerprint(original));
  assert.equal(replay.evidence.find((item) => item.kind === "raw").status, "included");
  assert.deepEqual(replay.actualScorers, ["objective"]);
  assert.throws(() => startRun(original, { store }), /already exists/);
});

test("repeated download ZIPs leave no temporary files or persistent events and preserve CLI exports", async (t) => {
  const { zipDirectory } = await import("../../../apps/web/lib/share/zip.ts");
  const store = temporary(t);
  const cfg = configuration();
  store.createRun(cfg);
  store.saveSnapshot(cfg.runId, snapshot(cfg, artifact(store, cfg)));
  store.writeRaw(cfg.runId, cfg.endpoints[0].id, 1, "synthetic output");
  const persistent = await exportBundle(cfg.runId, store);
  const sibling = join(store.root, ".bundle-download-user-owned");
  mkdirSync(sibling);
  writeFileSync(join(sibling, "keep.txt"), "User-owned sibling, not a cleanup target");
  const before = Object.fromEntries(
    filesIn(store.root).map((name) => [name, hash(readFileSync(join(store.root, name)))]),
  );
  const temporaryPaths = [];
  for (let n = 0; n < 20; n += 1) {
    const zipped = await withTemporaryBundle(
      cfg.runId,
      (bundle) => {
        temporaryPaths.push(bundle.dir);
        return zipDirectory(bundle.dir);
      },
      store,
    );
    assert.equal(zipped.subarray(0, 4).toString("hex"), "504b0304");
    assert.equal(existsSync(temporaryPaths[n]), false);
  }
  assert.equal(new Set(temporaryPaths).size, 20);
  assert.ok(existsSync(join(persistent.dir, "replay.json")));
  assert.deepEqual(
    Object.fromEntries(
      filesIn(store.root).map((name) => [name, hash(readFileSync(join(store.root, name)))]),
    ),
    before,
    "downloads neither change stored evidence/logs nor retain additional files",
  );
});

test("download cleanup runs after partial export and consumer failures without deleting another target", async (t) => {
  const store = temporary(t);
  const cfg = configuration();
  const valid = snapshot(cfg, artifact(store, cfg));
  store.saveSnapshot(cfg.runId, valid);
  const persistent = await exportBundle(cfg.runId, store);
  const persistentManifest = readFileSync(join(persistent.dir, "manifest.json"));
  let ownedPath;
  await assert.rejects(
    withTemporaryBundle(
      cfg.runId,
      (bundle) => {
        ownedPath = bundle.dir;
        assert.ok(existsSync(join(ownedPath, "replay.json")));
        // Cleanup must use its captured ownership, never a mutable result supplied
        // to consumer code. The older user export must survive even on failure.
        bundle.dir = persistent.dir;
        throw new Error("synthetic ZIP failure");
      },
      store,
    ),
    /synthetic ZIP failure/,
  );
  assert.equal(existsSync(ownedPath), false);
  assert.deepEqual(readFileSync(join(persistent.dir, "manifest.json")), persistentManifest);

  const partial = structuredClone(valid);
  partial.artifacts[0].screenshotPath = "screenshots/../../outside.png";
  store.saveSnapshot(cfg.runId, partial);
  let copiedArtifact = false;
  const originalResolve = store.resolveEvidencePath.bind(store);
  store.resolveEvidencePath = (reference, category) => {
    if (category === "screenshots") {
      const scratch = readdirSync(store.root).find((name) => name.startsWith(".bundle-download-"));
      assert.ok(scratch);
      copiedArtifact = existsSync(join(store.root, scratch, valid.artifacts[0].path));
    }
    return originalResolve(reference, category);
  };
  await assert.rejects(
    withTemporaryBundle(
      cfg.runId,
      () => {
        throw new Error("consumer must not run");
      },
      store,
    ),
    /invalid evidence/,
  );
  assert.equal(copiedArtifact, true, "failure occurred after partial evidence was written");
  assert.deepEqual(
    readdirSync(store.root).filter((name) => name.startsWith(".bundle-download-")),
    [],
  );
  assert.deepEqual(readFileSync(join(persistent.dir, "manifest.json")), persistentManifest);
  await assert.rejects(
    withTemporaryBundle("run_ffffffff", () => null, store),
    /no stored results/,
  );
  assert.deepEqual(
    readdirSync(store.root).filter((name) => name.startsWith(".bundle-download-")),
    [],
  );
});

test("overlapping download consumers keep independent exports until each finishes", async (t) => {
  const store = temporary(t);
  const cfg = configuration();
  store.saveSnapshot(cfg.runId, snapshot(cfg));
  let firstDir;
  let secondDir;
  let releaseFirst;
  let releaseSecond;
  let markFirstReady;
  let markSecondReady;
  const firstReady = new Promise((resolve) => {
    markFirstReady = resolve;
  });
  const secondReady = new Promise((resolve) => {
    markSecondReady = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  const first = withTemporaryBundle(
    cfg.runId,
    async (bundle) => {
      firstDir = bundle.dir;
      markFirstReady();
      await firstGate;
      return readFileSync(join(bundle.dir, "replay.json"), "utf8");
    },
    store,
  );
  const second = withTemporaryBundle(
    cfg.runId,
    async (bundle) => {
      secondDir = bundle.dir;
      markSecondReady();
      await secondGate;
      return readFileSync(join(bundle.dir, "replay.json"), "utf8");
    },
    store,
  );
  try {
    await Promise.all([firstReady, secondReady]);
    assert.notEqual(firstDir, secondDir);
    assert.ok(existsSync(firstDir));
    assert.ok(existsSync(secondDir));
    releaseFirst();
    const firstReplay = await first;
    assert.equal(existsSync(firstDir), false);
    assert.ok(existsSync(secondDir), "one response finishing must not remove another export");
    releaseSecond();
    assert.equal(await second, firstReplay);
    assert.equal(existsSync(secondDir), false);
  } finally {
    releaseFirst();
    releaseSecond();
    await Promise.allSettled([first, second]);
  }
});
