"use client";

/**
 * Head-to-Head queue client (Phase 6) — drives the real blind-comparison flow
 * over the server-built pair queue:
 *
 *   blind pair (sandboxed artifact previews, neutral chrome, NO model names
 *   or identity colors) → vote/skip + confidence POSTs to
 *   /api/runs/[runId]/votes → on success the queue state refreshes, the pair
 *   locks (votes are FINAL — blind protocol) and identities + judge
 *   comparison reveal → "Next pair →" advances to the next unvoted pair →
 *   end of queue shows the session summary (your W/T/L per model, judge
 *   agreement, link to Results).
 *
 * Types come from the server module via type-only imports (erased at build).
 */
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Artifact } from "@model-lab/schemas";
import type {
  Confidence,
  PairQueue,
  PairSideView,
  PairState,
  VoteChoice,
} from "@/lib/server/pairs";
import { ArtifactSandbox } from "@/components/artifact/ArtifactSandbox";
import { Callout, EmptyState, ModelDot, Panel } from "@/components/ui/primitives";
import { HistoryPanel, type HistoryRow } from "@/components/compare/HistoryPanel";

const mono = { fontFamily: "var(--font-mono)" } as const;

const LOCK_TITLE = "votes are final after reveal — blind protocol";

const VOTE_LABELS: Record<VoteChoice, string> = {
  A: "A wins",
  B: "B wins",
  tie: "Tie",
  skip: "skipped",
};

/**
 * Blind-safe placeholder preview art (colors verbatim from the design audit)
 * for pairs whose endpoint has no stored artifact. Deliberately neutral scene
 * hues — must NOT leak model identity pre-reveal.
 */
const PREVIEW_ART: Record<"A" | "B", { gradient: string; walls: CSSProperties[] }> = {
  A: {
    gradient: "linear-gradient(#1e2a2e 0 55%, #2a2433 55% 100%)",
    walls: [
      { left: "10%", top: "18%", bottom: "26%", width: "26%", background: "#3e5a63" },
      { left: "42%", top: "26%", bottom: "33%", width: "16%", background: "#4a6a74" },
      { right: "12%", top: "10%", bottom: "24%", width: "22%", background: "#4c6e79" },
    ],
  },
  B: {
    gradient: "linear-gradient(#2a2438 0 50%, #231d2e 50% 100%)",
    walls: [
      { left: "6%", top: "22%", bottom: "26%", width: "30%", background: "#5a4a7e" },
      { left: "44%", top: "30%", bottom: "34%", width: "18%", background: "#645187" },
      { right: "8%", top: "26%", bottom: "30%", width: "22%", background: "#6a5691" },
    ],
  },
};

/** Session W/T/L tally per endpoint, from final non-skip votes. */
interface Tally {
  endpointId: string;
  modelId: string;
  shortName: string;
  color: string;
  w: number;
  t: number;
  l: number;
}

function talliesFrom(pairs: PairState[]): Tally[] {
  const map = new Map<string, Tally>();
  const ensure = (side: PairSideView): Tally => {
    const existing = map.get(side.endpointId);
    if (existing) return existing;
    const fresh: Tally = {
      endpointId: side.endpointId,
      modelId: side.modelId,
      shortName: side.shortName,
      color: side.color,
      w: 0,
      t: 0,
      l: 0,
    };
    map.set(side.endpointId, fresh);
    return fresh;
  };
  for (const p of pairs) {
    const a = ensure(p.a);
    const b = ensure(p.b);
    if (!p.final || p.vote == null || p.vote === "skip") continue;
    if (p.vote === "A") {
      a.w++;
      b.l++;
    } else if (p.vote === "B") {
      b.w++;
      a.l++;
    } else {
      a.t++;
      b.t++;
    }
  }
  return [...map.values()];
}

