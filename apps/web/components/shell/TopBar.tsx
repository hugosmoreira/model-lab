import Link from "next/link";
import { connection } from "next/server";
import { resolveBackend } from "@model-lab/store";
import { fixtures } from "@/lib/data";
import { usd } from "@/lib/format";
import { isReadOnly } from "@/lib/server/read-only";

/**
 * Providers whose credential is one environment variable. Ollama is keyless
 * by design, so a running local server cannot be proven from here.
 */
const KEYED_PROVIDERS = [
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["openai", "OPENAI_API_KEY"],
  ["deepseek", "DEEPSEEK_API_KEY"],
  ["google", "GOOGLE_API_KEY"],
  ["openrouter", "OPENROUTER_API_KEY"],
] as const;

/**
 * "demo" when the workspace is the seeded in-memory fixture set — then the
 * statistics in this bar are illustrative and say so. Any persistent backend
 * is "live": only facts about this environment are shown.
 */
function workspaceMode(): "demo" | "live" {
  try {
    return resolveBackend() === "memory" ? "demo" : "live";
  } catch {
    return "live";
  }
}

const chip = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--color-faint)",
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  padding: "2px 7px",
  whiteSpace: "nowrap",
} as const;

const stat = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--color-muted)",
} as const;

function Dot({ color }: { color: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />;
}

const newRunButton = {
  background: "var(--color-amber)",
  color: "var(--color-on-accent)",
  fontWeight: 600,
  borderRadius: 6,
  padding: "6px 14px",
  fontSize: 13,
} as const;

export async function TopBar({ title }: { title: string }) {
  // Read at request time, never at build time: one image serves as a demo or
  // as a live instance depending on the environment it starts with.
  await connection();
  const mode = workspaceMode();
  const readOnly = isReadOnly();
  const keyed = KEYED_PROVIDERS.filter(([, env]) => (process.env[env] ?? "") !== "").length;
  const { workspaceStats: stats } = fixtures;
  const budgetPct = Math.round((stats.sessionSpend.usd / stats.sessionSpend.budgetUsd) * 100);

  return (
    <header
      style={{
        minHeight: 48,
        boxSizing: "border-box",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 14px",
        padding: "7px 16px",
        background: "var(--color-rail)",
        borderBottom: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</span>
      {mode === "demo" && (
        <span
          style={chip}
          title="The workspace statistics and the seeded run are illustrative fixtures"
        >
          demo data
        </span>
      )}
      {readOnly && (
        <span
          style={{ ...chip, color: "var(--color-amber)", borderColor: "var(--color-amber)" }}
          title="This instance serves results but does not accept new runs, votes, or annotations"
        >
          read-only
        </span>
      )}

      <button
        type="button"
        aria-label="Search runs, models, artifacts"
        style={{
          flex: "1 1 180px",
          minWidth: 120,
          maxWidth: 420,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--color-input)",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          padding: "5px 10px",
          color: "var(--color-faint)",
          fontFamily: "inherit",
          fontSize: 13,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12 }} aria-hidden>
          ⌕
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Search runs, models, artifacts…
        </span>
        <kbd
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            border: "1px solid var(--color-border)",
            borderRadius: 3,
            padding: "1px 5px",
          }}
        >
          ⌘K
        </kbd>
      </button>

      <span
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px 12px",
          marginLeft: "auto",
        }}
      >
        {mode === "demo" ? (
          <>
            <span title="Providers connected (demo workspace)" style={stat}>
              <Dot color="var(--color-teal)" />
              providers {stats.providersConnected.connected}/{stats.providersConnected.total}
            </span>
            <span title="Local runner (demo workspace)" style={stat}>
              <Dot color="var(--color-teal)" />
              {stats.localRunner.engine} · {stats.localRunner.gpu}
            </span>
            <span title="Session spend vs budget (demo workspace)" style={{ ...stat, gap: 7 }}>
              <span
                style={{
                  width: 54,
                  height: 4,
                  borderRadius: 2,
                  background: "var(--color-border)",
                  overflow: "hidden",
                  display: "inline-block",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${budgetPct}%`,
                    background: "var(--color-amber)",
                  }}
                />
              </span>
              {usd(stats.sessionSpend.usd)} / {usd(stats.sessionSpend.budgetUsd)}
            </span>
          </>
        ) : (
          <span
            title="Cloud providers with an API key in this environment; local Ollama needs none"
            style={stat}
          >
            <Dot color={keyed > 0 ? "var(--color-teal)" : "var(--color-faint)"} />
            providers {keyed}/{KEYED_PROVIDERS.length} keyed
          </span>
        )}
        {readOnly ? (
          <span
            aria-disabled="true"
            title="This instance is read-only — run Model Lab locally to benchmark"
            style={{ ...newRunButton, opacity: 0.45, cursor: "not-allowed" }}
          >
            New Run
          </span>
        ) : (
          <Link href="/runs/new" style={newRunButton}>
            New Run
          </Link>
        )}
        <span
          aria-label="Account: HM"
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "var(--color-border)",
            color: "var(--color-text-secondary)",
            fontSize: 11,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          HM
        </span>
      </span>
    </header>
  );
}
