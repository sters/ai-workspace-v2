/**
 * `harvest-lessons` — distill one workspace's outcome into candidate lessons
 * for each of its repositories. Started on archive, or by hand. It never
 * changes a worktree and never approves anything: candidates wait in
 * Utilities → Repo Lessons.
 */

import { applyDistilledLessons, listLessons, recordLessonFindings } from "@/lib/db/repo-lessons";
import { LESSON_SECTION_CAP, lessonRepoKey } from "@/lib/lessons";
import { gatherLessonMaterial, hasLessonSignal, type LessonMaterial } from "@/lib/lessons/material";
import { buildLessonDistillerPrompt, LESSON_DISTILLATION_SCHEMA } from "@/lib/templates/prompts/lesson-distiller";
import { getReadme } from "@/lib/workspace/reader";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { runtimeDistilledLessonsSchema } from "@/lib/runtime-schemas";
import { STEP_TYPES, type GroupChild, type PipelinePhase } from "@/types/pipeline";
import type { LessonSection } from "@/types/repo-lessons";

const README_EXCERPT_CHARS = 3000;

export function buildHarvestLessonsPipeline(workspace: string): PipelinePhase[] {
  return [
    {
      kind: "function",
      label: "Distill lessons",
      timeoutMs: 30 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        const repos = await listWorkspaceRepos(workspace);
        if (repos.length === 0) {
          ctx.emitResult("No repositories in this workspace.");
          return true;
        }
        const readme = ((await getReadme(workspace)) ?? "").slice(0, README_EXCERPT_CHARS);

        const materials: LessonMaterial[] = [];
        for (const repo of repos) {
          ctx.emitStatus(`[${repo.repoName}] Gathering PR, commits and findings...`);
          const material = await gatherLessonMaterial(workspace, repo, await lessonRepoKey(repo));
          recordLessonFindings(material.repoKey, workspace, material.findings);
          if (hasLessonSignal(material)) materials.push(material);
        }
        if (materials.length === 0) {
          ctx.emitResult("Nothing to learn from: no review comments, follow-up commits, rejected PR or findings.");
          return true;
        }

        const lines: string[] = [];
        const children: GroupChild[] = materials.map((material) => {
          const lessons = listLessons({ repoKey: material.repoKey });
          const approved = lessons.filter((l) => l.status === "approved");
          const fullSections = (["implementation", "review"] as LessonSection[]).filter(
            (s) => approved.filter((l) => l.section === s).length >= LESSON_SECTION_CAP,
          );
          return {
            label: material.repoName,
            stepType: STEP_TYPES.DISTILL_LESSONS,
            skipAskUserQuestion: true,
            allowedTools: ["Read"],
            jsonSchema: LESSON_DISTILLATION_SCHEMA as unknown as Record<string, unknown>,
            prompt: buildLessonDistillerPrompt({
              workspaceName: workspace,
              readmeExcerpt: readme,
              material,
              approved,
              candidates: lessons.filter((l) => l.status === "candidate"),
              rejected: lessons.filter((l) => l.status === "rejected"),
              fullSections,
            }),
            onResultText: (text) => {
              let parsed;
              try {
                parsed = runtimeDistilledLessonsSchema.safeParse(JSON.parse(text));
              } catch {
                parsed = null;
              }
              if (!parsed?.success) {
                lines.push(`[${material.repoName}] unreadable output; nothing applied`);
                return;
              }
              const r = applyDistilledLessons(material.repoKey, workspace, parsed.data.lessons);
              lines.push(`[${material.repoName}] ${r.added} new candidate(s), ${r.reinforced} reinforced, ${r.dropped} dropped`);
            },
          };
        });

        ctx.emitStatus(`Distilling ${children.length} repositor${children.length === 1 ? "y" : "ies"}...`);
        const results = await ctx.runChildGroup(children);
        ctx.emitResult(lines.join("\n") || "No output.");
        return results.every(Boolean);
      },
    },
  ];
}
