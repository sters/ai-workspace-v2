import z from "zod";
import { getConfig } from "./app-config";

export const interactionLevelSchema = z.enum(["low", "mid", "high"]).default(getConfig().operations.defaultInteractionLevel);

export const initSchema = z.object({
  description: z.string().min(1, "description is required"),
  interactionLevel: interactionLevelSchema,
});

export const workspaceSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
});

export const executeSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  repository: z.string().optional(),
});

export const reviewSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  repository: z.string().optional(),
});

export const createPrSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  draft: z.coerce.boolean().optional(),
  repository: z.string().optional(),
});

export const updateTodoSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  instruction: z.string().min(1, "instruction is required"),
  repo: z.string().optional(),
  interactionLevel: interactionLevelSchema,
});

export const createTodoSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  reviewTimestamp: z.string().min(1, "reviewTimestamp is required"),
  instruction: z.string().optional(),
  interactionLevel: interactionLevelSchema,
});

export const deleteSchema = workspaceSchema;

export const workspacePruneSchema = z.object({
  days: z.coerce.number().positive().optional(),
});

export const operationPruneSchema = z.object({
  days: z.coerce.number().positive().optional(),
});

export const operationKillSchema = z.object({
  operationId: z.string().min(1, "operationId is required"),
});

export const operationClearSchema = z.object({
  operationId: z.string().min(1, "operationId is required"),
});

export const batchSchema = z.object({
  mode: z.enum(["execute-review", "execute-pr", "execute-review-pr-gated", "execute-review-pr"]),
  startWith: z.enum(["init", "update-todo", "execute"]),
  description: z.string().optional(),
  workspace: z.string().optional(),
  instruction: z.string().optional(),
  draft: z.coerce.boolean().optional(),
  interactionLevel: interactionLevelSchema,
});

export const operationAnswerSchema = z.object({
  operationId: z.string().min(1, "operationId is required"),
  toolUseId: z.string().min(1, "toolUseId is required"),
  answers: z.record(z.string(), z.string()),
});

export const searchSchema = z.object({
  query: z.string().min(1, "query is required"),
});

export const quickAskSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  question: z.string().min(1, "question is required"),
});

export const mcpAuthSchema = z.object({
  serverName: z.string().min(1, "serverName is required"),
  forceReauth: z.union([z.boolean(), z.string()]).optional(),
});

export const mcpAddSchema = z.object({
  name: z.string().min(1, "name is required"),
  transport: z.enum(["stdio", "sse", "http"], {
    errorMap: () => ({ message: "transport must be one of: stdio, sse, http" }),
  }),
  url: z.string().min(1, "url is required"),
  scope: z.enum(["project", "local"]).optional(),
});

export const mcpRemoveSchema = z.object({
  name: z.string().min(1, "name is required"),
  scope: z.enum(["project", "local", "user"]).optional(),
});

export const chatSessionKillSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
});

export const claudeSettingsWriteSchema = z.object({
  scope: z.enum(["project", "local", "user"], {
    errorMap: () => ({ message: "Invalid scope. Must be one of: project, local, user" }),
  }),
  content: z.string().min(1, "content is required"),
});

export const addPermissionSchema = z.object({
  permission: z.string().min(1, "permission is required"),
});
