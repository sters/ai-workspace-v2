import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/process-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { WORKSPACE_DIR, resolveWorkspaceName } from "@/lib/config";
import { buildUpdaterPrompt } from "@/lib/templates";
import { updateTodoSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import path from "node:path";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(updateTodoSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const { instruction } = parsed.data;
  const workspacePath = path.join(WORKSPACE_DIR, workspace);

  const readmeFile = Bun.file(path.join(workspacePath, "README.md"));
  const readmeContent = (await readmeFile.exists())
    ? await readmeFile.text()
    : "";

  const repos = listWorkspaceRepos(workspace);

  const prompts = await Promise.all(repos.map(async (repo) => {
    const todoFile = Bun.file(path.join(workspacePath, `TODO-${repo.repoName}.md`));
    const todoContent = (await todoFile.exists())
      ? await todoFile.text()
      : "";

    return buildUpdaterPrompt({
      workspaceName: workspace,
      repoName: repo.repoName,
      readmeContent,
      todoContent,
      worktreePath: repo.worktreePath,
      workspacePath,
      instruction,
    });
  }));

  const prompt =
    prompts.length === 1
      ? prompts[0]
      : prompts
          .map((p, i) => `# Repo ${i + 1} of ${prompts.length}\n\n${p}`)
          .join("\n\n---\n\n");

  try {
    const operation = startOperationPipeline("update-todo", workspace, [
      { kind: "single", label: "Update TODOs", prompt },
    ]);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
