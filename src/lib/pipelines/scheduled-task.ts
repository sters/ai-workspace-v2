/**
 * `plan-scheduled-task` turns a person's request into a disabled scheduled
 * task for them to review; `scheduled-task` is one run of an enabled task,
 * started by the scheduler (`scheduled-tasks/scheduler.ts`) or Run now.
 */

import { getResolvedWorkspaceRoot } from "@/lib/config";
import { insertScheduledTask } from "@/lib/db/scheduled-tasks";
import { scheduledTaskInputSchema } from "@/lib/schemas";
import {
  buildScheduledTaskPlanPrompt,
  buildScheduledTaskRunPrompt,
  SCHEDULED_TASK_ALLOWED_TOOLS,
  SCHEDULED_TASK_PLAN_SCHEMA,
  SCHEDULED_TASK_RUN_SCHEMA,
} from "@/lib/templates/prompts/scheduled-task";
import { sendScheduledTaskNotification } from "@/lib/web-push/push";
import { ensureGlobalSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES, type PipelinePhase } from "@/types/pipeline";
import type { ScheduledTask, ScheduledTaskInput } from "@/types/scheduled-task";

/** What planning operations are filed under in place of a workspace. */
export const SCHEDULED_TASKS_LABEL = "scheduled-tasks";

/** What one task's runs are filed under in place of a workspace, so its history is one listing. */
export function scheduledTaskLabel(taskId: number): string {
  return `scheduled-task-${taskId}`;
}

export function parseScheduledTaskPlan(raw: string, request: string): ScheduledTaskInput | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "The planner's answer was not JSON." };
  }
  const result = scheduledTaskInputSchema.safeParse({ ...(parsed as object), request, kind: "prompt", enabled: false });
  if (!result.success) return { error: result.error.issues.map((i) => i.message).join("; ") };
  return result.data;
}

export function buildPlanScheduledTaskPipeline(request: string): PipelinePhase[] {
  return [
    {
      kind: "function",
      label: "Plan scheduled task",
      timeoutMs: 15 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        let raw = "";
        const ok = await ctx.runChild("plan-scheduled-task", buildScheduledTaskPlanPrompt(request), {
          cwd: getResolvedWorkspaceRoot(),
          aiwMcp: true,
          allowedTools: SCHEDULED_TASK_ALLOWED_TOOLS,
          jsonSchema: SCHEDULED_TASK_PLAN_SCHEMA as unknown as Record<string, unknown>,
          skipAskUserQuestion: true,
          stepType: STEP_TYPES.PLAN_SCHEDULED_TASK,
          appendSystemPromptFile: await ensureGlobalSystemPrompt("scheduled-task-planner"),
          onResultText: (text) => {
            raw = text;
          },
        });
        if (!ok) return false;

        const plan = parseScheduledTaskPlan(raw, request);
        if ("error" in plan) {
          ctx.emitResult(`Could not plan the task: ${plan.error}`);
          return false;
        }
        const task = insertScheduledTask(plan);
        ctx.emitResult(
          `Planned **${task.title}** (\`${task.cron}\`, overlap: ${task.overlap}). It is disabled until you review and enable it in Scheduled Jobs.`,
        );
        return true;
      },
    },
  ];
}

export function buildScheduledTaskPipeline(task: ScheduledTask): PipelinePhase[] {
  return [
    {
      kind: "function",
      label: task.title,
      timeoutMs: 30 * 60 * 1000,
      // A retry would repeat operations the first attempt already started.
      maxRetries: 0,
      fn: async (ctx) => {
        let raw = "";
        const ok = await ctx.runChild("scheduled-task", buildScheduledTaskRunPrompt(task, task.lastRunAt), {
          cwd: getResolvedWorkspaceRoot(),
          aiwMcp: true,
          allowedTools: SCHEDULED_TASK_ALLOWED_TOOLS,
          jsonSchema: SCHEDULED_TASK_RUN_SCHEMA as unknown as Record<string, unknown>,
          skipAskUserQuestion: true,
          stepType: STEP_TYPES.RUN_SCHEDULED_TASK,
          appendSystemPromptFile: await ensureGlobalSystemPrompt("scheduled-task-runner"),
          onResultText: (text) => {
            raw = text;
          },
        });
        if (!ok) return false;

        let summary = raw.trim();
        let details = "";
        try {
          const parsed = JSON.parse(raw) as { summary?: unknown; details?: unknown };
          if (typeof parsed.summary === "string") summary = parsed.summary.trim();
          if (typeof parsed.details === "string") details = parsed.details.trim();
        } catch {
          // An unstructured answer is still the run's report; keep it as the summary.
        }
        ctx.emitResult(details ? `${summary}\n\n${details}` : summary);
        sendScheduledTaskNotification(task.id, task.title, summary);
        return true;
      },
    },
  ];
}
