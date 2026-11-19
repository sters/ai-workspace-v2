import z from "zod";
import type { McpTool } from "@/lib/mcp/protocol";
import type { OperationEvent, OperationListItem } from "@/types/operation";
import { getWorkspaceDir, resolveWorkspaceName } from "@/lib/config";
import { unarchiveWorkspace } from "@/lib/db/archives";
import { archiveWorkspaceWithPrs, OpenPullRequestsError } from "@/lib/workspace/archive";
import { getOperation, getOperationEvents, getOperationSummaries } from "@/lib/pipeline-manager";
import { readOperationLog } from "@/lib/operation-store";
import { eventsToLogEntries, extractResultSummary } from "@/lib/parsers/stream";
import { findPendingAsk } from "@/components/operation/log/display-nodes";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { commitWorkspaceSnapshot, listWorkspaceRepos } from "@/lib/workspace";
import { getReadme, getWorkspaceSummary, listWorkspaceItems } from "@/lib/workspace/reader";
import { appendTodoItems, replaceReadmeSections } from "@/lib/workspace/workspace-files";
import { resolveArtifactPath } from "@/lib/workspace/artifacts";
import {
  addRepositorySchema,
  autonomousSchema,
  createPrSchema,
  executeSchema,
  harvestLessonsSchema,
  initSchema,
  operationAnswerSchema,
  operationKillSchema,
  reviewSchema,
  updateTodoSchema,
} from "@/lib/schemas";
import { POST as postInit } from "../operations/init/route";
import { POST as postAutonomous } from "../operations/autonomous/route";
import { POST as postExecute } from "../operations/execute/route";
import { POST as postReview } from "../operations/review/route";
import { POST as postCreatePr } from "../operations/create-pr/route";
import { POST as postAddRepository } from "../operations/add-repository/route";
import { POST as postHarvestLessons } from "../operations/harvest-lessons/route";
import { POST as postUpdateTodo } from "../operations/update-todo/route";
import { POST as postAnswer } from "../operations/answer/route";
import { POST as postKill } from "../operations/kill/route";
import { GET as listOperations } from "../operations/route";

