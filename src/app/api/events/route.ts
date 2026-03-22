import { NextResponse } from "next/server";
import {
  getOperation,
  getOperationEvents,
  subscribeToOperation,
} from "@/lib/pipeline-manager";
import { readOperationLog } from "@/lib/operation-store";

export const dynamic = "force-dynamic";

/**
 * Resolve events for a completed operation from memory or disk.
 */
function resolveCompletedEvents(operationId: string): OperationEventList | null {
  // Try memory first
  const memEvents = getOperationEvents(operationId);
  if (memEvents.length > 0) return memEvents;

  // Fall back to disk
  const stored = readOperationLog(operationId);
  return stored ? stored.events : null;
}

type OperationEventList = ReturnType<typeof getOperationEvents>;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const operationId = url.searchParams.get("operationId");

  if (!operationId) {
    return NextResponse.json({ error: "operationId is required" }, { status: 400 });
  }

  const operation = getOperation(operationId);

  // ---------- Not in memory → check disk ----------
  if (!operation) {
    const stored = readOperationLog(operationId);
    if (!stored) {
      console.log(`[events][${operationId}] operation not found`);
      return NextResponse.json({ error: "operation not found" }, { status: 404 });
    }

    // Completed on disk → return JSON
    console.log(`[events][${operationId}] serving from disk (JSON), ${stored.events.length} events`);
    return NextResponse.json(stored.events);
  }

  // ---------- Completed in memory → return JSON ----------
  if (operation.status !== "running") {
    const events = resolveCompletedEvents(operationId) ?? [];
    console.log(`[events][${operationId}] completed (JSON), ${events.length} events`);
    return NextResponse.json(events);
  }

  // ---------- Running → SSE stream ----------
  console.log(`[sse][${operationId}] connected, status=running`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(":ok\n\n"));

      // Send existing events
      const existing = getOperationEvents(operationId);
      console.log(`[sse][${operationId}] sending ${existing.length} existing events`);
      for (const event of existing) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      }

      // Subscribe to new events
      const unsubscribe = subscribeToOperation(operationId, (event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
          if (event.type === "complete" && !event.childLabel) {
            console.log(`[sse][${operationId}] complete`);
            unsubscribe();
            controller.close();
          }
        } catch (err) {
          console.warn("[sse] enqueue failed:", err);
          unsubscribe();
        }
      });

      request.signal.addEventListener("abort", () => {
        console.log(`[sse][${operationId}] client disconnected`);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
