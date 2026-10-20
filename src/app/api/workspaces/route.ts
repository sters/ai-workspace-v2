import { NextRequest, NextResponse } from "next/server";
import { startTaskChatSession } from "@/lib/chat-server/client";
import { startUserReview } from "@/lib/pipelines/review";
import { setupRepositories } from "@/lib/pipelines/actions/setup-repository";
import { quickCreateWorkspaceSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { quickWorkspaceName } from "@/lib/naming";
import {
  beginQuickCreate,
  discardQuickCreate,
  finishQuickCreate,
  reportQuickCreate,
  reportQuickCreateWorkspace,
} from "@/lib/workspace/quick-create-progress";
import {
  createQuickWorkspace,
  QuickCreateRefusal,
  type QuickCreateResult,
} from "@/lib/workspace/quick-create";
import { resolvePrBranch } from "@/lib/workspace/pr-url";
import { cachedRepoConstraints } from "@/lib/workspace/repo-constraints-cache";
import { listWorkspaceItems } from "@/lib/workspace/reader";
import type { QuickCreateStart } from "@/types/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const recentOnly =
      request.nextUrl.searchParams.get("recentOnly") === "true";
    const includeArchived =
      request.nextUrl.searchParams.get("includeArchived") === "true";
    const result = await listWorkspaceItems({ recentOnly, includeArchived });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Started here rather than by the page that asked: it may have been navigated
 * away from by the time the create returns, and what follows must not depend
 * on it still being there.
 *
 * A review workspace whose PR is checked out gets a review operation, which is
 * what posts findings onto the PR; without a PR its worktree is a fresh branch
 * with an empty diff, so it gets a chat like any other. A repository that
 * failed starts nothing, since that is the thing to read first.
 */
async function startAfterCreate(
  result: QuickCreateResult,
  taskType: string,
  note: string | undefined,
): Promise<QuickCreateStart> {
  if (result.problems.length > 0) return { kind: "none" };

  if (taskType === "review" && result.pullRequests.length > 0) {
    try {
      const operation = await startUserReview(result.workspace);
      return { kind: "review", operationId: operation.id };
    } catch (err) {
      return { kind: "failed", what: "review", error: String(err) };
    }
  }

  const task = note?.trim();
  if (!task) return { kind: "none" };
  const chat = await startTaskChatSession(result.workspace, task);
  return chat.ok
    ? { kind: "chat", sessionId: chat.sessionId }
    : { kind: "failed", what: "chat", error: chat.error };
}

/**
 * Create a workspace deterministically — no operation, no model call. It runs
 * to completion in the request because the only slow step is git: a worktree
 * off refs already on disk takes seconds, and a first-time clone is the one
 * case that makes the caller wait (a PR entry adds one `gh pr view`).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(quickCreateWorkspaceSchema, body);
  if (!parsed.success) return parsed.response;
  const input = parsed.data;

  // Tracked only for the web form, the caller that may leave and come back
  // while git runs; a caller that runs what follows itself waits on the request.
  const progressId = input.followUp
    ? beginQuickCreate(
        quickWorkspaceName(input.name, input.note ?? "") || input.repositories.join(", "),
      )
    : null;
  const report = (message: string) => {
    if (progressId) reportQuickCreate(progressId, message);
  };

  try {
    const result = await createQuickWorkspace(input, {
      setupRepositories,
      resolvePullRequest: resolvePrBranch,
      cachedConstraints: cachedRepoConstraints,
      onProgress: report,
      onCreated: (workspace) => {
        if (progressId) reportQuickCreateWorkspace(progressId, workspace);
      },
    });
    let start: QuickCreateStart = { kind: "none" };
    if (input.followUp) {
      report("Starting what follows");
      start = await startAfterCreate(result, input.taskType, input.note);
    }
    if (progressId) {
      finishQuickCreate(progressId, {
        workspace: result.workspace,
        start,
        problems: result.problems.length,
      });
    }
    return NextResponse.json({ ...result, start });
  } catch (err) {
    if (err instanceof QuickCreateRefusal) {
      if (progressId) discardQuickCreate(progressId);
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (progressId) finishQuickCreate(progressId, { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
