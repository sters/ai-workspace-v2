import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/process-manager";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import {
  listWorkspaceRepos,
  detectBaseBranch,
  getRepoChanges,
  checkExistingPR,
  readPRTemplate,
} from "@/lib/workspace";
import { buildPRCreatorPrompt } from "@/lib/templates";
import { createPrSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(createPrSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const draft = parsed.data.draft;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const repos = listWorkspaceRepos(workspace);

  if (repos.length === 0) {
    return NextResponse.json(
      { error: "No repositories found in workspace" },
      { status: 400 }
    );
  }

  const children = repos.map((repo) => {
    // Detect base branch from README metadata or repo itself
    const metaRepo = meta.repositories.find(
      (r) => r.path === repo.repoPath || r.alias === repo.repoName,
    );
    const baseBranch = metaRepo?.baseBranch ?? detectBaseBranch(repo.worktreePath);

    const changes = getRepoChanges(workspace, repo.repoPath, baseBranch);
    const existingPR = checkExistingPR(repo.worktreePath);
    const prTemplate = readPRTemplate(repo.worktreePath);

    const prompt = buildPRCreatorPrompt({
      workspaceName: workspace,
      repoPath: repo.repoPath,
      repoName: repo.repoName,
      baseBranch,
      worktreePath: repo.worktreePath,
      readmeContent,
      repoChanges: `Branch: ${changes.currentBranch}\n\nChanged files:\n${changes.changedFiles}\n\nDiff stat:\n${changes.diffStat}\n\nCommit log:\n${changes.commitLog}`,
      draft: draft !== false,
      prTemplate: prTemplate ?? undefined,
      existingPR: existingPR.exists
        ? { url: existingPR.url!, title: existingPR.title!, body: existingPR.body! }
        : undefined,
    });

    return {
      label: repo.repoName,
      prompt,
    };
  });

  try {
    const operation = startOperationPipeline("create-pr", workspace, [
      { kind: "group", children },
    ]);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
