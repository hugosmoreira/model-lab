import { NextRequest } from "next/server";
import { liveEvents, completionEvents } from "@model-lab/schemas/fixtures";
import type { RunEvent } from "@model-lab/schemas";
import { subscribeRun } from "@/lib/server/run-service";

export const dynamic = "force-dynamic";

/**
 * Live-run event stream (SSE).
 *
 * Phase 2 routing:
 *  - ACTIVE runs (started by POST /api/runs in this process) stream the native
 *    Build Arena runner's events: buffered-from-start, then live, terminal
 *    "event: done" after run.completed / run.partial / run.cancelled.
 *  - Stored real runs replay their persisted event log, then "event: done".
 *  - run_8f3ac21e (the demo) and unknown run ids keep the Phase 1 fixture
 *    replay on a compressed clock, so deep links and the demo screen still
 *    exercise the full streaming path without a runner.
 *
 * Wire contract (unchanged from Phase 1): one "data: <RunEvent JSON>\n\n"
 * frame per event; ": keep-alive" comment frames may appear between events;
 * terminal frame "event: done\ndata: {}\n\n".
 */

const DEMO_RUN_ID = "run_8f3ac21e";
const HEARTBEAT_MS = 15_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  /* The demo run intentionally keeps the paced fixture replay even though it
     exists in the store — replaying its stored log would flash 43 events at
     once instead of simulating a live run. */
  const source = runId === DEMO_RUN_ID ? null : await subscribeRun(runId);
  if (source !== null) return streamEvents(req, source);
  return fixtureReplay(req, runId);
}

/** Streams a run-service subscription (active: buffered + live; stored: replay). */
function streamEvents(req: NextRequest, source: AsyncIterable<RunEvent>): Response {
  const encoder = new TextEncoder();
  const iterator = source[Symbol.asyncIterator]();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      /* Comment frames keep proxies from idling out long-running live runs;
         EventSource ignores them. */
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        close();
        void iterator.return?.(); // release the feed subscription
      });

      try {
        for (;;) {
          const next = await iterator.next();
          if (closed) {
            void iterator.return?.();
            return;
          }
          if (next.done === true) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
        }
        if (!closed) {
          controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        }
      } catch {
        /* feed failed — close without the done frame; client shows "error" */
      }
      close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

/**
 * Phase 1 fixture replay — kept verbatim for the demo run and unknown ids:
 * replays the fixture event script on a compressed clock so the Live Run
 * screen exercises the full streaming path without a real runner.
 */
function fixtureReplay(req: NextRequest, runId: string): Response {
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

  return new Response(stream, { headers: SSE_HEADERS });
}