/** Runs the same handler the web UI posts to, so validation and defaults stay in one place. */
async function viaRoute(handler: (request: Request) => Promise<Response>, body: unknown) {
  const response = await handler(
    new Request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { data: await response.json(), isError: !response.ok };
}

function routeTool(
  name: string,
  description: string,
  input: z.ZodType,
  handler: (request: Request) => Promise<Response>,
): McpTool {
  return { name, description, input, call: (args) => viaRoute(handler, args) };
}

const STARTS_OPERATION = "Returns the started operation at once; follow it with get_operation.";
const INTERACTION_LEVEL =
  "interactionLevel (low / mid / high) sets how readily the agents stop to ask; omitted, the configured default applies.";

const workspaceInput = z.object({ workspace: z.string().min(1, "workspace is required") });

const sectionText = (what: string) => z.string().optional().describe(`Markdown body of the section, replacing it whole: ${what}`);

const readmeSectionsInput = workspaceInput.extend({
  title: z.string().optional().describe("The `# Task:` title, under 70 characters; every pull request reuses it verbatim."),
  goal: sectionText("what must be true once the task is done."),
  nonGoal: sectionText(
    "exclusions grounded in the request, and actions agents must not take on their own (release, infra / DB changes, anything irreversible).",
  ),
  assumptions: sectionText("`- (assumption) …` items for what could not be confirmed, so a person can catch a wrong guess."),
  context: sectionText("background — why the task exists, what was found."),
  requirements: sectionText("specific functional / technical requirements."),
  acceptanceCriteria: z
    .array(
      z.object({
        kind: z
          .enum(["auto", "manual"])
          .describe("auto: an agent can prove it with evidence (exit code, code presence, API behavior). manual: needs a person; agents never attempt it."),
        text: z.string().min(1).describe("One objectively checkable condition."),
      }),
    )
    .optional()
    .describe("The whole checklist that defines done, replacing the current one. A criterion restated with the same text keeps its checked state."),
  relatedResources: sectionText("links."),
});

const todoItemsInput = workspaceInput.extend({
  repository: z.string().min(1).describe("The worktree: its directory name (TODO-<name>.md) or its path as the README lists it."),
  section: z
    .string()
    .min(1)
    .describe("The `##` heading to append under, e.g. `Implementation Tasks`; created before Verification / Finalize / Notes when missing."),
  items: z
    .array(
      z.object({
        tag: z.string().min(1).describe("Short area label rendered as **[tag]**, e.g. API, Test, Docs."),
        title: z.string().min(1).describe("One atomic change; \"… and also …\" is two items."),
        target: z.string().min(1).describe("path:line, or path + the exact symbol — never \"the relevant module\"."),
        action: z.string().min(1).describe("The concrete recipe: the import, the call, the literal to change."),
        verify: z
          .string()
          .optional()
          .describe("One check that passes or fails, as narrow as the item allows (the one test, not the suite). Required for code changes."),
        pattern: z.string().optional().describe("Only when the convention is non-obvious: existing code to mirror, path:line."),
        why: z.string().optional().describe("Only when the action does not make it obvious: what stays broken without this item."),
      }),
    )
    .min(1),
});

const artifactInput = workspaceInput.extend({
  path: z
    .string()
    .min(1)
    .describe("Markdown file relative to the workspace's artifacts/, e.g. `alerts/2026-11-19.md`; directories are created. reviews/ is written by review and refused."),
  content: z.string().describe("Markdown to write."),
  append: z.boolean().default(false).describe("Add to the end of the file instead of replacing it."),
});

/** `artifacts/reviews/` is rendered from review results; a hand edit there disagrees with them. */
const RESERVED_ARTIFACT_DIRS = ["reviews"];

/**
 * Checks shared by the file-writing tools. A running operation rewrites README
 * and TODO files, so writing beside it loses one of the two edits.
 */
async function writableWorkspace(workspace: string): Promise<{ name: string } | { error: string }> {
  const name = resolveWorkspaceName(workspace);
  const running = getOperationSummaries().find((op) => op.workspace === name && op.status === "running");
  if (running) {
    return { error: `Operation ${running.id} (${running.type}) is running on ${name}; write once it has finished.` };
  }
  if (!(await getWorkspaceSummary(name))) return { error: `Workspace not found: ${name}` };
  return { name };
}

const RECENT_STATUS_LINES = 8;
const STATUS_LINE_MAX_CHARS = 500;

/**
 * The last progress and error lines, newest last. A failed run's reason lives
 * only here; `__`-prefixed status events are internal phase markers.
 */
function recentStatus(events: OperationEvent[]): string[] {
  const lines: string[] = [];
  for (let i = events.length - 1; i >= 0 && lines.length < RECENT_STATUS_LINES; i--) {
    const { type, data, childLabel } = events[i];
    const label = childLabel ? `${childLabel}: ` : "";
    let line: string | undefined;
    if (type === "status" && !data.startsWith("__")) line = `${label}${data}`;
    else if (type === "error") line = `error: ${label}${data}`;
    if (line) lines.push(line.length > STATUS_LINE_MAX_CHARS ? `${line.slice(0, STATUS_LINE_MAX_CHARS)}…` : line);
  }
  return lines.reverse();
}

const WAIT_POLL_MS = 1000;

/** Returns once the operation is no longer running or waits on a question, or after `seconds`. */
async function waitWhileRunning(operationId: string, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const op = getOperationSummaries().find((o) => o.id === operationId);
    if (!op || op.status !== "running" || op.hasPendingAsk) return;
    await Bun.sleep(Math.min(WAIT_POLL_MS, deadline - Date.now()));
  }
}