function historyRows(queue: PairQueue): HistoryRow[] {
  return queue.pairs.map((p): HistoryRow => {
    const base = {
      pairIndex: p.pairIndex,
      index: `${p.pairIndex}/${p.pairTotal}`,
      pairing: `${p.a.shortName} vs ${p.b.shortName}`,
    };
    const yourVote = p.final
      ? p.vote == null || p.vote === "skip"
        ? { yourVote: "skipped / invalid", yourVoteColor: "var(--color-faint)" }
        : {
            yourVote: `you: ${VOTE_LABELS[p.vote]} · ${p.confidence}`,
            yourVoteColor: "var(--color-amber)",
          }
      : p.pairIndex === queue.currentIndex
        ? { yourVote: "pending — up next", yourVoteColor: "var(--color-muted)" }
        : { yourVote: "pending your vote", yourVoteColor: "var(--color-faint)" };
    // Blind protocol: the judge's verdict stays hidden until the user's own
    // vote locks; the reversal flag (order-sensitivity, no winner named) shows.
    const judge = p.judge
      ? p.judge.reversed
        ? { judge: "REVERSED on swap ⟲", judgeColor: "var(--color-amber)" }
        : !p.final
          ? { judge: "hidden until you vote", judgeColor: "var(--color-faint)" }
          : p.judge.verdictAB == null
            ? { judge: "judge verdict pending", judgeColor: "var(--color-faint)" }
            : {
                judge: `judge: ${p.judge.verdictAB === "tie" ? "tie" : `${p.judge.verdictAB} wins`} · both orders`,
                judgeColor: "var(--color-teal)",
              }
      : { judge: "—", judgeColor: "var(--color-faint)" };
    return { ...base, ...yourVote, ...judge };
  });
}

