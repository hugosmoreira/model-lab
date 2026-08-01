"use client";

/**
 * New Run — 6-step wizard (Run type → Challenge pack → Models & providers →
 * Shared settings → Scoring & safeguards → Review & launch) with a live cost
 * rail. All display values derive from fixtures; wizard state lives in one
 * useState object. Start Run POSTs the actual selection to /api/runs and
 * routes to the created run's live stream (Phase 1: simulated replay).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { ModelEndpoint, Provider, RunMode } from "@model-lab/schemas";
import {
  Callout,
  EmptyState,
  ModelDot,
  ProgressBar,
  StatusDot,
} from "@/components/ui/primitives";
import { fixtures, getModelForEndpoint } from "@/lib/data";
import { usd } from "@/lib/format";
import {
  ctxLabel,
  groupThousands,
  kTokens,
  priceLabel,
  tokenRange,
  totalCostRange,
  VERIFIED_EST_OUTPUT_TOKENS_PER_TASK,
} from "./estimate";

const mono = { fontFamily: "var(--font-mono)" } as const;

/* ------------------------------------------------------------------ */
/* Static UI copy (design copy from the prototype; data comes from fixtures) */

const RUN_TYPE_ORDER: RunMode[] = [
  "build-arena",
  "verified",
  "head-to-head",
  "performance",
  "custom",
];

const RUN_TYPES: Record<RunMode, { label: string; desc: string; dot: string }> = {
  "build-arena": {
    label: "Build Arena",
    desc: "One identical visual coding prompt → one self-contained HTML artifact per model, rendered, screenshotted and browser-tested.",
    dot: "var(--color-magenta)",
  },
  verified: {
    label: "Verified Benchmark",
    desc: "Objective answers, deterministic assertions, code tests, structured-output validation.",
    dot: "var(--color-model-gpt)",
  },
  "head-to-head": {
    label: "Head-to-Head",
    desc: "Two anonymized outputs side by side for blind human or model-assisted voting.",
    dot: "var(--color-model-gemini)",
  },
  performance: {
    label: "Performance Run",
    desc: "Cost, TTFT, total latency, throughput, tokens, retries and provider errors.",
    dot: "var(--color-model-neutral)",
  },
  custom: {
    label: "Custom Pack",
    desc: "A repository-defined, versioned set of prompts, assertions and scorers.",
    dot: "var(--color-model-blind)",
  },
};

const SCORER_BADGES: Record<string, { label: string; color: string }> = {
  browser: { label: "BROWSER", color: "var(--color-teal)" },
  human: { label: "HUMAN", color: "var(--color-amber)" },
  "llm-judge": { label: "JUDGE", color: "var(--color-magenta)" },
  objective: { label: "OBJECTIVE", color: "var(--color-model-gpt)" },
  hybrid: { label: "HYBRID", color: "var(--color-muted)" },
};

const SCORER_DESCS: Record<string, string> = {
  browser:
    "Loads the artifact in an isolated sandbox: parse, load < 5s, no uncaught console errors, canvas renders, WASD responds, minimap present, screenshot not blank…",
  human:
    "0–10 visual quality on fidelity, polish and brief adherence. Scored by you after the run.",
  "llm-judge":
    "Anonymized outputs judged in both A/B and B/A order; verdict reversals recorded. Never labeled ground truth.",
  objective:
    "Deterministic assertions per task — exact-match, contains, or JSON-field equality. Binary 10/0 per sample; no browser, human, or judge in the loop.",
};

const STEP_NAMES = [
  "Run type",
  "Challenge pack",
  "Models",
  "Shared settings",
  "Scoring",
  "Review & launch",
] as const;

/* ------------------------------------------------------------------ */

type DeploymentFilter = "all" | "cloud" | "local";

interface WizardState {
  step: number; // 1–6
  mode: RunMode;
  packSlug: string;
  selected: string[]; // endpoint ids
  search: string;
  deployment: DeploymentFilter;
}

function providerDisplayName(p: Provider): string {
  return p.isLocal ? `${p.name} · local${p.localHardware ? ` ${p.localHardware}` : ""}` : p.name;
}

function providerNote(p: Provider): string {
  if (p.isLocal) {
    const quants = Array.from(
      new Set(
        fixtures.endpoints
          .filter((e) => e.providerId === p.id && e.quantization != null)
          .map((e) => e.quantization as string),
      ),
    );
    return ["online", ...quants].join(" · ");
  }
  return p.healthLatencyMs != null ? `connected · ${p.healthLatencyMs}ms` : "connected";
}

