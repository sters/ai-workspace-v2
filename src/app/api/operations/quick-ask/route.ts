import path from "node:path";
import { WORKSPACE_DIR } from "@/lib/config";
import { runClaude } from "@/lib/claude";
import { quickAskSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { buildQuickAskPrompt } from "@/lib/templates/prompts/quick-ask";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(quickAskSchema, body);
  if (!parsed.success) return parsed.response;

  const { workspace, question } = parsed.data;
  const workspacePath = path.join(WORKSPACE_DIR, workspace);
  const prompt = buildQuickAskPrompt(workspace, workspacePath, question);

  const proc = runClaude("quick-ask", prompt, { cwd: workspacePath });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) =>
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));

      proc.onEvent((event) => {
        send(JSON.stringify(event));
        if (event.type === "complete") controller.close();
      });
    },
    cancel() {
      proc.kill();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
