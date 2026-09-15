import Link from "next/link";
import { fixtures } from "@/lib/data";
import { usd } from "@/lib/format";

export function TopBar({ title }: { title: string }) {
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
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-faint)",
          border: "1px solid var(--color-border)",
          borderRadius: 4,
          padding: "2px 7px",
          whiteSpace: "nowrap",
        }}
      >
        demo data
      </span>

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
        <span
          title="Providers connected"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-muted)",
          }}
        >
          <span
            style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-teal)" }}
          />
          providers {stats.providersConnected.connected}/{stats.providersConnected.total}
        </span>
        <span
          title="Local runner"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-muted)",
          }}
        >
          <span
            style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-teal)" }}
          />
          {stats.localRunner.engine} · {stats.localRunner.gpu}
        </span>
        <span
          title="Session spend vs budget"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-muted)",
          }}
        >
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
        <Link
          href="/runs/new"
          style={{
            background: "var(--color-amber)",
            color: "var(--color-on-accent)",
            fontWeight: 600,
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 13,
          }}
        >
          New Run
        </Link>
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