async function getOperationStatus(operationId: string) {
  const summary = getOperationSummaries().find((op) => op.id === operationId);
  if (summary) {
    const live = getOperationEvents(operationId);
    // A finished operation's in-memory events are cleared; its log is on disk.
    const events = live.length > 0 ? live : (readOperationLog(operationId)?.events ?? []);
    const ask = summary.hasPendingAsk ? findPendingAsk(eventsToLogEntries(events)) : null;
    return {
      data: {
        ...summary,
        phases: getOperation(operationId)?.phases,
        recentStatus: recentStatus(events),
        ...(ask && {
          pendingQuestion: { toolUseId: ask.toolId, questions: ask.questions, allowFreeText: ask.allowFreeText },
        }),
      },
    };
  }
  const stored = readOperationLog(operationId);
  if (!stored) return { data: `Operation not found: ${operationId}`, isError: true };
  return {
    data: {
      ...stored.operation,
      resultSummary: extractResultSummary(stored.events),
      recentStatus: recentStatus(stored.events),
    },
  };
}

const LIST_INPUT_MAX_CHARS = 200;

function toListEntry({ resultSummary: _result, inputs, ...op }: OperationListItem) {
  if (!inputs) return op;
  const shortened = Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [
      key,
      value.length > LIST_INPUT_MAX_CHARS ? `${value.slice(0, LIST_INPUT_MAX_CHARS)}…` : value,
    ]),
  );
  return { ...op, inputs: shortened };
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_workspaces",
    description: "List workspaces, most recently modified first, with their TODO progress.",
    input: z.object({ includeArchived: z.boolean().optional() }),
    call: async (args) => {
      const { includeArchived } = args as { includeArchived?: boolean };
      return { data: await listWorkspaceItems({ includeArchived }) };
    },
  },
  {
    name: "get_workspace",
    description: "Read one workspace: its metadata, repositories and every TODO item with its status.",
    input: workspaceInput,
    call: async (args) => {
      const name = resolveWorkspaceName((args as { workspace: string }).workspace);
      const summary = await getWorkspaceSummary(name);
      if (!summary) return { data: `Workspace not found: ${name}`, isError: true };
      // `sections` holds every item again, under its heading and with its notes.
      return { data: { ...summary, todos: summary.todos.map(({ items: _items, ...todo }) => todo) } };
    },
  },
  {
    name: "archive_workspace",
    description:
      "Archive a workspace (hidden from list_workspaces by default), or restore it with archived: false. " +
      "Archiving is refused while the workspace has open pull requests unless closeOpenPrs is true, which closes them and deletes their branches; a review or research workspace's PRs are left alone. " +
      "Archiving also starts harvest_lessons on the workspace.",
    input: workspaceInput.extend({ archived: z.boolean().default(true), closeOpenPrs: z.boolean().optional() }),
    call: async (args) => {
      const { workspace, archived, closeOpenPrs } = args as { workspace: string; archived: boolean; closeOpenPrs?: boolean };
      const name = resolveWorkspaceName(workspace);
      if (!(await getWorkspaceSummary(name))) return { data: `Workspace not found: ${name}`, isError: true };
      if (!archived) {
        unarchiveWorkspace(name);
        return { data: { workspace: name, archived } };
      }
      try {
        return { data: { workspace: name, archived, ...(await archiveWorkspaceWithPrs(name, { closeOpenPrs })) } };
      } catch (err) {
        if (err instanceof OpenPullRequestsError) {
          return { data: { error: err.message, openPullRequests: err.pullRequests }, isError: true };
        }
        throw err;
      }
    },
  },
  routeTool(
    "init_only",
    "Create a workspace from a task description and stop once its README, repositories and TODOs are planned, without executing anything. " +
      `To take a new task through to pull requests, use autonomous instead. ${INTERACTION_LEVEL} ${STARTS_OPERATION}`,
    initSchema,
    postInit,
  ),
  routeTool(
    "autonomous",
    "The default way to start a new task: pass its description and it creates the workspace, then runs execute → review → gate up to maxLoops (default 3) and creates PRs. " +
      "startWith defaults to init, which needs description; update-todo continues an existing workspace and needs workspace and instruction; execute needs workspace. " +
      `draft (default true) applies to the PRs. ${INTERACTION_LEVEL} ${STARTS_OPERATION}`,
    autonomousSchema.extend({ startWith: autonomousSchema.shape.startWith.default("init") }),
    postAutonomous,
  ),
  routeTool(
    "update_todo",
    `Plan more work into an existing workspace's TODOs from an instruction; repo narrows it to one repository. ${INTERACTION_LEVEL} ${STARTS_OPERATION}`,
    updateTodoSchema,
    postUpdateTodo,
  ),
  routeTool(
    "execute",
    `Carry out a workspace's pending TODO items; repository narrows it to one. ${INTERACTION_LEVEL} ${STARTS_OPERATION}`,
    executeSchema,
    postExecute,
  ),
  routeTool(
    "review",
    `Review a workspace's changes against its README and TODOs; repository narrows it to one. ${STARTS_OPERATION}`,
    reviewSchema,
    postReview,
  ),
  routeTool(
    "add_repository",
    "Add a repository's worktree to an existing workspace and declare it in the README; its constraints are discovered too. " +
      "repository is a path like github.com/org/repo, cloned when it is not on disk. For another worktree of a repository the workspace already has " +
      "(work on a separate branch), suffix an alias: github.com/org/repo:<alias>. A new branch is cut from baseBranch (default: the repository's default branch); " +
      `branch checks out an existing remote branch instead. ${STARTS_OPERATION}`,
    addRepositorySchema,
    postAddRepository,
  ),
  {
    name: "write_readme_sections",
    description:
      "Rewrite sections of a workspace's README — the contract the verifier and the autonomous gate hold the work to — and commit it. " +
      "Each section given replaces that section whole; the rest of the README is left as it is. Write only what was settled: a guess goes under assumptions. " +
      "Repositories are added with add_repository, and Repository Constraints are written by discovery. Refused while an operation runs on the workspace.",
    input: readmeSectionsInput,
    call: async (args) => {
      const { workspace, ...sections } = args as z.infer<typeof readmeSectionsInput>;
      const target = await writableWorkspace(workspace);
      if ("error" in target) return { data: target.error, isError: true };
      const file = path.join(getWorkspaceDir(), target.name, "README.md");
      await Bun.write(file, replaceReadmeSections(await Bun.file(file).text(), sections));
      const written = Object.keys(sections).filter((k) => sections[k as keyof typeof sections] !== undefined);
      await commitWorkspaceSnapshot(target.name, `Update README: ${written.join(", ")}`);
      return { data: { workspace: target.name, file: "README.md", updated: written } };
    },
  },
  {
    name: "add_todo_items",
    description:
      "Append pending items to a worktree's TODO-<repo>.md and commit it; execute picks them up. A missing file is started from the task type's template. " +
      "Leave out what is not an item: reading docs, and the README's Repository Constraints commands (the executor and the review run them all). " +
      "Refused while an operation runs on the workspace.",
    input: todoItemsInput,
    call: async (args) => {
      const { workspace, repository, section, items } = args as z.infer<typeof todoItemsInput>;
      const target = await writableWorkspace(workspace);
      if ("error" in target) return { data: target.error, isError: true };
      const repos = await listWorkspaceRepos(target.name);
      const repo = repos.find((r) => r.repoName === repository || r.repoPath === repository);
      if (!repo) {
        return { data: `No worktree ${repository} in ${target.name}; it has: ${repos.map((r) => r.repoName).join(", ") || "none"}`, isError: true };
      }
      const wsPath = path.join(getWorkspaceDir(), target.name);
      const filename = `TODO-${repo.repoName}.md`;
      const file = Bun.file(path.join(wsPath, filename));
      const content = (await file.exists()) ? await file.text() : null;
      const { taskType } = parseReadmeMeta((await getReadme(target.name)) ?? "");
      await Bun.write(file, appendTodoItems(content, { repoName: repo.repoName, taskType, section, items }));
      await commitWorkspaceSnapshot(target.name, `Add ${items.length} TODO item(s) to ${filename}`);
      return { data: { workspace: target.name, file: filename, added: items.length, created: content === null } };
    },
  },
  {
    name: "write_artifact",
    description:
      "Write a markdown file under a workspace's artifacts/ (shown on its Artifacts tab) and commit it — findings, an investigation, a report. " +
      "Replaces the file unless append is true. Refused while an operation runs on the workspace.",
    input: artifactInput,
    call: async (args) => {
      const { workspace, path: relPath, content, append } = args as z.infer<typeof artifactInput>;
      const target = await writableWorkspace(workspace);
      if ("error" in target) return { data: target.error, isError: true };
      const full = await resolveArtifactPath(path.join(getWorkspaceDir(), target.name), relPath);
      const reserved = RESERVED_ARTIFACT_DIRS.includes(path.normalize(relPath).split(/[\\/]/)[0]);
      if (!full || reserved || path.extname(relPath).toLowerCase() !== ".md") {
        return { data: `Not a writable artifact path: ${relPath} (a .md file inside artifacts/, outside reviews/)`, isError: true };
      }
      await mkdir(path.dirname(full), { recursive: true });
      if (append) await appendFile(full, content);
      else await Bun.write(full, content);
      await commitWorkspaceSnapshot(target.name, `${append ? "Append to" : "Write"} artifact ${relPath}`);
      return { data: { workspace: target.name, file: `artifacts/${relPath}`, appended: append } };
    },
  },
  routeTool(
    "harvest_lessons",
    "Distill a workspace's outcome (PR comments, commits people added, a rejected PR, recurring review findings) into candidate lessons " +
      `for its repositories. Archiving starts this on its own; candidates wait for a person to approve them. ${STARTS_OPERATION}`,
    harvestLessonsSchema,
    postHarvestLessons,
  ),
  routeTool(
    "create_pr",
    `Push each repository's branch and open or update its pull request (draft unless draft: false). ${STARTS_OPERATION}`,
    createPrSchema,
    postCreatePr,
  ),
  {
    name: "list_operations",
    description:
      "List operations, running ones first, newest first within that. status narrows it to running or recently finished ones. " +
      "Inputs are shortened and results left out; get_operation has both in full.",
    input: z.object({
      workspace: z.string().optional(),
      status: z.enum(["running", "completed"]).optional(),
      limit: z.number().int().min(1).max(200).default(20),
    }),
    call: async (args) => {
      const { workspace, status, limit } = args as { workspace?: string; status?: string; limit: number };
      const url = new URL("http://localhost/api/operations");
      if (workspace) url.searchParams.set("workspace", resolveWorkspaceName(workspace));
      if (status) url.searchParams.set("status", status);
      url.searchParams.set("limit", String(limit));
      const response = listOperations(new Request(url));
      if (!response.ok) return { data: await response.json(), isError: true };
      const operations = (await response.json()) as OperationListItem[];
      return { data: operations.slice(0, limit).map(toListEntry) };
    },
  },
  {
    name: "get_operation",
    description:
      "Read an operation's status, phases, final result and recentStatus (its last progress and error lines, which say why a failed run stopped). While it waits on a question it carries pendingQuestion; answer it with answer_question.",
    input: z.object({
      operationId: z.string().min(1, "operationId is required"),
      waitSeconds: z
        .number()
        .int()
        .min(0)
        .max(120)
        .optional()
        .describe("Wait up to this long for a running operation to finish or ask a question before answering, instead of calling again in a loop."),
    }),
    call: async (args) => {
      const { operationId, waitSeconds } = args as { operationId: string; waitSeconds?: number };
      if (waitSeconds) await waitWhileRunning(operationId, waitSeconds);
      return getOperationStatus(operationId);
    },
  },
  routeTool(
    "answer_question",
    "Answer an operation's pendingQuestion. answers maps each question's text to the chosen option label (labels joined with \", \" for multi-select) or free text.",
    operationAnswerSchema,
    postAnswer,
  ),
  routeTool("kill_operation", "Stop a running operation.", operationKillSchema, postKill),
];
