import { NextRequest } from "next/server";
import { liveEvents, completionEvents } from "@model-lab/schemas/fixtures";
import type { RunEvent } from "@model-lab/schemas";

export const dynamic = "force-dynamic";

/**
 * Live-run event stream (SSE).
 *
 * Phase 1: replays the fixture event script on a compressed clock so the Live
 * Run screen exercises the full streaming path (progress, partial failure,
 * completion) without a real runner. Phase 2 swaps the source from fixtures
 * to the Build Arena runner's event bus — the wire contract stays identical.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const script: RunEvent[] = [...liveEvents, ...completionEvents].map((e) => ({
    ...e,
    runId,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let closed = false;
      req.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      // Compressed replay clock: ~1.2s between events (demo pacing).
      for (const event of script) {
        if (closed) return;
        send(event);
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (!closed) {
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
