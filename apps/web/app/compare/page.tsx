import { TopBar } from "@/components/shell/TopBar";
import { HeadToHeadClient, type H2HSide } from "@/components/compare/HeadToHeadClient";
import { HistoryPanel, type HistoryRow } from "@/components/compare/HistoryPanel";
import { fixtures, getEndpoint, modelColor, modelIdOf, shortNameOf } from "@/lib/data";

export default function HeadToHeadPage() {
  const { pairwiseSession: session, judgePairs, artifacts } = fixtures;

  const current = session.votes.find((v) => v.pairIndex === session.currentPairIndex);
  if (!current) throw new Error(`No pairwise vote entry for pair ${session.currentPairIndex}`);
  const judgePair = judgePairs.find((p) => p.pairIndex === session.currentPairIndex);
  if (!judgePair) throw new Error(`No judge result for pair ${session.currentPairIndex}`);

  const votesCast = session.votes.filter((v) => v.final).length;
  const [aEndpointId, bEndpointId] = current.pairing;

  const side = (slot: "A" | "B", endpointId: string): H2HSide => {
    const artifact = artifacts.find((art) => art.endpointId === endpointId);
    return {
      slot,
      endpointId,
      modelId: modelIdOf(endpointId),
      providerId: getEndpoint(endpointId).providerId,
      color: modelColor(endpointId),
      artifactMeta: artifact
        ? `${artifact.filename} · ${artifact.sizeKb}kb${artifact.renderOk ? "" : " · render fail"}`
        : null,
    };
  };

  const voteByPair = new Map(session.votes.map((v) => [v.pairIndex, v] as const));
  const rows: HistoryRow[] = judgePairs.map((p) => {
    const userVote = voteByPair.get(p.pairIndex);
    const base = {
      pairIndex: p.pairIndex,
      index: `${p.pairIndex}/${current.pairTotal}`,
      pairing: `${shortNameOf(p.pairing[0])} vs ${shortNameOf(p.pairing[1])}`,
    };
    if (p.reversed) {
      return { ...base, result: "REVERSED on swap ⟲", resultColor: "var(--color-amber)", order: "flagged" };
    }
    if (!userVote?.final) {
      return { ...base, result: "pending your vote", resultColor: "var(--color-faint)", order: "—" };
    }
    if (p.verdictAB == null || p.verdictBA == null) {
      return { ...base, result: "judge verdict pending", resultColor: "var(--color-faint)", order: "—" };
    }
    const label = p.verdictAB === "tie" ? "Tie" : `${p.verdictAB} wins`;
    return {
      ...base,
      result: `${label} · both orders`,
      resultColor: "var(--color-teal)",
      order: "A/B + B/A",
    };
  });

  return (
    <>
      <TopBar title="Head-to-Head — blind comparison" />
      <main
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxWidth: 1300,
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        <HeadToHeadClient
          runId={current.runId}
          criterion={session.criterion}
          pairIndex={current.pairIndex}
          pairTotal={current.pairTotal}
          orderSwapped={current.orderSwapped}
          votesCast={votesCast}
          judgeAgreement={session.judgeAgreement}
          judgeConflictWarning={session.judgeConflictWarning}
          initialConfidence={current.confidence}
          sides={[side("A", aEndpointId), side("B", bEndpointId)]}
          judge={{
            verdictAB: judgePair.verdictAB,
            verdictBA: judgePair.verdictBA,
            reversed: judgePair.reversed,
            excludedFromTally: judgePair.excludedFromTally,
            commentary: judgePair.commentary,
          }}
        />
        <HistoryPanel rows={rows} runId={current.runId} />
      </main>
    </>
  );
}
