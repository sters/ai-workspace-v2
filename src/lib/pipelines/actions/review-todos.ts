import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { normalizeTodoCheckboxes } from "@/lib/parsers/todo";
import {
  buildReviewerPrompt,
  buildTodoReviewResolutionInstruction,
  buildUpdaterPrompt,
  TODO_REVIEW_SCHEMA,
} from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, PipelinePhaseFunction } from "@/types/pipeline";
import type { InteractionLevel, TodoReviewFinding } from "@/types/prompts";

const KINDS: TodoReviewFinding["kind"][] = ["risk", "blocking", "unclear"];

/** The AskUserQuestion tool takes at most four questions per call. */
const MAX_ASK_QUESTIONS = 4;

/**
 * Reads a plan-review verdict. Returns `[]` for a clean plan and `null` when the
 * verdict cannot be understood — the caller's cue to fail open and leave the plan
 * as the planner wrote it.
 */
export function parseTodoReviewVerdict(text: string): TodoReviewFinding[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Structured output normally arrives bare, but a fenced block is cheap to survive.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { findings } = parsed as Record<string, unknown>;
  if (!Array.isArray(findings)) return null;

  return findings.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { kind, item, detail, suggestedResolution } = entry as Record<string, unknown>;
    if (typeof item !== "string" || item.trim() === "") return [];
    if (typeof detail !== "string" || detail.trim() === "") return [];
    return [{
      // An unknown label is recorded as the weakest actionable claim rather than
      // promoted to `risk` or `blocking`, which assert more than we were told.
      kind: KINDS.includes(kind as TodoReviewFinding["kind"])
        ? (kind as TodoReviewFinding["kind"])
        : "unclear",
      item,
      detail,
      ...(typeof suggestedResolution === "string" && suggestedResolution.trim() !== ""
        ? { suggestedResolution }
        : {}),
    }];
  });
}

/**
 * Deterministic fallback for when the revision child fails: the findings are
 * appended to the TODO file as blocked items so the executor still sees them.
 * Losing them silently is the failure this whole phase exists to fix.
 */
export function formatUnresolvedFindingsSection(findings: TodoReviewFinding[]): string {
  const items = findings
    .map((f) => {
      const lines = [
        `- [!] **[${f.kind}]** ${f.item} — ${f.detail}`,
        `  - Raised by the plan review before execution; resolve it before implementing the item.`,
      ];
      if (f.suggestedResolution) {
        lines.push(`  - Suggested resolution: ${f.suggestedResolution}`);
      }
      return lines.join("\n");
    })
    .join("\n");

  return `\n## Unresolved Plan Review Findings\n\n${items}\n`;
}

interface RepoVerdict {
  repoName: string;
  worktreePath: string;
  todoPath: string;
  todoContent: string;
  findings: TodoReviewFinding[];
}

/**
 * Reviews each repository's TODO file before execution, then applies the verdict.
 *
 * The review half is old; applying it is not. The verdict used to be free text
 * that nothing parsed, so a finding predicting a regression — the plan wires a
 * nullable helper into a call site that always had a value, say — was emitted
 * into the operation log and then rediscovered by the cycle-1 code review, one
 * execute phase later. Now each finding exits as either a TODO amendment or a
 * `[!]` blocked item.
 *
 * Fails open throughout: an unreadable verdict, or a reviser that dies, leaves
 * the plan executable rather than stopping init.
 */