function endpointTags(ep: ModelEndpoint): string {
  const model = getModelForEndpoint(ep.id);
  const tags: string[] = [...model.capabilities];
  if (!model.supportsSeed) tags.push("no seed support");
  return tags.join(" · ");
}

/** Shape of a successful POST /api/runs response. */
const CreateRunResponse = z.object({ runId: z.string().min(1) });

/* ------------------------------------------------------------------ */

export function NewRunWizard() {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>(() => ({
    step: 1,
    mode: "build-arena",
    packSlug:
      fixtures.benchmarkPacks.find((p) => p.kind === "build-arena")?.slug ?? "raycaster-oneshot",
    selected: [...fixtures.RUN_ENDPOINT_IDS],
    search: "",
    deployment: "all",
  }));

  const set = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));
  const toggleEndpoint = (id: string) =>
    setState((s) => ({
      ...s,
      selected: s.selected.includes(id)
        ? s.selected.filter((x) => x !== id)
        : [...s.selected, id],
    }));

  const cfg = fixtures.runConfiguration;
  const pack = fixtures.benchmarkPacks.find((p) => p.slug === state.packSlug);
  const arenaPacks = fixtures.benchmarkPacks.filter((p) => p.kind === "build-arena");
  const evalPacks = fixtures.benchmarkPacks.filter((p) => p.kind === "eval");
  const isVerified = state.mode === "verified";
  const taskCount = pack?.taskCount ?? 0;

  /* Selection, in canonical fixture order regardless of click order. */
  const selectedEndpoints = fixtures.endpoints.filter((ep) => state.selected.includes(ep.id));
  const n = selectedEndpoints.length;
  /* Verified MVP: 1 sample per task — the runner iterates the pack's tasks. */
  const samples = isVerified ? 1 : cfg.samplesPerModel;
  const callsPerModel = isVerified ? taskCount : samples;
  const calls = n * callsPerModel;

  /* Cost estimate (documented formula in ./estimate.ts).
     Verified mode: per-model output = taskCount × ~200 tokens/task. */
  const estOut = isVerified
    ? taskCount * VERIFIED_EST_OUTPUT_TOKENS_PER_TASK
    : pack?.estOutputTokensPerModel ?? 0;
  const cost = totalCostRange(selectedEndpoints, samples, estOut);
  const tok = tokenRange(n, samples, estOut);
  const costLabel = `${usd(cost.low)}–${usd(cost.high)}`;
  const budgetPctRaw = (cost.high / cfg.maxBudgetUsd) * 100;
  const budgetExceeded = cost.high > cfg.maxBudgetUsd;

  /* Validation. */
  const modelCountOk = n >= 2 && n <= 8;
  const modelCountReason =
    n < 2 ? `Select at least 2 models — ${n} selected.` : `Select at most 8 models — ${n} selected.`;
  const canStart = modelCountOk && !budgetExceeded;
  const startBlockReason = !modelCountOk
    ? modelCountReason
    : `Worst-case estimate ${usd(cost.high)} exceeds the ${usd(cfg.maxBudgetUsd)} budget ceiling.`;

  /* Rule-generated warnings. */
  const byModelId = new Map<string, ModelEndpoint[]>();
  for (const ep of selectedEndpoints) {
    const list = byModelId.get(ep.modelId) ?? [];
    list.push(ep);
    byModelId.set(ep.modelId, list);
  }
  const dupeGroups = Array.from(byModelId.values()).filter((list) => list.length > 1);
  const unseeded = selectedEndpoints.filter((ep) => !getModelForEndpoint(ep.id).supportsSeed);
  const seedSupportedCount = n - unseeded.length;

  /* Model filtering (step 3). */
  const q = state.search.trim().toLowerCase();
  const matchesFilters = (ep: ModelEndpoint): boolean => {
    if (state.deployment === "cloud" && ep.deployment === "local") return false;
    if (state.deployment === "local" && ep.deployment !== "local") return false;
    if (!q) return true;
    const model = getModelForEndpoint(ep.id);
    const hay = [ep.id, ep.modelId, model.family, model.shortName, ...model.capabilities]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };
  const providerGroups = fixtures.providers
    .filter((p) => p.status === "connected")
    .map((provider) => ({
      provider,
      endpoints: fixtures.endpoints.filter(
        (ep) => ep.providerId === provider.id && matchesFilters(ep),
      ),
    }))
    .filter((g) => g.endpoints.length > 0);

  /* Scorers. */
  const enabledScorers = cfg.scorers.filter((s) => s.enabled);
  const sandbox = fixtures.artifacts[0]?.sandbox;
  const safeguardDesc =
    [
      `Hard budget stop at ${usd(cfg.maxBudgetUsd)}`,
      `network ${cfg.artifactNetworkPolicy} for artifacts`,
      ...(sandbox
        ? [`${sandbox.execLimitSec}s execution limit`, `output size cap ${sandbox.sizeLimitMb}MB`]
        : []),
    ].join(" · ") + ".";
  const scorersSummary = isVerified
    ? `OBJECTIVE(${taskCount} tasks)`
    : enabledScorers
        .map((s) => {
          if (s.type === "browser") return `browser(${pack?.browserCheckCount ?? "?"})`;
          if (s.type === "human") return `human rubric ${s.rubricVersion ?? ""}`.trim();
          if (s.type === "llm-judge") return `judge${s.orderSwapped ? " (order-swapped)" : ""}`;
          return s.type;
        })
        .join(" + ");

  /* Review rows. */
  const modelReviewLabel = (ep: ModelEndpoint): string => {
    const dupe = (byModelId.get(ep.modelId)?.length ?? 0) > 1;
    return dupe || ep.deployment !== "cloud" ? `${ep.modelId}(${ep.providerId})` : ep.modelId;
  };
  const reviewRows: { k: string; v: string }[] = [
    { k: "Mode", v: `${state.mode}${cfg.retryPolicy.generation === "none" ? " · first-shot" : ""}` },
    { k: "Pack", v: pack ? `${pack.slug} ${pack.version} (${pack.source})` : "none selected" },
    { k: "Models", v: n > 0 ? selectedEndpoints.map(modelReviewLabel).join(" · ") : "none selected" },
    {
      k: "Expected calls",
      v: isVerified
        ? `${calls} (${n} models × ${taskCount} tasks)`
        : `${calls} (${n} models × ${samples} samples)`,
    },
    { k: "Est. tokens", v: n > 0 ? `${kTokens(tok.low)} – ${kTokens(tok.high)}` : "—" },
    {
      k: "Est. cost",
      v: `${usd(cost.low)} – ${usd(cost.high)} (ceiling ${usd(cfg.maxBudgetUsd)})`,
    },
    { k: "Scorers", v: scorersSummary },
    { k: "Prompt hash", v: fixtures.runLive.promptHash },
  ];

  /* Stepper subtitles — derived live. */
  const stepSubs: string[] = [
    RUN_TYPES[state.mode].label,
    pack ? `${pack.name} ${pack.version}` : "none selected",
    `${n} selected`,
    "locked",
    `${(isVerified ? 1 : enabledScorers.length) + 1} scorers`, // +1 always-on safeguard row
    costLabel,
  ];

  /* Shared generation settings (step 4) — read-only value chips this phase. */
  const params: { name: string; sub: string; val: string }[] = [
    { name: "Temperature", sub: "identical across models", val: String(cfg.temperature) },
    { name: "Max output tokens", sub: "hard cap per sample", val: groupThousands(cfg.maxOutputTokens) },
    {
      name: "Seed",
      sub: `where supported · ${seedSupportedCount}/${n} models`,
      val: cfg.seed != null ? String(cfg.seed) : "off",
    },
    {
      name: "Samples per model",
      sub: cfg.retryPolicy.generation === "none" ? "first-shot only" : "with retries",
      val: String(cfg.samplesPerModel),
    },
    { name: "Concurrency", sub: "parallel requests", val: String(cfg.concurrency) },
    {
      name: "Retry policy",
      sub: "on transport error only",
      val: `${cfg.retryPolicy.transportRetries} retry`,
    },
    { name: "Max budget", sub: "hard stop", val: usd(cfg.maxBudgetUsd) },
    { name: "Tool access", sub: "no tools in one-shot mode", val: cfg.toolAccess ? "on" : "off" },
    { name: "Network access (artifact)", sub: "sandbox policy", val: cfg.artifactNetworkPolicy },
    {
      name: "Save reasoning metadata",
      sub: "when exposed & permitted",
      val: cfg.saveReasoningMetadata ? "on" : "off",
    },
  ];

  const continueBlocked = state.step === 5 && !modelCountOk;

  /* Start Run: POST the wizard's actual selection, then route to the created
     run's live stream. Phase 1: the stream replays a simulated event script. */
  async function startRun() {
    if (!canStart || launching) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(pack ? { name: pack.name } : {}),
          mode: state.mode,
          packSlug: state.packSlug,
          endpointIds: selectedEndpoints.map((ep) => ep.id),
          samplesPerModel: samples,
        }),
      });
      if (!res.ok) {
        // Surface the API's reason when it sent one (e.g. verified mode
        // rejecting an eval pack that has no native task list on disk).
        let detail: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          if (typeof data.error === "string" && data.error !== "") detail = data.error;
        } catch {
          // non-JSON error body — fall through to the generic message
        }
        throw new Error(detail ?? `Run creation failed (HTTP ${res.status}).`);
      }
      const parsed = CreateRunResponse.safeParse(await res.json());
      if (!parsed.success) {
        throw new Error("Run creation returned an unexpected response.");
      }
      router.push(`/runs/${parsed.data.runId}/live`);
      // keep `launching` true — we are navigating away
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Run creation failed.");
      setLaunching(false);
    }
  }

  /* ---------------------------------------------------------------- */

  return (
    <main style={{ flex: 1, display: "flex", flexWrap: "wrap", minHeight: 0 }}>
      {/* Left stepper */}
      <aside
        style={{
          flex: "0 1 240px",
          minWidth: 200,
          boxSizing: "border-box",
          borderRight: "1px solid var(--color-border-subtle)",
          padding: "20px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span className="section-label" style={{ padding: "0 10px 10px" }}>
          Configure run
        </span>
        {STEP_NAMES.map((name, i) => {
          const num = i + 1;
          const active = state.step === num;
          const done = num < state.step;
          const badgeColor = active
            ? "var(--color-amber)"
            : done
              ? "var(--color-teal)"
              : "var(--color-faint)";
          return (
            <button
              key={name}
              type="button"
              onClick={() => set({ step: num })}
              aria-current={active ? "step" : undefined}
              className={active ? undefined : "hover-row"}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                textAlign: "left",
                width: "100%",
                background: active ? "var(--color-selected)" : "none",
                border: "none",
                borderRadius: 7,
                padding: "9px 10px",
                cursor: "pointer",
                color: active ? "var(--color-text)" : "var(--color-nav-idle)",
                fontSize: 13.5,
                fontWeight: 600,
                fontFamily: "inherit",
              }}
            >
              <span
                aria-hidden
                style={{
                  ...mono,
                  width: 20,
                  height: 20,
                  flex: "0 0 20px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  border: `1px solid ${active || done ? badgeColor : "var(--color-border)"}`,
                  color: badgeColor,
                }}
              >
                {num}
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                <span>{name}</span>
                <span style={{ fontSize: 11, color: "var(--color-faint)", fontWeight: 400 }}>
                  {stepSubs[i]}
                </span>
              </span>
            </button>
          );
        })}
        <div
          style={{
            marginTop: "auto",
            fontSize: 12,
            color: "var(--color-faint)",
            padding: 10,
            lineHeight: 1.5,
          }}
        >
          Configuration is recorded into the run manifest. Every model receives identical settings
          unless marked.
        </div>
      </aside>

      {/* Center step content */}
      <section
        style={{
          flex: "2 1 420px",
          padding: "22px 26px",
          overflowY: "auto",
          minWidth: 0,
          boxSizing: "border-box",
        }}
      >
        {/* -------- Step 1 · Run type -------- */}
        {state.step === 1 && (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Run type</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)" }}>
              Each mode is a distinct evaluation method with its own scorers.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
                gap: 12,
                maxWidth: 760,
              }}
            >
              {RUN_TYPE_ORDER.map((modeId) => {
                const t = RUN_TYPES[modeId];
                const sel = state.mode === modeId;
                /* Switching mode keeps the pack only if its kind still fits:
                   verified runs eval packs, every other mode runs arena packs. */
                const kindFor = modeId === "verified" ? "eval" : "build-arena";
                const selectMode = () => {
                  const current = fixtures.benchmarkPacks.find((p) => p.slug === state.packSlug);
                  if (current?.kind === kindFor) {
                    set({ mode: modeId });
                    return;
                  }
                  const fallback = fixtures.benchmarkPacks.find((p) => p.kind === kindFor);
                  set({ mode: modeId, ...(fallback ? { packSlug: fallback.slug } : {}) });
                };
                return (
                  <button
                    key={modeId}
                    type="button"
                    aria-pressed={sel}
                    onClick={selectMode}
                    className={sel ? undefined : "hover-border"}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      alignItems: "flex-start",
                      textAlign: "left",
                      background: "var(--color-panel)",
                      border: `1px solid ${sel ? "var(--color-amber)" : "var(--color-border)"}`,
                      borderRadius: 8,
                      padding: "14px 16px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        fontWeight: 600,
                        fontSize: 14,
                        color: "var(--color-text)",
                      }}
                    >
                      <ModelDot color={t.dot} size={8} />
                      {t.label}
                      {sel && (
                        <span style={{ marginLeft: "auto", color: "var(--color-amber)", fontSize: 12 }}>
                          selected
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--color-muted)", lineHeight: 1.5 }}>
                      {t.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* -------- Step 2 · Challenge pack -------- */}
        {/* Verified mode inverts the lists: eval packs are selectable, arena
            packs are greyed with a mode tag (and vice versa in every other mode). */}
        {state.step === 2 && (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Challenge pack</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)" }}>
              {isVerified
                ? "Eval packs run a fixed task list scored by deterministic objective assertions."
                : "Build Arena packs return one self-contained HTML artifact per model."}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 760 }}>
              {(isVerified ? evalPacks : arenaPacks).map((p) => {
                const sel = state.packSlug === p.slug;
                const metaParts =
                  p.kind === "eval"
                    ? [
                        `${p.taskCount} task${p.taskCount === 1 ? "" : "s"}`,
                        p.evalScorer ?? p.scorersSummary,
                        `est. ~${kTokens(p.taskCount * VERIFIED_EST_OUTPUT_TOKENS_PER_TASK)} output tokens/model`,
                      ]
                    : [
                        `${p.taskCount} task${p.taskCount === 1 ? "" : "s"}`,
                        ...(p.browserCheckCount != null
                          ? [`${p.browserCheckCount} browser checks`]
                          : []),
                        ...(p.estOutputTokensPerModel != null
                          ? [`est. ~${kTokens(p.estOutputTokensPerModel)} output tokens/model`]
                          : []),
                      ];
                return (
                  <button
                    key={p.slug}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => set({ packSlug: p.slug })}
                    className={sel ? undefined : "hover-border"}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      alignItems: "flex-start",
                      textAlign: "left",
                      background: "var(--color-panel)",
                      border: `1px solid ${sel ? "var(--color-amber)" : "var(--color-border)"}`,
                      borderRadius: 8,
                      padding: "14px 16px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text)" }}>
                        {p.name}
                      </span>
                      <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                        {p.version} · {p.source}
                      </span>
                      {sel && (
                        <span style={{ marginLeft: "auto", color: "var(--color-amber)", fontSize: 12 }}>
                          selected
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>{p.description}</span>
                    <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
                      {metaParts.join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxWidth: 760,
                marginTop: 22,
              }}
            >
              <span className="section-label">
                {isVerified
                  ? "Build Arena packs — run in Build Arena mode"
                  : "Eval packs — run in Verified Benchmark mode"}
              </span>
              {(isVerified ? arenaPacks : evalPacks).map((p) => (
                <div
                  key={p.slug}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    background: "var(--color-panel)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: 8,
                    padding: "12px 16px",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--color-muted)" }}>
                      {p.name}
                    </span>
                    <span style={{ ...mono, fontSize: 11, color: "var(--color-disabled)" }}>
                      {p.version} · {p.source}
                    </span>
                    <span style={{ ...mono, marginLeft: "auto", fontSize: 10.5, color: "var(--color-faint)" }}>
                      {isVerified ? "build arena mode" : "verified mode"}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-faint)" }}>{p.description}</span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--color-disabled)" }}>
                    {p.taskCount} task{p.taskCount === 1 ? "" : "s"} ·{" "}
                    {p.evalScorer ?? p.scorersSummary}
                    {p.category ? ` · ${p.category}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* -------- Step 3 · Models & providers -------- */}
        {state.step === 3 && (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>
              Models &amp; providers{" "}
              <span style={{ ...mono, fontSize: 12, color: "var(--color-amber)", fontWeight: 400 }}>
                {n} selected
              </span>
              {!modelCountOk && (
                <span style={{ ...mono, fontSize: 12, color: "var(--color-red)", fontWeight: 400 }}>
                  {" "}
                  · select 2–8
                </span>
              )}
            </h2>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--color-muted)" }}>
              Select 2–8 models. Provider differences for the same model are recorded separately.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, maxWidth: 760 }}>
              <input
                type="search"
                value={state.search}
                onChange={(e) => set({ search: e.target.value })}
                placeholder="⌕ Filter models…"
                aria-label="Filter models"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "var(--color-input)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  color: "var(--color-text)",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
              {(["all", "cloud", "local"] as const).map((f) => {
                const active = state.deployment === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set({ deployment: f })}
                    className="hover-border"
                    style={{
                      background: active ? "var(--color-selected)" : "none",
                      border: "1px solid var(--color-border)",
                      color: active ? "var(--color-text)" : "var(--color-muted)",
                      borderRadius: 6,
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  >
                    {f === "all" ? "All" : f === "cloud" ? "Cloud" : "Local"}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
              {providerGroups.length === 0 && (
                <EmptyState
                  title="No models match"
                  hint="Clear the search or switch the All / Cloud / Local filter."
                />
              )}
              {providerGroups.map(({ provider, endpoints }) => (
                <div
                  key={provider.id}
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      background: "var(--color-panel)",
                      borderBottom: "1px solid var(--color-border-subtle)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    <StatusDot color="var(--color-teal)" size={7} />
                    {providerDisplayName(provider)}
                    <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)", fontWeight: 400 }}>
                      {providerNote(provider)}
                    </span>
                  </div>
                  {endpoints.map((ep) => {
                    const sel = state.selected.includes(ep.id);
                    const model = getModelForEndpoint(ep.id);
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        aria-pressed={sel}
                        onClick={() => toggleEndpoint(ep.id)}
                        className="hover-row"
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "center",
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "9px 12px",
                          background: sel ? "var(--color-row-checked)" : "none",
                          border: "none",
                          borderBottom: "1px solid var(--color-border-row)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textAlign: "left",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 16,
                            height: 16,
                            flex: "0 0 16px",
                            borderRadius: 4,
                            border: `1px solid ${sel ? "var(--color-amber)" : "var(--color-border-hover)"}`,
                            background: sel ? "var(--color-amber)" : "none",
                            color: "var(--color-on-accent)",
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                          }}
                        >
                          {sel ? "✓" : ""}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 1,
                            minWidth: 0,
                            flex: 1,
                            alignItems: "flex-start",
                          }}
                        >
                          <span style={{ ...mono, fontSize: 13, color: "var(--color-text)" }}>
                            {ep.modelId}
                          </span>
                          <span style={{ fontSize: 11.5, color: "var(--color-faint)" }}>
                            {endpointTags(ep)}
                          </span>
                        </span>
                        <span style={{ ...mono, fontSize: 11, color: "var(--color-muted)", textAlign: "right" }}>
                          {ctxLabel(model.contextWindowTokens)}
                        </span>
                        <span
                          style={{
                            ...mono,
                            fontSize: 11,
                            color: "var(--color-muted)",
                            flex: "0 0 110px",
                            width: 110,
                            textAlign: "right",
                          }}
                        >
                          {priceLabel(ep)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}

              {dupeGroups.length > 0 && (
                <Callout variant="warning" glyph="⚠">
                  {dupeGroups.map((group) => {
                    const first = group[0];
                    if (!first) return null;
                    return (
                      <div key={first.modelId} style={{ lineHeight: 1.5 }}>
                        <strong>{first.modelId}</strong> is selected on{" "}
                        {group.map((ep) => ep.providerId).join(" and ")} — results will be tracked
                        separately per provider.
                      </div>
                    );
                  })}
                </Callout>
              )}
              {unseeded.length > 0 && (
                <Callout variant="warning" glyph="⚠">
                  {unseeded.map((ep) => (
                    <div key={ep.id} style={{ lineHeight: 1.5 }}>
                      <strong>{ep.modelId}</strong> ({ep.providerId}) does not support{" "}
                      <code style={{ ...mono }}>seed</code> — runs unseeded, flagged in the manifest.
                    </div>
                  ))}
                </Callout>
              )}
            </div>
          </>
        )}

        {/* -------- Step 4 · Shared generation settings -------- */}
        {state.step === 4 && (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Shared generation settings</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)" }}>
              Locked identically across all models. Unsupported parameters are flagged, never
              silently dropped.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
                gap: 12,
                maxWidth: 760,
              }}
            >
              {params.map((p) => (
                <div
                  key={p.name}
                  style={{
                    background: "var(--color-panel)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</span>
                    <span style={{ fontSize: 11.5, color: "var(--color-faint)" }}>{p.sub}</span>
                  </span>
                  <span
                    style={{
                      ...mono,
                      fontSize: 13,
                      color: "var(--color-amber)",
                      background: "var(--color-raised)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 5,
                      padding: "4px 10px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.val}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* -------- Step 5 · Scoring & safeguards -------- */}
        {state.step === 5 && (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Scoring &amp; safeguards</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)" }}>
              Each scorer is labeled in results — objective, browser, human, and judge scores are
              never merged silently.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 680 }}>
              {[
                /* Verified mode scores with the single objective scorer — the
                   browser/human/judge stack belongs to Build Arena runs. */
                ...(isVerified
                  ? [
                      {
                        key: "objective",
                        badge: SCORER_BADGES["objective"] ?? {
                          label: "OBJECTIVE",
                          color: "var(--color-model-gpt)",
                        },
                        name: `Objective scorer — ${taskCount} task${taskCount === 1 ? "" : "s"}`,
                        desc: SCORER_DESCS["objective"] ?? "",
                        stateLabel: "enabled",
                        stateColor: "var(--color-teal)",
                      },
                    ]
                  : cfg.scorers.map((s) => ({
                      key: s.type,
                      badge: SCORER_BADGES[s.type] ?? { label: s.type.toUpperCase(), color: "var(--color-muted)" },
                      name: s.name,
                      desc: SCORER_DESCS[s.type] ?? "",
                      stateLabel: s.enabled ? "enabled" : "off",
                      stateColor: s.enabled ? "var(--color-teal)" : "var(--color-faint)",
                    }))),
                {
                  key: "safeguard",
                  badge: { label: "SAFEGUARD", color: "var(--color-model-neutral)" },
                  name: "Budget & sandbox safeguards",
                  desc: safeguardDesc,
                  stateLabel: "always on",
                  stateColor: "var(--color-muted)",
                },
              ].map((row) => (
                <div
                  key={row.key}
                  style={{
                    background: "var(--color-panel)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      ...mono,
                      fontSize: 10,
                      color: row.badge.color,
                      border: "1px solid var(--color-border)",
                      borderRadius: 3,
                      padding: "3px 7px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.badge.label}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: row.key === "safeguard" ? "var(--color-text-secondary)" : "var(--color-text)",
                      }}
                    >
                      {row.name}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--color-muted)", lineHeight: 1.5 }}>
                      {row.desc}
                    </span>
                  </span>
                  <span style={{ ...mono, fontSize: 11, color: row.stateColor, whiteSpace: "nowrap" }}>
                    {row.stateLabel}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* -------- Step 6 · Review & launch -------- */}
        {state.step === 6 && (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Review &amp; launch</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)" }}>
              This configuration is hashed into the run fingerprint before launch.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 680 }}>
              <div
                style={{
                  background: "var(--color-panel)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {reviewRows.map((r) => (
                  <div
                    key={r.k}
                    style={{
                      display: "flex",
                      padding: "9px 14px",
                      borderBottom: "1px solid var(--color-border-row)",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ width: 180, flex: "0 0 180px", color: "var(--color-faint)" }}>
                      {r.k}
                    </span>
                    <span
                      style={{ ...mono, fontSize: 12.5, color: "var(--color-text-secondary)", minWidth: 0 }}
                    >
                      {r.v}
                    </span>
                  </div>
                ))}
              </div>

              {unseeded.length > 0 && (
                <Callout variant="warning" glyph="⚠">
                  {unseeded.length} configuration difference{unseeded.length === 1 ? "" : "s"}:{" "}
                  {unseeded.map((ep) => `${ep.modelId} (${ep.providerId})`).join(" · ")}{" "}
                  {unseeded.length === 1 ? "runs" : "run"} unseeded.
                </Callout>
              )}
              {!modelCountOk && (
                <Callout variant="danger" glyph="✕">
                  {modelCountReason} Start Run is disabled until 2–8 models are selected.
                </Callout>
              )}
              {budgetExceeded && (
                <Callout variant="danger" glyph="✕">
                  Worst-case estimate {usd(cost.high)} exceeds the {usd(cfg.maxBudgetUsd)} budget
                  ceiling — deselect models, or lower samples in a later phase. Start Run is
                  disabled.
                </Callout>
              )}

              {launchError && (
                <Callout variant="danger" glyph="✕">
                  {launchError} Nothing was launched — adjust the configuration and try again.
                </Callout>
              )}

              {canStart ? (
                <button
                  type="button"
                  onClick={() => void startRun()}
                  disabled={launching}
                  className="btn-primary"
                  style={{
                    alignSelf: "flex-start",
                    background: "var(--color-amber)",
                    color: "var(--color-on-accent)",
                    border: "none",
                    fontWeight: 600,
                    borderRadius: 7,
                    padding: "11px 26px",
                    fontSize: 14,
                    fontFamily: "inherit",
                    cursor: launching ? "wait" : "pointer",
                    opacity: launching ? 0.7 : 1,
                  }}
                >
                  {launching ? "Starting…" : `Start Run — est. ${costLabel}`}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title={startBlockReason}
                  style={{
                    alignSelf: "flex-start",
                    background: "var(--color-raised)",
                    color: "var(--color-disabled)",
                    border: "1px solid var(--color-border)",
                    fontWeight: 600,
                    borderRadius: 7,
                    padding: "11px 26px",
                    fontSize: 14,
                    fontFamily: "inherit",
                    cursor: "not-allowed",
                  }}
                >
                  Start Run — est. {costLabel}
                </button>
              )}
              <span style={{ fontSize: 11.5, color: "var(--color-faint)" }}>
                Launching registers this configuration and opens its live stream — Phase 1
                replays a simulated event script; the native runner lands in Phase 2.
              </span>
            </div>
          </>
        )}
      </section>

      {/* Right cost rail */}
      <aside
        style={{
          flex: "1 1 280px",
          boxSizing: "border-box",
          borderLeft: "1px solid var(--color-border-subtle)",
          padding: "20px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          background: "var(--color-rail)",
        }}
      >
        <span className="section-label">Cost estimate</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--color-muted)" }}>Models</span>
            <span style={mono}>{n}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--color-muted)" }}>
              {isVerified ? "Tasks / model" : "Samples / model"}
            </span>
            <span style={mono}>{isVerified ? taskCount : samples}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--color-muted)" }}>Expected calls</span>
            <span style={mono}>{calls}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--color-muted)" }}>Est. tokens</span>
            <span style={mono}>{n > 0 ? `${kTokens(tok.low)}–${kTokens(tok.high)}` : "—"}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: "1px solid var(--color-border-subtle)",
              paddingTop: 10,
            }}
          >
            <span style={{ color: "var(--color-muted)" }}>Est. cost</span>
            <span style={{ ...mono, color: "var(--color-amber)", fontWeight: 600 }}>{costLabel}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--color-muted)" }}>Budget ceiling</span>
            <span style={mono}>{usd(cfg.maxBudgetUsd)}</span>
          </div>
        </div>
        <ProgressBar pct={Math.min(100, budgetPctRaw)} gradient height={6} />
        {budgetExceeded ? (
          <Callout variant="danger" glyph="✕" style={{ padding: "9px 12px", fontSize: 12 }}>
            Worst-case estimate {usd(cost.high)} is {Math.round(budgetPctRaw)}% of the{" "}
            {usd(cfg.maxBudgetUsd)} budget — over the ceiling. Start Run is disabled.
          </Callout>
        ) : (
          <span style={{ fontSize: 12, color: "var(--color-faint)", lineHeight: 1.5 }}>
            Worst-case estimate is {Math.round(budgetPctRaw)}% of the run budget. The run hard-stops
            if the ceiling is reached.
          </span>
        )}
        <span style={{ fontSize: 11, color: "var(--color-faint)", lineHeight: 1.5 }}>
          {isVerified
            ? "Formula: 2k prompt tokens + tasks × ~200 output tokens (±20%) × $/Mtok · local models $0."
            : "Formula: samples × (2k prompt tokens + pack est. output ±20%) × $/Mtok · local models $0."}
        </span>
        <div
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            paddingTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
            color: "var(--color-muted)",
          }}
        >
          <span className="section-label">Selected models · {n}</span>
          {selectedEndpoints.map((ep) => (
            <span
              key={ep.id}
              style={{
                ...mono,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 7,
                color: "var(--color-text-secondary)",
              }}
            >
              <ModelDot color={getModelForEndpoint(ep.id).identityColor} size={8} />
              {ep.modelId}
              {ep.deployment === "local" ? " · local" : ""}
            </span>
          ))}
          {n === 0 && (
            <span style={{ fontSize: 12, color: "var(--color-faint)" }}>none selected</span>
          )}
        </div>
        {state.step < 6 && (
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {continueBlocked && (
              <span role="alert" style={{ fontSize: 12, color: "var(--color-red)", lineHeight: 1.4 }}>
                {modelCountReason}
              </span>
            )}
            <button
              type="button"
              disabled={continueBlocked}
              onClick={() => set({ step: Math.min(6, state.step + 1) })}
              className={continueBlocked ? undefined : "hover-amber-border"}
              style={{
                background: "var(--color-raised)",
                border: "1px solid var(--color-border)",
                color: continueBlocked ? "var(--color-disabled)" : "var(--color-text)",
                borderRadius: 7,
                padding: 10,
                cursor: continueBlocked ? "not-allowed" : "pointer",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                width: "100%",
              }}
            >
              Continue →
            </button>
          </div>
        )}
      </aside>
    </main>
  );
}
