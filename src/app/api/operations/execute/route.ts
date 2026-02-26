import { NextResponse } from "next/server";
import path from "node:path";
import { WORKSPACE_DIR, resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/process-manager";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { listWorkspaceRepos, writeReportTemplates } from "@/lib/workspace";
import { buildExecutorPrompt, buildResearcherPrompt } from "@/lib/templates";
import { executeSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(executeSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const repos = listWorkspaceRepos(workspace);
  const wsPath = path.join(WORKSPACE_DIR, workspace);

  if (repos.length === 0) {
    return NextResponse.json(
      { error: "No repositories found in workspace" },
      { status: 400 }
    );
  }

  const isResearch =
    meta.taskType === "research" || meta.taskType === "investigation";

  try {
    if (isResearch) {
      // Write report templates (idempotent — ensures templates exist for older workspaces)
      await writeReportTemplates(wsPath);

      const reportPath = path.join(wsPath, "artifacts", "research-report.md");
      const prompt = buildResearcherPrompt({
        workspaceName: workspace,
        readmeContent,
        repos: repos.map((r) => ({
          repoPath: r.repoPath,
          repoName: r.repoName,
          worktreePath: r.worktreePath,
        })),
        workspacePath: wsPath,
        reportPath,
      });

      const operation = startOperationPipeline("execute", workspace, [
        { kind: "single", label: "Research", prompt },
      ]);
      return NextResponse.json(operation);
    }

    // Feature/bugfix: launch one executor per repository
    const children = await Promise.all(repos.map(async (repo) => {
      const todoFileName = `TODO-${repo.repoName}.md`;
      const todoFile = Bun.file(path.join(wsPath, todoFileName));
      const todoContent = (await todoFile.exists())
        ? await todoFile.text()
        : "";

      const prompt = buildExecutorPrompt({
        workspaceName: workspace,
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        readmeContent,
        todoContent,
        worktreePath: repo.worktreePath,
      });

      return {
        label: repo.repoName,
        prompt,
      };
    }));

    const operation = startOperationPipeline("execute", workspace, [
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
