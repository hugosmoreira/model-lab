"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { Callout } from "@/components/ui/primitives";

const mono = { fontFamily: "var(--font-mono)" } as const;

export type VoteChoice = "A" | "B" | "tie" | "skip";
export type Confidence = "low" | "med" | "high";

export interface H2HSide {
  slot: "A" | "B";
  endpointId: string;
  modelId: string;
  providerId: string;
  /** Model identity hex — applied only after reveal (blind protocol). */
  color: string;
  /** e.g. "raycaster.html · 41kb" — shown only after reveal. */
  artifactMeta: string | null;
}

export interface H2HJudge {
  verdictAB: "A" | "B" | "tie" | null;
  verdictBA: "A" | "B" | "tie" | null;
  reversed: boolean;
  excludedFromTally: boolean;
  commentary: string | null;
}

export interface HeadToHeadProps {
  runId: string;
  criterion: string;
  pairIndex: number;
  pairTotal: number;
  orderSwapped: boolean;
  /** Finalized votes so far (session.votes with final=true). */
  votesCast: number;
  judgeAgreement: string;
  judgeConflictWarning: string | null;
  initialConfidence: Confidence;
  sides: [H2HSide, H2HSide];
  judge: H2HJudge;
}

const LOCK_TITLE = "votes are final after reveal — blind protocol";

const VOTE_LABELS: Record<VoteChoice, string> = {
  A: "A wins",
  B: "B wins",
  tie: "Tie",
  skip: "skipped",
};

/**
 * Blind-safe placeholder preview art (colors verbatim from the design audit).
 * Deliberately neutral scene hues — must NOT leak model identity pre-reveal.
 * Phase 2 replaces the 250px body with a sandboxed <iframe> per artifact.
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

export function HeadToHeadClient({
  runId,
  criterion,
  pairIndex,
  pairTotal,
  orderSwapped,
  votesCast,
  judgeAgreement,
  judgeConflictWarning,
  initialConfidence,
  sides,
  judge,
}: HeadToHeadProps) {
  const [vote, setVote] = useState<VoteChoice | null>(null);
  const [conf, setConf] = useState<Confidence>(initialConfidence);

  const locked = vote !== null;
  // A skip records no vote, so it does not advance the vote count; the flagged
  // pair is excluded from the judge tally, so the agreement denominator holds.
  const liveVoteCount = votesCast + (vote !== null && vote !== "skip" ? 1 : 0);
  const [a, b] = sides;

  const cast = (choice: VoteChoice) => {
    if (!locked) setVote(choice);
  };

  const voteButton = (choice: "A" | "B" | "tie", label: string, padding: string) => {
    const selected = vote === choice;
    return (
      <button
        type="button"
        onClick={() => cast(choice)}
        disabled={locked}
        aria-disabled={locked}
        aria-pressed={selected}
        title={locked ? LOCK_TITLE : undefined}
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

  return (
    <>
      {/* Criterion / meta header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          Criterion: <span style={{ color: "var(--color-magenta)" }}>{criterion}</span>
        </span>
        <span style={{ ...mono, fontSize: 11, color: "var(--color-faint)" }}>
          pair {pairIndex} of {pairTotal} · {runId} · order swap:{" "}
          <span style={{ color: orderSwapped ? "var(--color-amber)" : undefined }}>
            {orderSwapped ? "B/A (swapped)" : "A/B (original)"}
          </span>{" "}
          · {locked ? "identities revealed" : "identities hidden"}
        </span>
        <span style={{ marginLeft: "auto", ...mono, fontSize: 11, color: "var(--color-muted)" }}>
          your votes: {liveVoteCount} · agreement with judge: {judgeAgreement}
        </span>
      </div>

      {/* Judge-contamination warning */}
      {judgeConflictWarning && (
        <Callout variant="warning" glyph="⚠">
          {judgeConflictWarning}
        </Callout>
      )}

      {/* 2-up comparison cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 14,
        }}
      >
        {sides.map((side) => {
          const winner = vote === side.slot;
          const art = PREVIEW_ART[side.slot];
          return (
            <section
              key={side.slot}
              aria-label={
                locked
                  ? `Artifact ${side.slot} — ${side.modelId} (${side.providerId})`
                  : `Artifact ${side.slot} — identity hidden`
              }
              style={{
                background: "var(--color-panel)",
                border: `1px solid ${winner ? "var(--color-amber)" : "var(--color-border)"}`,
                borderRadius: 8,
                overflow: "hidden",
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
                    color: locked ? side.color : "var(--color-model-blind)",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {locked
                    ? `${side.modelId} · ${side.providerId}`
                    : `Model ${side.slot} — identity hidden`}
                </span>
                <span
                  style={{ marginLeft: "auto", ...mono, fontSize: 10.5, color: "var(--color-faint)" }}
                >
                  {locked && side.artifactMeta ? side.artifactMeta : "interactive preview"}
                </span>
              </div>
              <div
                role="img"
                aria-label={`Preview placeholder for artifact ${side.slot} — sandboxed artifact render lands in Phase 2`}
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
                {locked && (
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: `linear-gradient(${side.color}1f, transparent 45%)`,
                    }}
                  />
                )}
              </div>
            </section>
          );
        })}
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
          onClick={() => cast("skip")}
          disabled={locked}
          aria-disabled={locked}
          aria-pressed={vote === "skip"}
          title={locked ? LOCK_TITLE : "record this pair as skipped / invalid"}
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
            const selected = conf === c;
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
                title={locked ? LOCK_TITLE : undefined}
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

      {/* Reveal panel — appears once the vote (or skip) is locked in */}
      {locked && (
        <div role="status">
          <Callout
            variant="insight"
            style={{ padding: "14px 18px", flexDirection: "column", display: "flex" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>
                {vote === "skip" ? (
                  <>
                    Revealed — pair recorded as{" "}
                    <span style={{ color: "var(--color-amber)" }}>skipped</span>
                  </>
                ) : (
                  <>
                    Revealed — you voted{" "}
                    <span style={{ color: "var(--color-amber)" }}>
                      {vote ? VOTE_LABELS[vote] : ""}
                    </span>
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
                  {vote === "skip" ? "skip / invalid — no vote recorded" : `confidence: ${conf}`}
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
                {orderSwapped
                  ? "Presentation order was swapped for this pair. "
                  : "Presentation order was not swapped for this pair. "}
                {judge.reversed && judge.verdictAB && judge.verdictBA ? (
                  <>
                    The LLM judge picked {judge.verdictAB} in order A/B but{" "}
                    <strong style={{ color: "var(--color-amber)" }}>
                      reversed to {judge.verdictBA} after the swap
                    </strong>{" "}
                    — this pair is flagged ⟲ and{" "}
                    {judge.excludedFromTally ? "excluded from" : "kept in"} the judge tally.
                  </>
                ) : (
                  <>The LLM judge kept the same verdict in both presentation orders.</>
                )}
              </p>
              {judge.commentary && (
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
                  disabled
                  aria-disabled={true}
                  title="pair queue lands in Phase 6"
                  style={{
                    marginLeft: "auto",
                    background: "var(--color-raised)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-disabled)",
                    borderRadius: 7,
                    padding: "7px 16px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "not-allowed",
                  }}
                >
                  Next pair →
                </button>
              </div>
            </div>
          </Callout>
        </div>
      )}
    </>
  );
}
