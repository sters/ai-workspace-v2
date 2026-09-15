/**
 * Prompts for interactive chat sessions.
 *
 * The opening user message is a set of pointers, not a corpus: the session's
 * first turn cds into the workspace and reads the README itself. Embedding the
 * README body and a TODO progress table instead cost nothing at startup but
 * pinned a snapshot of files an operation may rewrite mid-conversation, and
 * dumped the whole README into the browser terminal as the visible first
 * message. The chat server refuses to start a session whose workspace has no
 * README, so the read below always has a target.
 *
 * Three of the four variants end that first turn in a wait, because nothing
 * has been asked yet. The task variant is the exception and the reason the
 * distinction is worth naming: its request arrived *with* the session, so
 * waiting would mean asking the user to say again what they already wrote.
 */

const WORKSPACE_LAYOUT =
  "You are working on an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO-*.md files (task tracking), and artifacts/ (review and research reports).";

/**
 * Why only the startup files are read up front. Applies to every chat variant:
 * whatever is read on the first turn is a snapshot, and the TODO files and
 * artifacts are the parts a running operation rewrites.
 */
const ON_DEMAND_READING =
  "Nothing beyond those files is pre-loaded. Read the TODO files and the remaining artifacts when a question calls for them, so you see their current state rather than a snapshot taken before the conversation started — an operation may be rewriting them while we talk.";

/**
 * System prompt for interactive chat sessions.
 * Bounds the first turn to cd + one README read + a one-line acknowledgement,
 * so startup neither investigates on its own initiative nor reports back.
 */
export function getChatSystemPrompt(): string {
  return `${WORKSPACE_LAYOUT}

Your first turn consists of exactly three things:

1. One Bash call: \`cd <workspace path from the user prompt>\` on its own — no other command, no \`&&\`/\`;\`.
2. One Read call: the workspace \`README.md\`, at the path in the user prompt.
3. One short sentence, e.g. "Ready." — then stop and wait for the user's next message.

Treat what you read as silent reference: it is there so you have the workspace's goal and plan in hand, not as a topic to open with. Summarizing it, further investigating (Read/Grep/Glob, git status, git log, gh pr, ls), and proposing next steps all belong to later turns, only once the user asks — that is what the rest of the conversation is for.

${ON_DEMAND_READING}`;
}

/**
 * System prompt for review-focused chat sessions.
 * Review chats DO have explicit discussion intent (the review summary is
 * the topic), so Claude may engage with that content — but still must not
 * sprawl into unrelated investigation at startup.
 */
export function getReviewChatSystemPrompt(): string {
  return `${WORKSPACE_LAYOUT}

Your first turn consists of exactly three things:

1. One Bash call: \`cd <workspace path from the user prompt>\` on its own — no other command, no \`&&\`/\`;\`.
2. Read calls for the two files the user prompt names — the review \`SUMMARY.md\` and the workspace \`README.md\`. Issue them together in this turn.
3. A brief acknowledgement (1-2 sentences) about the review topic, then wait for the user's question.

That acknowledgement is all the first turn produces. Reach for the per-repository review reports beside the SUMMARY, or for the code itself (Read/Glob/Grep, git status, git log, gh pr), once the user's question calls for them.

${ON_DEMAND_READING}`;
}

/**
 * System prompt for research-focused chat sessions. Same constraints as the
 * review chat prompt — discussion intent is explicit (the research summary
 * is the topic), but startup must not sprawl into unrelated investigation.
 */
export function getResearchChatSystemPrompt(): string {
  return `${WORKSPACE_LAYOUT}

Your first turn consists of exactly three things:

1. One Bash call: \`cd <workspace path from the user prompt>\` on its own — no other command, no \`&&\`/\`;\`.
2. Read calls for the two files the user prompt names — the research \`summary.md\` and the workspace \`README.md\`. Issue them together in this turn.
3. A brief acknowledgement (1-2 sentences) about the research topic, then wait for the user's question.

That acknowledgement is all the first turn produces. Reach for the per-repository research reports beside the summary, or for the code itself (Read/Glob/Grep, git status, git log, gh pr), once the user's question calls for them.

${ON_DEMAND_READING}`;
}

/**
 * System prompt for a chat session that was handed a task up front.
 *
 * Every other variant's first turn ends in a wait, because nothing has been
 * asked yet and a session that starts investigating on its own initiative is
 * reading files the user may not care about. Here the request arrived *with*
 * the session — quick create's note — so the same restraint would make the
 * user retype what they already wrote into the form. The bounds that remain
 * are the ones a waiting turn was incidentally providing: publishing is not
 * this session's to do, and an unguessable decision still comes back to the
 * user rather than being resolved by a guess.
 */
