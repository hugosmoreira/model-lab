import Link from "next/link";
import { connection } from "next/server";
import { resolveBackend } from "@model-lab/store";
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
          title="In-memory storage is temporary and includes a labelled illustrative demo"
        >
          memory · ephemeral
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

      <span
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px 12px",
          marginLeft: "auto",
        }}
      >
        <span
          title="Configured API keys; connection health is available under Providers"
          style={stat}
        >
          <Dot color={keyed > 0 ? "var(--color-teal)" : "var(--color-faint)"} />
          {keyed}/{KEYED_PROVIDERS.length} cloud providers configured
        </span>
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
      </span>
    </header>
  );
}
