import z from "zod";

/** Interaction level enum — shared between client and server. */
export const interactionLevelEnum = z.enum(["low", "mid", "high"]);

export const initSchema = z.object({
  description: z.string().min(1, "description is required"),
  interactionLevel: interactionLevelEnum.optional(),
  bestOfN: z.coerce.number().min(0).max(5).optional(),
});

export const workspaceSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
});

export const executeSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  repository: z.string().optional(),
  interactionLevel: interactionLevelEnum.optional(),
  bestOfN: z.coerce.number().min(0).max(5).optional(),
});

export const reviewSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  repository: z.string().optional(),
  interactionLevel: interactionLevelEnum.optional(),
  bestOfN: z.coerce.number().min(0).max(5).optional(),
});

export const createPrSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  draft: z.coerce.boolean().optional(),
  repository: z.string().optional(),
  interactionLevel: interactionLevelEnum.optional(),
  bestOfN: z.coerce.number().min(0).max(5).optional(),
});

export const updateTodoSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  instruction: z.string().min(1, "instruction is required"),
  repo: z.string().optional(),
  interactionLevel: interactionLevelEnum.optional(),
  bestOfN: z.coerce.number().min(0).max(5).optional(),
});

export const createTodoSchema = z.object({
  workspace: z.string().min(1, "workspace is required"),
  reviewTimestamp: z.string().min(1, "reviewTimestamp is required"),
  instruction: z.string().optional(),
  interactionLevel: interactionLevelEnum.optional(),
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
  interactionLevel: interactionLevelEnum.optional(),
  repo: z.string().optional(),
  bestOfN: z.coerce.number().min(0).max(5).optional(),
  bestOfNPhases: z.array(z.enum(["execute", "review", "create-pr", "update-todo"])).optional(),
});

export const autonomousSchema = z.object({
  startWith: z.enum(["init", "update-todo", "execute"]),
  description: z.string().optional(),
  workspace: z.string().optional(),
  instruction: z.string().optional(),
  draft: z.coerce.boolean().optional(),
  interactionLevel: interactionLevelEnum.optional(),
  repo: z.string().optional(),
  maxLoops: z.coerce.number().min(1).max(5).optional(),
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
    error: "transport must be one of: stdio, sse, http",
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
    error: "Invalid scope. Must be one of: project, local, user",
  }),
  content: z.string().min(1, "content is required"),
});

export const addPermissionSchema = z.object({
  permission: z.string().min(1, "permission is required"),
});

export const suggestionDismissSchema = z.object({
  id: z.string().min(1, "id is required"),
});

export const suggestionPruneSchema = z.object({
  days: z.coerce.number().positive().optional(),
});

export const suggestionAcceptSchema = z.object({
  id: z.string().min(1, "id is required"),
});

export const aiwSettingsSchema = z.object({
  content: z.string({
    error: "content is required",
  }),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});