export function getTaskChatSystemPrompt(): string {
  return `${WORKSPACE_LAYOUT}

The user's request is in the first message. Your first turn is:

1. One Bash call: \`cd <workspace path from the user prompt>\` on its own — no other command, no \`&&\`/\`;\`.
2. One Read call: the workspace \`README.md\`, at the path in the user prompt. It says which repositories have worktrees here and where they are.
3. Then start on the request, without asking for permission to begin.

Work it through: find the code involved, make the change in the worktrees the README declares, and verify it with the repository's own checks (its lint / test / build commands, as the repository defines them — a repository with a \`## Repository Constraints\` section in the README has them listed there). Report what you did when you are done.

Ask the user when a decision is genuinely theirs — an ambiguity in the request where the choices lead to materially different work, or a change that reaches further than they asked for. For anything you can settle from the code, settle it and say which assumption you took. A question you could have answered by reading the repository is a turn the user has to sit through.

Two things are out of scope. **Publishing**: no \`git push\`, no \`gh pr create\`, no merging — the WebUI has operations for that, and the user is sitting in front of this session. Committing in the worktree is fine. **The workspace contract**: leave \`README.md\` and the \`TODO-*.md\` files alone unless the user asks; the pipeline's phases treat them as authoritative and write them themselves.

${ON_DEMAND_READING}`;
}

/**
 * Build the initial prompt sent to Claude when starting an interactive chat session.
 */
export function buildInitPrompt(workspaceId: string, workspacePath: string): string {
  return firstTurnSection(workspacePath);
}

/**
 * Build the initial prompt for a chat session that already has its task: the
 * note the caller wrote when creating the workspace.
 *
 * The task goes in verbatim and last. The positional argument is the visible
 * first message in the browser terminal, so this reads as the user saying what
 * they want — which is what it is.
 */
export function buildTaskChatPrompt(
  workspaceId: string,
  workspacePath: string,
  task: string,
): string {
  return [
    firstTurnSection(workspacePath, [], "start on the request below"),
    "### What I want to do",
    "",
    task,
    "",
    "Work through it on your own — make the change in the repositories the README declares, and verify it with their own checks. Ask me only if something genuinely needs my decision.",
  ].join("\n");
}

/**
 * Build the initial prompt for a chat session focused on a specific review.
 */
export function buildReviewChatPrompt(
  workspaceId: string,
  workspacePath: string,
  reviewTimestamp: string,
): string {
  const reviewDir = `${workspacePath}/artifacts/reviews/${reviewTimestamp}/`;
  return [
    firstTurnSection(workspacePath, [`${reviewDir}SUMMARY.md`]),
    `I want to discuss the review session from timestamp "${reviewTimestamp}".`,
    `The rest of that session's artifacts are beside the summary, in ${reviewDir}`,
  ].join("\n");
}

/**
 * Build the initial prompt for a chat session focused on research results.
 */
export function buildResearchChatPrompt(
  workspaceId: string,
  workspacePath: string,
): string {
  const researchDir = `${workspacePath}/artifacts/research/`;
  return [
    firstTurnSection(workspacePath, [`${researchDir}summary.md`]),
    `I want to discuss the research results for workspace "${workspaceId}".`,
    `The rest of the research artifacts are beside the summary, in ${researchDir}`,
  ].join("\n");
}

/**
 * Build the preamble injected at the top of every chat init prompt. The Claude
 * CLI is spawned with cwd = ai-workspace root so that `.claude/settings.local.json`
 * (permissions + managed hooks) is auto-loaded; we then instruct Claude to cd
 * into the feature workspace, mirroring how pipeline prompts (`executor.ts` etc.)
 * handle the same constraint.
 *
 * `afterReads` is what this block says to do once the reads are done, and it is
 * a parameter rather than fixed text because this block is the **last word** on
 * "what do I do here" in the prompt the model receives. Stating the waiting
 * variants' shape here unconditionally put "then wait for the user" at the end
 * of the task variant's prompt, against a system prompt telling it to start —
 * the same way a shared fragment loses to the prompt around it in
 * `REPO_SEARCH_EFFICIENCY`.
 */
function firstTurnSection(
  workspacePath: string,
  extraReads: string[] = [],
  afterReads = "follow the first-turn shape in the system prompt (brief acknowledgement, then wait for the user)",
): string {
  const reads = [`${workspacePath}/README.md`, ...extraReads];
  return [
    "### Working Directory",
    "",
    `Workspace path: \`${workspacePath}\``,
    "",
    "**Required first action:** issue exactly one Bash call:",
    "",
    "```bash",
    `cd ${workspacePath}`,
    "```",
    "",
    `Then read ${reads.map((f) => `\`${f}\``).join(" and ")}, and ${afterReads}.`,
    "",
    `The TODO files (\`${workspacePath}/TODO-*.md\`) and the other artifacts (\`${workspacePath}/artifacts/\`) are there if something calls for them — leave them until it does.`,
    "",
  ].join("\n");
}
