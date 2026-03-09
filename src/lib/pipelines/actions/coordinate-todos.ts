import path from "node:path";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { buildCoordinatorPrompt } from "@/lib/templates";
import type { PipelinePhaseFunction } from "@/types/pipeline";

export function buildCoordinateTodosPhase(input: {
  workspace: string;
  wsPath: string;
  repoNames: string[];
}): PipelinePhaseFunction {
  return {
    kind: "function",
    label: "Coordinate TODOs",
    fn: async (ctx) => {
      const { content: readmeContent } = await readWorkspaceReadme(input.wsPath);

      if (input.repoNames.length <= 1) {
        ctx.emitResult("Skipped coordination (single repo).");
        return true;
      }

      const todoFiles: { repoName: string; content: string }[] = [];
      for (const repoName of input.repoNames) {
        const todoFile = Bun.file(path.join(input.wsPath, `TODO-${repoName}.md`));
        if (await todoFile.exists()) {
          todoFiles.push({
            repoName,
            content: await todoFile.text(),
          });
        }
      }

      if (todoFiles.length === 0) {
        ctx.emitResult("No TODO files found, skipping coordination.");
        return true;
      }

      const prompt = buildCoordinatorPrompt({
        workspaceName: input.workspace,
        readmeContent,
        todoFiles,
        workspacePath: input.wsPath,
      });

      ctx.emitStatus("Coordinating TODOs across repositories");
      return ctx.runChild("Coordinate TODOs", prompt, { addDirs: [input.wsPath] });
    },
  };
}
