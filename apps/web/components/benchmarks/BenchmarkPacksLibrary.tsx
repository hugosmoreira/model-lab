"use client";

import { useState } from "react";
import Link from "next/link";
import type { BenchmarkPack } from "@model-lab/schemas";
import { EmptyState, Panel, SectionLabel } from "@/components/ui/primitives";
import { usd } from "@/lib/format";

const mono = { fontFamily: "var(--font-mono)" } as const;

/**
 * Tab → provenance mapping (audit ambiguity resolved): the prototype's tabs
 * were All/Official/Custom while data provenance is official | community |
 * imported | custom. "Official" = source 'official'; everything else lands
 * under an honestly-labelled "Community & custom" tab.
 */
const TABS = [
  { id: "all", label: "All" },
  { id: "official", label: "Official" },
  { id: "community-custom", label: "Community & custom" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Arena tag chips: official=magenta, community=purple (prototype colors). */
const ARENA_TAG_COLORS: Record<string, string> = {
  official: "var(--color-magenta)",
  community: "var(--color-model-gemini)",
  imported: "var(--color-amber)",
  custom: "var(--color-magenta)",
};

/** Eval source labels: official=teal, imported=amber, custom=magenta. */
const EVAL_SOURCE_COLORS: Record<string, string> = {
  official: "var(--color-teal)",
  imported: "var(--color-amber)",
  custom: "var(--color-magenta)",
  community: "var(--color-model-gemini)",
};

const EVAL_GRID = "1.5fr 90px 110px 120px 100px 100px 110px 120px";

function matchesTab(pack: BenchmarkPack, tab: TabId): boolean {
  if (tab === "all") return true;
  if (tab === "official") return pack.source === "official";
  return pack.source !== "official";
}

function matchesQuery(pack: BenchmarkPack, query: string): boolean {
  if (!query) return true;
  return [pack.name, pack.description, pack.category ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function runHref(pack: BenchmarkPack): string {
  return `/runs/new?pack=${encodeURIComponent(pack.slug)}`;
}

function GhostButton({ label, title }: { label: string; title: string }) {
  return (
    <button
      type="button"
      disabled
      title={title}
      style={{
        background: "none",
        border: "1px solid var(--color-border)",
        color: "var(--color-disabled)",
        borderRadius: 5,
        padding: "5px 12px",
        cursor: "not-allowed",
        fontSize: 12,
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

function ArenaPackCard({ pack }: { pack: BenchmarkPack }) {
  const tagColor = ARENA_TAG_COLORS[pack.source] ?? "var(--color-muted)";
  return (
    <Panel
      style={{
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{pack.name}</span>
        <span
          style={{
            ...mono,
            fontSize: 10,
            color: tagColor,
            border: "1px solid var(--color-border)",
            borderRadius: 3,
            padding: "2px 6px",
            whiteSpace: "nowrap",
          }}
        >
          {pack.source}
        </span>
        <span style={{ marginLeft: "auto", ...mono, fontSize: 11, color: "var(--color-faint)" }}>
          {pack.version}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-muted)", lineHeight: 1.5 }}>
        {pack.description}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "3px 12px",
          ...mono,
          fontSize: 11,
          color: "var(--color-faint)",
        }}
      >
        <span>
          {pack.taskCount} {pack.taskCount === 1 ? "task" : "tasks"} · html
        </span>
        <span>{pack.scorersSummary}</span>
        <span>
          {pack.estCostPerModelUsd != null ? `est. ~${usd(pack.estCostPerModelUsd)}/model` : "est. cost n/a"}
        </span>
        <span>{pack.lastRunAt ? `last run: ${pack.lastRunAt}` : "never run"}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 2, fontSize: 12 }}>
        <Link
          href={runHref(pack)}
          className="hover-amber-border"
          style={{
            background: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            borderRadius: 5,
            padding: "5px 12px",
            color: "var(--color-text-secondary)",
          }}
        >
          Run
        </Link>
        <GhostButton label="Methodology" title="Pack methodology lands in Phase 5" />
        <GhostButton label="Fork" title="Pack forking lands in Phase 5" />
      </div>
    </Panel>
  );
}

function EvalPackRow({ pack }: { pack: BenchmarkPack }) {
  const sourceColor = EVAL_SOURCE_COLORS[pack.source] ?? "var(--color-muted)";
  return (
    <div
      className="hover-row"
      style={{
        display: "grid",
        gridTemplateColumns: EVAL_GRID,
        gap: 10,
        alignItems: "center",
        padding: "11px 16px",
        borderBottom: "1px solid var(--color-border-row)",
        fontSize: 13,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{pack.name}</span>
        <span style={{ fontSize: 11, color: "var(--color-faint)" }}>
          {pack.category ? `${pack.category} · ${pack.license}` : pack.license}
        </span>
      </span>
      <span style={{ ...mono, fontSize: 11.5, color: "var(--color-muted)" }}>{pack.version}</span>
      <span style={{ ...mono, fontSize: 11.5, color: "var(--color-muted)" }}>
        {pack.taskCount} tasks
      </span>
      <span style={{ ...mono, fontSize: 10.5, color: "var(--color-model-gpt)" }}>
        {pack.evalScorer ?? "—"}
      </span>
      <span style={{ ...mono, fontSize: 11.5, color: "var(--color-muted)" }}>
        {pack.estCostPerModelUsd != null ? `~${usd(pack.estCostPerModelUsd)}/model` : "—"}
      </span>
      <span style={{ ...mono, fontSize: 11.5, color: "var(--color-faint)" }}>
        {pack.lastRunAt ?? "never"}
      </span>
      <span style={{ ...mono, fontSize: 10.5, color: sourceColor }}>{pack.source}</span>
      <span style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
        <Link href={runHref(pack)} className="hover-amber" style={{ color: "var(--color-amber)" }}>
          Run
        </Link>
        <button
          type="button"
          disabled
          title="Per-pack run history lands in Phase 3"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--color-disabled)",
            cursor: "not-allowed",
            fontSize: 12,
            fontFamily: "inherit",
          }}
        >
          History
        </button>
      </span>
    </div>
  );
}

export function BenchmarkPacksLibrary({ packs }: { packs: BenchmarkPack[] }) {
  const [tab, setTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const visible = packs.filter((p) => matchesTab(p, tab) && matchesQuery(p, query));
  const arenaPacks = visible.filter((p) => p.kind === "build-arena");
  const evalPacks = visible.filter((p) => p.kind === "eval");

  return (
    <main
      style={{
        flex: 1,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 1300,
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      {/* Toolbar: search + filter tabs + import */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span
          style={{
            flex: "1 1 200px",
            maxWidth: 360,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--color-input)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "6px 10px",
            color: "var(--color-faint)",
            fontSize: 13,
          }}
        >
          <span aria-hidden>⌕</span>
          <input
            type="search"
            aria-label="Search packs"
            placeholder="Search packs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--color-text)",
              fontSize: 13,
              fontFamily: "inherit",
              padding: 0,
            }}
          />
        </span>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.id)}
              className="hover-border"
              style={{
                background: active ? "var(--color-selected)" : "none",
                border: "1px solid var(--color-border)",
                color: active ? "var(--color-text)" : "var(--color-muted)",
                borderRadius: 6,
                padding: "7px 14px",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled
          title="pack import lands in Phase 5"
          style={{
            marginLeft: "auto",
            background: "var(--color-raised)",
            border: "1px solid var(--color-border)",
            color: "var(--color-disabled)",
            borderRadius: 6,
            padding: "7px 14px",
            cursor: "not-allowed",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        >
          Import pack
        </button>
      </div>

      {/* Build Arena challenges */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionLabel>Build Arena challenges — visual, one-shot HTML artifacts</SectionLabel>
        {arenaPacks.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
              gap: 12,
            }}
          >
            {arenaPacks.map((p) => (
              <ArenaPackCard key={p.slug} pack={p} />
            ))}
          </div>
        ) : (
          <Panel>
            <EmptyState
              title="No Build Arena challenges match"
              hint="Adjust the search or switch filter tabs."
            />
          </Panel>
        )}
      </div>

      {/* Formal evaluation packs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionLabel>Formal evaluation packs — objective, deterministic scorers</SectionLabel>
        {evalPacks.length > 0 ? (
          <Panel style={{ overflow: "auto" }}>
            <div style={{ minWidth: 960 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: EVAL_GRID,
                  gap: 10,
                  padding: "9px 16px",
                  borderBottom: "1px solid var(--color-border-subtle)",
                  fontSize: 10.5,
                  color: "var(--color-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                <span>Pack</span>
                <span>Version</span>
                <span>Tasks</span>
                <span>Scorers</span>
                <span>Est. cost</span>
                <span>Last run</span>
                <span>Source</span>
                <span>Actions</span>
              </div>
              {evalPacks.map((p) => (
                <EvalPackRow key={p.slug} pack={p} />
              ))}
            </div>
          </Panel>
        ) : (
          <Panel>
            <EmptyState
              title="No evaluation packs match"
              hint="Adjust the search or switch filter tabs."
            />
          </Panel>
        )}
      </div>
    </main>
  );
}