export function HeadToHeadClient({ initial }: { initial: PairQueue }) {
  const [queue, setQueue] = useState<PairQueue>(initial);
  /** 1-based pairIndex being viewed; null = end-of-queue summary. */
  const [viewIndex, setViewIndex] = useState<number | null>(initial.currentIndex);
  const [conf, setConf] = useState<Confidence>("med");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runId = queue.runId;
  const pair = viewIndex == null ? null : queue.pairs.find((p) => p.pairIndex === viewIndex) ?? null;
  const revealed = pair?.final ?? false;
  const locked = revealed || busy;

  async function cast(choice: VoteChoice) {
    if (pair == null || locked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairIndex: pair.pairIndex, vote: choice, confidence: conf }),
      });
      if (res.status === 409) {
        // Another session finalized this pair — resync and keep the queue honest.
        const sync = await fetch(`/api/runs/${encodeURIComponent(runId)}/votes`);
        if (sync.ok) setQueue((await sync.json()) as PairQueue);
        setError("This pair already had a final vote — queue resynced.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setQueue((await res.json()) as PairQueue);
    } catch {
      setError("Vote could not be saved — try again.");
    } finally {
      setBusy(false);
    }
  }

  function nextPair() {
    setViewIndex(queue.currentIndex);
    setConf("med");
    setError(null);
  }

  const voteButton = (choice: "A" | "B" | "tie", label: string, padding: string) => {
    const selected = pair?.vote === choice;
    return (
      <button
        type="button"
        onClick={() => void cast(choice)}
        disabled={locked}
        aria-disabled={locked}
        aria-pressed={selected}
        title={revealed ? LOCK_TITLE : undefined}
        className={locked ? undefined : choice === "tie" ? "hover-border" : "hover-amber-border"}
        style={{
          background: selected ? "var(--color-amber)" : "var(--color-raised)",
          border: `1px solid ${selected ? "var(--color-amber)" : "var(--color-border)"}`,
          color: selected
            ? "var(--color-on-accent)"
            : locked
              ? "var(--color-disabled)"
              : "var(--color-text)",
          borderRadius: 7,
          padding,
          cursor: locked ? "not-allowed" : "pointer",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "inherit",
        }}
      >
        {label}
      </button>
    );
  };

  /* -- side card ---------------------------------------------------------- */

  const sideCard = (side: PairSideView) => {
    const winner = pair?.vote === side.slot;
    const art = PREVIEW_ART[side.slot];
    // Blind protocol: mask the endpoint id in the sandbox's accessible title
    // until reveal. srcDoc is unchanged, so the iframe does not remount.
    const sandboxArtifact: Artifact | null = side.artifact
      ? { ...side.artifact, endpointId: revealed ? side.artifact.endpointId : `model-${side.slot}-hidden` }
      : null;
    return (
      <section
        key={side.slot}
        aria-label={
          revealed
            ? `Artifact ${side.slot} — ${side.modelId} (${side.providerId})`
            : `Artifact ${side.slot} — identity hidden`
        }
        style={{
          background: "var(--color-panel)",
          border: `1px solid ${winner ? "var(--color-amber)" : "var(--color-border)"}`,
          borderRadius: 8,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 22,
              height: 22,
              flex: "0 0 22px",
              borderRadius: 5,
              background: "var(--color-raised)",
              border: "1px solid var(--color-border-hover)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...mono,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {side.slot}
          </span>
          <span
            style={{
              ...mono,
              fontSize: 12.5,
              color: revealed ? side.color : "var(--color-model-blind)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {revealed
              ? `${side.modelId} · ${side.providerId}`
              : `Model ${side.slot} — identity hidden`}
          </span>
          <span style={{ marginLeft: "auto", ...mono, fontSize: 10.5, color: "var(--color-faint)" }}>
            {revealed && side.artifactMeta ? side.artifactMeta : "interactive preview"}
          </span>
        </div>
        {sandboxArtifact ? (
          <div style={{ padding: 10, display: "flex" }}>
            <ArtifactSandbox artifact={sandboxArtifact} widthPx={null} />
          </div>
        ) : (
          <div
            role="img"
            aria-label={`Preview placeholder for artifact ${side.slot} — no stored artifact for this side`}
            style={{ position: "relative", height: 250, background: art.gradient }}
          >
            {art.walls.map((w, i) => (
              <span key={i} style={{ position: "absolute", ...w }} />
            ))}
            <span
              style={{
                position: "absolute",
                right: 10,
                top: 10,
                width: 56,
                height: 56,
                background: "rgba(10,8,14,0.75)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 4,
              }}
            />
          </div>
        )}
      </section>
    );
  };

  /* -- end-of-queue summary ------------------------------------------------ */

  if (queue.pairs.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Not enough participants for head-to-head"
          hint="A blind comparison needs at least two models in the run."
        />
      </Panel>
    );
  }

  if (pair == null) {
    const tallies = talliesFrom(queue.pairs);
    return (
      <>
        <Panel style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Blind session complete —{" "}
            <span style={{ color: "var(--color-amber)" }}>
              {queue.stats.votesCast} vote{queue.stats.votesCast === 1 ? "" : "s"} cast
            </span>{" "}
            over {queue.pairs.length} pairs
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tallies.map((t) => (
              <div
                key={t.endpointId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px minmax(0,1fr) 120px",
                  gap: 10,
                  alignItems: "center",
                  ...mono,
                  fontSize: 12,
                }}
              >
                <ModelDot color={t.color} />
                <span
                  style={{
                    color: t.color,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.modelId}
                </span>
                <span style={{ color: "var(--color-muted)" }}>
                  {t.w}W — {t.t}T — {t.l}L
                </span>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            {queue.stats.judgeAgreement != null ? (
              <>
                Your blind votes agreed with the LLM judge on{" "}
                <span style={{ color: "var(--color-teal)" }}>{queue.stats.judgeAgreement}</span>{" "}
                comparable pairs (reversal-flagged pairs excluded from the tally).
              </>
            ) : (
              <>No judge scorer in this run — your blind votes stand alone.</>
            )}
          </p>
          <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
            <Link
              href={`/runs/${runId}/results`}
              className="hover-amber"
              style={{ color: "var(--color-amber)", fontWeight: 600 }}
            >
              See aggregate matrix →
            </Link>
            <Link
              href={`/runs/${runId}/artifacts`}
              className="hover-text"
              style={{ color: "var(--color-muted)" }}
            >
              Inspect artifacts
            </Link>
          </div>
        </Panel>
        <HistoryPanel rows={historyRows(queue)} runId={runId} />
      </>
    );
  }

  /* -- active pair --------------------------------------------------------- */

  const a = pair.a;
  const b = pair.b;
  const judge = pair.judge;
  const judgeComparable = judge != null && (judge.verdictAB != null || judge.verdictBA != null);

  return (
    <>
      {/* Criterion / meta header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          Criterion: <span style={{ color: "var(--color-magenta)" }}>{pair.criterion}</span>
        </span>
        <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
          pair {pair.pairIndex} of {pair.pairTotal} · {runId} · order swap:{" "}
          <span style={{ color: pair.orderSwapped ? "var(--color-amber)" : undefined }}>
            {pair.orderSwapped ? "B/A (swapped)" : "A/B (original)"}
          </span>{" "}
          · {revealed ? "identities revealed" : "identities hidden"}
        </span>
        <span style={{ marginLeft: "auto", ...mono, fontSize: 11, color: "var(--color-muted)" }}>
          your votes: {queue.stats.votesCast} · agreement with judge:{" "}
          {queue.stats.judgeAgreement ?? "—"}
        </span>
      </div>

      {/* Judge-contamination warning (demo fixture narrative only) */}
      {pair.conflictWarning && (
        <Callout variant="warning" glyph="⚠">
          {pair.conflictWarning}
        </Callout>
      )}

      {/* 2-up blind comparison cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 14,
        }}
      >
        {sideCard(a)}
        {sideCard(b)}
      </div>

      {/* Vote row */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        {voteButton("A", "◀ A wins", "10px 26px")}
        {voteButton("tie", "Tie", "10px 20px")}
        {voteButton("B", "B wins ▶", "10px 26px")}
        <button
          type="button"
          onClick={() => void cast("skip")}
          disabled={locked}
          aria-disabled={locked}
          aria-pressed={pair.vote === "skip"}
          title={revealed ? LOCK_TITLE : "record this pair as skipped / invalid"}
          className={locked ? undefined : "hover-text"}
          style={{
            background: "none",
            border: "1px solid var(--color-border)",
            color: locked ? "var(--color-disabled)" : "var(--color-faint)",
            borderRadius: 7,
            padding: "10px 18px",
            cursor: locked ? "not-allowed" : "pointer",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        >
          Skip / invalid
        </button>
        <span
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            marginLeft: 14,
            fontSize: 12,
            color: "var(--color-faint)",
          }}
        >
          confidence:
          {(["low", "med", "high"] as const).map((c) => {
            const selected = revealed ? pair.confidence === c : conf === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  if (!locked) setConf(c);
                }}
                disabled={locked}
                aria-disabled={locked}
                aria-pressed={selected}
                title={revealed ? LOCK_TITLE : undefined}
                className={locked ? undefined : "hover-text"}
                style={{
                  background: "none",
                  border: `1px solid ${selected ? "var(--color-border-hover)" : "var(--color-border)"}`,
                  color: selected
                    ? "var(--color-text)"
                    : locked
                      ? "var(--color-disabled)"
                      : "var(--color-faint)",
                  borderRadius: 12,
                  padding: "3px 10px",
                  cursor: locked ? "not-allowed" : "pointer",
                  fontSize: 11.5,
                  fontFamily: "inherit",
                }}
              >
                {c}
              </button>
            );
          })}
        </span>
      </div>

      {error && (
        <Callout variant="danger" glyph="✕">
          {error}
        </Callout>
      )}

      {/* Reveal panel — appears once the vote (or skip) is final */}
      {revealed && (
        <div role="status">
          <Callout
            variant="insight"
            style={{ padding: "14px 18px", flexDirection: "column", display: "flex" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>
                {pair.vote === "skip" || pair.vote == null ? (
                  <>
                    Revealed — pair recorded as{" "}
                    <span style={{ color: "var(--color-amber)" }}>skipped</span>
                  </>
                ) : (
                  <>
                    Revealed — you voted{" "}
                    <span style={{ color: "var(--color-amber)" }}>{VOTE_LABELS[pair.vote]}</span>
                  </>
                )}
                <span
                  style={{
                    marginLeft: 10,
                    ...mono,
                    fontSize: 10.5,
                    fontWeight: 400,
                    color: "var(--color-faint)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 3,
                    padding: "1px 6px",
                    verticalAlign: "middle",
                  }}
                >
                  {pair.vote === "skip" || pair.vote == null
                    ? "skip / invalid — no vote recorded"
                    : `confidence: ${pair.confidence} · final`}
                </span>
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                A = <span style={{ ...mono, fontSize: 12.5, color: a.color }}>{a.modelId}</span> (
                {a.providerId}) · B ={" "}
                <span style={{ ...mono, fontSize: 12.5, color: b.color }}>{b.modelId}</span> (
                {b.providerId}).{" "}
                {pair.orderSwapped
                  ? "Presentation order was swapped for this pair. "
                  : "Presentation order was not swapped for this pair. "}
                {judgeComparable ? (
                  judge.reversed && judge.verdictAB && judge.verdictBA ? (
                    <>
                      The LLM judge picked {judge.verdictAB} in order A/B but{" "}
                      <strong style={{ color: "var(--color-amber)" }}>
                        reversed to {judge.verdictBA} after the swap
                      </strong>{" "}
                      — this pair is flagged ⟲ and{" "}
                      {judge.excludedFromTally ? "excluded from" : "kept in"} the judge tally.
                    </>
                  ) : (
                    <>
                      The LLM judge kept the same verdict in both presentation orders
                      {judge.verdictAB != null && pair.vote != null && pair.vote !== "skip" ? (
                        pair.vote === judge.verdictAB ? (
                          <>
                            {" "}
                            — <span style={{ color: "var(--color-teal)" }}>it matches your vote</span>.
                          </>
                        ) : (
                          <>
                            {" "}
                            — it picked{" "}
                            <span style={{ color: "var(--color-amber)" }}>
                              {judge.verdictAB === "tie" ? "a tie" : judge.verdictAB}
                            </span>
                            , differing from your vote.
                          </>
                        )
                      ) : (
                        <>.</>
                      )}
                    </>
                  )
                ) : (
                  <>No judge scorer in this run — your blind vote stands alone.</>
                )}
              </p>
              {judge?.commentary && (
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-muted)" }}>
                  Judge note: &ldquo;{judge.commentary}&rdquo;
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                  fontSize: 12,
                  flexWrap: "wrap",
                }}
              >
                <Link
                  href={`/runs/${runId}/results`}
                  className="hover-amber"
                  style={{ color: "var(--color-amber)", fontWeight: 600 }}
                >
                  See aggregate matrix →
                </Link>
                <Link
                  href={`/runs/${runId}/artifacts`}
                  className="hover-text"
                  style={{ color: "var(--color-muted)" }}
                >
                  Inspect artifacts
                </Link>
                <button
                  type="button"
                  onClick={nextPair}
                  className="hover-amber-border"
                  style={{
                    marginLeft: "auto",
                    background: "var(--color-raised)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                    borderRadius: 7,
                    padding: "7px 16px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {queue.currentIndex != null ? "Next pair →" : "Finish → session summary"}
                </button>
              </div>
            </div>
          </Callout>
        </div>
      )}

      <HistoryPanel rows={historyRows(queue)} runId={runId} />
    </>
  );
}
