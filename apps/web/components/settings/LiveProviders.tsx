"use client";

/**
 * Provider cards fed by real probes (GET /api/providers/health) instead of
 * fixture status. Rendered on a live instance; the demo workspace keeps the
 * fixture cards. Providers the runner has no probe for are hidden — they
 * cannot take part in a run here either.
 */
import { useCallback, useEffect, useState } from "react";
import type { Provider } from "@model-lab/schemas";
import { ProviderCard } from "./ProviderCard";

interface Health {
  providerId: string;
  status: "connected" | "disconnected" | "rate-limited" | "no-key" | "unsupported" | "mocked";
  latencyMs: number | null;
  modelsAvailable: number | null;
  credentialEnv: string | null;
  endpoint: string | null;
  checkedAt: string;
  detail: string | null;
}

interface HealthResponse {
  cached: boolean;
  checkedAt: string;
  providers: Health[];
}

/** Fixture card → what the probe found. Nothing here was ever a secret. */
function withHealth(p: Provider, h: Health | undefined): Provider {
  if (h === undefined) {
    return {
      ...p,
      status: "disconnected",
      healthLatencyMs: null,
      modelsAvailable: null,
      modelsLoaded: null,
      lastTestedAt: null,
      credentialMasked: "checking…",
      credentialStore: "unset",
      warning: null,
    };
  }
  const keyless = h.credentialEnv === null;
  const mocked = h.status === "mocked";
  const keyed = !keyless && h.status !== "no-key" && !mocked;
  return {
    ...p,
    status:
      h.status === "connected"
        ? "connected"
        : h.status === "rate-limited"
          ? "rate-limited"
          : "disconnected",
    healthLatencyMs: h.latencyMs,
    modelsAvailable: p.isLocal ? null : h.modelsAvailable,
    modelsLoaded: p.isLocal ? h.modelsAvailable : null,
    lastTestedAt: mocked || h.status === "no-key" ? null : h.checkedAt,
    credentialMasked: mocked
      ? "not checked (mock mode)"
      : keyless
        ? "none needed (local)"
        : keyed
          ? `${h.credentialEnv} · set`
          : `${h.credentialEnv} · not set`,
    credentialStore: keyless ? "none" : keyed ? "env" : "unset",
    warning:
      h.detail !== null && h.status !== "connected" && h.status !== "no-key"
        ? { message: h.detail }
        : null,
    localEndpoint: p.isLocal ? (h.endpoint ?? p.localEndpoint) : p.localEndpoint,
  };
}

export function LiveProviders({ initial }: { initial: Provider[] }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/health${refresh ? "?refresh=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth((await res.json()) as HealthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const byId = new Map((health?.providers ?? []).map((h) => [h.providerId, h]));
  const cards = initial
    .filter((p) => byId.get(p.id)?.status !== "unsupported")
    .map((p) => withHealth(p, byId.get(p.id)));
  const probed = (health?.providers ?? []).filter((h) => h.latencyMs !== null).length;
  const mocked = (health?.providers ?? []).some((h) => h.status === "mocked");

  return (
    <>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-muted)" }} aria-live="polite">
        {checking
          ? "Checking provider availability…"
          : error !== null
            ? `Health check failed: ${error}`
            : mocked
              ? "Forced mock mode: no provider network requests were made."
              : `${probed} providers probed${health?.cached ? " (cached for a minute)" : ""}. Keys are read from this server's environment; only whether one is set is shown.`}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))",
          gap: 12,
        }}
      >
        {cards.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            now={Date.now()}
            onTest={() => void load(true)}
            testing={checking}
            mocked={byId.get(p.id)?.status === "mocked"}
          />
        ))}
      </div>
    </>
  );
}
