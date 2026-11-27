import { verificationActionSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import {
  abortScenario,
  answerStep,
  editSteps,
  rerunFrom,
  skipStep,
  startRun,
} from "@/lib/verification/runner";
import { deleteScenarioFiles, readScenario, SCENARIO_ID } from "@/lib/verification/store";
import { workspacePathFor, workspaceVariablesFor, worktreesFor } from "@/lib/verification/workspace";

type Params = { params: Promise<{ name: string; id: string }> };

async function resolve(params: Params["params"]) {
  const { name, id } = await params;
  const wsPath = workspacePathFor(name);
  if (!wsPath || !SCENARIO_ID.test(id)) return null;
  if (!(await readScenario(wsPath, id))) return null;
  return { name, id, wsPath };
}

export async function POST(request: Request, { params }: Params) {
  const target = await resolve(params);
  if (!target) return Response.json({ error: "Scenario not found" }, { status: 404 });
  const parsed = parseBody(verificationActionSchema, await request.json().catch(() => ({})));
  if (!parsed.success) return parsed.response;
  const { name, id, wsPath } = target;
  const body = parsed.data;

  if (body.action === "abort") {
    await abortScenario(wsPath, id, await worktreesFor(name));
    return Response.json({ ok: true });
  }
  if (body.action === "edit") {
    const outcome = await editSteps(wsPath, id, body.steps);
    return outcome.ok ? Response.json(outcome) : Response.json(outcome, { status: 409 });
  }

  const worktrees = await worktreesFor(name);
  const variables = workspaceVariablesFor(name, worktrees);
  const outcome =
    body.action === "run" ? await startRun(wsPath, id, worktrees, variables)
    : body.action === "answer" ? await answerStep(wsPath, id, worktrees, body, variables)
    : body.action === "rerun" ? await rerunFrom(wsPath, id, worktrees, body.stepId, variables)
    : await skipStep(wsPath, id, worktrees, body.stepId, variables);
  return outcome.ok ? Response.json(outcome) : Response.json(outcome, { status: 409 });
}

export async function DELETE(_request: Request, { params }: Params) {
  const target = await resolve(params);
  if (!target) return Response.json({ error: "Scenario not found" }, { status: 404 });
  await abortScenario(target.wsPath, target.id, await worktreesFor(target.name));
  await deleteScenarioFiles(target.wsPath, target.id);
  return Response.json({ ok: true });
}
