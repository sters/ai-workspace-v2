import path from "node:path";
import { getResolvedWorkspaceRoot, getWorkspaceDir, resolveWorkspaceName } from "@/lib/config";
import { runClaude } from "@/lib/claude";
import { quickAskSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { buildQuickAskPrompt } from "@/lib/templates/prompts/quick-ask";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(quickAskSchema, body);
  if (!parsed.success) return parsed.response;

  const { question } = parsed.data;
  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const workspacePath = path.join(getWorkspaceDir(), workspace);
  const prompt = buildQuickAskPrompt(workspace, workspacePath, question);

  const proc = runClaude("quick-ask", prompt, { cwd: getResolvedWorkspaceRoot(), appendSystemPromptFile: ensureSystemPrompt(workspacePath, "quick-ask") });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // stream already closed
        }
      };

      proc.onEvent((event) => {
        send(JSON.stringify(event));
        if (event.type === "complete") {
          try { controller.close(); } catch { /* already closed */ }
        }
      });

      request.signal.addEventListener("abort", () => {
        proc.kill();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      proc.kill();
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
