import z from "zod";

export const initSchema = z.object({
  description: z.string().min(1, "description is required"),
});

export const workspaceSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
});

export const executeSchema = workspaceSchema;

export const reviewSchema = workspaceSchema;

export const createPrSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  draft: z.coerce.boolean().optional(),
});

export const updateTodoSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  instruction: z.string().min(1, "instruction is required"),
});

export const createTodoSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  reviewTimestamp: z.string().min(1, "reviewTimestamp is required"),
});

export const deleteSchema = workspaceSchema;

export const workspacePruneSchema = z.object({
  days: z.coerce.number().positive().optional(),
});

export const operationKillSchema = z.object({
  operationId: z.string().min(1, "operationId is required"),
});

export const operationClearSchema = z.object({
  operationId: z.string().min(1, "operationId is required"),
});

export const operationAnswerSchema = z.object({
  operationId: z.string().min(1, "operationId is required"),
  toolUseId: z.string().min(1, "toolUseId is required"),
  answers: z.record(z.string(), z.string()),
});

export const mcpAuthSchema = z.object({
  serverName: z.string().min(1, "serverName is required"),
  forceReauth: z.union([z.boolean(), z.string()]).optional(),
});
