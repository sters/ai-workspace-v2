import { startOperationPipeline } from "@/lib/pipeline-manager";
import { buildScheduledTaskPipeline, scheduledTaskLabel } from "@/lib/pipelines/scheduled-task";
import type { Operation } from "@/types/operation";
import type { ScheduledTask } from "@/types/scheduled-task";

export function startScheduledTaskRun(task: ScheduledTask): Operation {
  return startOperationPipeline("scheduled-task", scheduledTaskLabel(task.id), buildScheduledTaskPipeline(task));
}
