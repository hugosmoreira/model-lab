import { NextRequest } from "next/server";
import type { RunEvent } from "@model-lab/schemas";
import { subscribeRun } from "@/lib/server/run-service";

export const dynamic = "force-dynamic";
const HEARTBEAT_MS = 15_000;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/** Active runs stream live; completed runs replay only their recorded events. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const source = await subscribeRun(runId);
    if (source === null) return Response.json({ error: "Run not found." }, { status: 404 });
    return streamEvents(req, source);
  } catch {
    return Response.json({ error: "Run events are temporarily unavailable." }, { status: 503 });
  }
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