export function buildReviewTodosPhase(input: {
  workspace: string;
  wsPath: string;
  repos: Array<{ repoName: string; worktreePath: string }>;
  /** `high` routes blocking findings to the user before the plan is revised. */
  interactionLevel?: InteractionLevel;
}): PipelinePhaseFunction {
  return {
    kind: "function",
    label: "Review TODOs",
    fn: async (ctx) => {
      const { content: readmeContent } = await readWorkspaceReadme(input.wsPath);

      if (input.repos.length === 0) {
        ctx.emitResult("Skipped TODO review.");
        return true;
      }

      const verdicts: RepoVerdict[] = [];
      const rawTexts = new Map<string, string>();
      const children: GroupChild[] = [];

      for (const repo of input.repos) {
        const todoPath = `${input.wsPath}/TODO-${repo.repoName}.md`;
        const todoFile = Bun.file(todoPath);
        if (!(await todoFile.exists())) continue;
        const todoContent = await todoFile.text();

        verdicts.push({
          repoName: repo.repoName,
          worktreePath: repo.worktreePath,
          todoPath,
          todoContent,
          findings: [],
        });

        children.push({
          label: `review-${repo.repoName}`,
          stepType: STEP_TYPES.REVIEW_TODOS,
          prompt: buildReviewerPrompt({
            workspaceName: input.workspace,
            repoName: repo.repoName,
            readmeContent,
            todoContent,
            worktreePath: repo.worktreePath,
          }),
          jsonSchema: TODO_REVIEW_SCHEMA as unknown as Record<string, unknown>,
          onResultText: (text) => { rawTexts.set(repo.repoName, text); },
          skipAskUserQuestion: true,
          appendSystemPromptFile: ensureSystemPrompt(input.wsPath, "reviewer"),
        });
      }

      if (children.length === 0) {
        ctx.emitResult("No TODO files to review.");
        return true;
      }

      ctx.emitStatus(`Reviewing TODOs for ${children.length} repositories`);
      const results = await ctx.runChildGroup(children);
      const allSuccess = results.every(Boolean);
      ctx.emitStatus(
        `Review complete: ${results.filter(Boolean).length}/${results.length} succeeded`,
      );

      let unreadable = 0;
      for (const verdict of verdicts) {
        const parsed = parseTodoReviewVerdict(rawTexts.get(verdict.repoName) ?? "");
        if (parsed === null) {
          unreadable += 1;
          continue;
        }
        verdict.findings = parsed;
      }

      if (unreadable > 0) {
        ctx.emitStatus(
          `Could not read the plan review verdict for ${unreadable} of ${verdicts.length} repositories — leaving those plans as planned`,
        );
      }

      const toRevise = verdicts.filter((v) => v.findings.length > 0);
      if (toRevise.length === 0) {
        ctx.emitResult(
          unreadable > 0
            ? `Plan review found no actionable issues in the readable verdicts (${unreadable} unreadable).`
            : "**Plan review found no issues** — the TODO items are executable as planned.",
        );
        return allSuccess;
      }

      const totalFindings = toRevise.reduce((n, v) => n + v.findings.length, 0);
      ctx.emitStatus(
        `Plan review found ${totalFindings} issue(s) across ${toRevise.length} repositories — revising the TODOs`,
      );

      const answers = input.interactionLevel === "high"
        ? await askAboutBlockingFindings(ctx, toRevise)
        : undefined;

      const reviseChildren: GroupChild[] = toRevise.map((verdict) => {
        // Each reviser sees only the answers to its own repo's questions.
        const ownAnswers = answers?.filter((a) =>
          verdict.findings.some((f) => f.detail === a.detail),
        );
        return {
          label: `revise-${verdict.repoName}`,
          stepType: STEP_TYPES.UPDATE_TODO,
          prompt: buildUpdaterPrompt({
            workspaceName: input.workspace,
            repoName: verdict.repoName,
            readmeContent,
            todoContent: verdict.todoContent,
            worktreePath: verdict.worktreePath,
            workspacePath: input.wsPath,
            instruction: buildTodoReviewResolutionInstruction({
              findings: verdict.findings,
              ...(ownAnswers?.length ? { answers: ownAnswers } : {}),
            }),
          }),
          addDirs: [input.wsPath],
          // Same restriction as update-todo: the reviser reads the worktree but
          // writes only the TODO file.
          allowedTools: todoAllowedTools(input.wsPath),
          appendSystemPromptFile: ensureSystemPrompt(input.wsPath, "updater"),
          skipAskUserQuestion: true,
        };
      });

      const reviseResults = await ctx.runChildGroup(reviseChildren);

      const stranded: string[] = [];
      for (const [i, verdict] of toRevise.entries()) {
        if (reviseResults[i]) continue;
        await appendUnresolvedFindings(verdict);
        stranded.push(verdict.repoName);
      }

      await normalizeRevisedTodos(ctx, toRevise.map((v) => v.todoPath));

      ctx.emitResult(
        `**Plan review found ${totalFindings} issue(s) before execution** and applied them to ${toRevise.length} TODO file(s).\n` +
          toRevise
            .map((v) => `- **${v.repoName}**: ${v.findings.map((f) => `[${f.kind}] ${f.item}`).join("; ")}`)
            .join("\n") +
          (stranded.length > 0
            ? `\n\nThe revision step failed for ${stranded.join(", ")} — the findings were appended to those TODO files as \`[!]\` items instead, so they reach the executor unresolved.`
            : ""),
      );

      return allSuccess;
    },
  };
}

function todoAllowedTools(wsPath: string): string[] {
  const absPrefix = wsPath.startsWith("/") ? "/" : "//";
  return [
    `Edit(${absPrefix}${wsPath}/TODO-*.md)`,
    `Write(${absPrefix}${wsPath}/TODO-*.md)`,
    "Bash(git:*)",
  ];
}

/**
 * Blocking findings are the ones an agent cannot close on its own, so a watching
 * user is worth interrupting for. Everything else the reviser decides.
 */
async function askAboutBlockingFindings(
  ctx: Parameters<PipelinePhaseFunction["fn"]>[0],
  verdicts: RepoVerdict[],
): Promise<{ detail: string; answer: string }[] | undefined> {
  const blocking = verdicts.flatMap((v) => v.findings.filter((f) => f.kind === "blocking"));
  if (blocking.length === 0) return undefined;

  const asked = blocking.slice(0, MAX_ASK_QUESTIONS);
  if (blocking.length > asked.length) {
    ctx.emitStatus(
      `Asking about ${asked.length} of ${blocking.length} blocking findings — the reviser resolves the rest`,
    );
  }

  const replies = await ctx.emitAsk(
    asked.map((f) => ({
      question: f.detail,
      options: [
        {
          label: f.suggestedResolution ? "Use the suggested resolution" : "Let the agent decide",
          description: f.suggestedResolution ?? `Resolve it while revising "${f.item}".`,
        },
        {
          label: "Record it as blocked",
          description: "Leave the question in the TODO file for a human to answer later.",
        },
      ],
      multiSelect: false,
    })),
    { allowFreeText: true },
  );

  const answers = Object.entries(replies)
    .filter(([, answer]) => typeof answer === "string" && answer.trim() !== "")
    .map(([detail, answer]) => ({ detail, answer }));

  return answers.length > 0 ? answers : undefined;
}

async function appendUnresolvedFindings(verdict: RepoVerdict): Promise<void> {
  const file = Bun.file(verdict.todoPath);
  const current = (await file.exists()) ? await file.text() : verdict.todoContent;
  await Bun.write(verdict.todoPath, current + formatUnresolvedFindingsSection(verdict.findings));
}

/** The reviser writes checkboxes by hand; the same normalization update-todo applies. */
async function normalizeRevisedTodos(
  ctx: Parameters<PipelinePhaseFunction["fn"]>[0],
  todoPaths: string[],
): Promise<void> {
  const modified: string[] = [];
  for (const todoPath of todoPaths) {
    const file = Bun.file(todoPath);
    if (!(await file.exists())) continue;
    const content = await file.text();
    const normalized = normalizeTodoCheckboxes(content);
    if (normalized !== content) {
      await Bun.write(todoPath, normalized);
      modified.push(todoPath.split("/").pop() ?? todoPath);
    }
  }
  if (modified.length > 0) {
    ctx.emitStatus(`Normalized checkbox format in: ${modified.join(", ")}`);
  }
}
