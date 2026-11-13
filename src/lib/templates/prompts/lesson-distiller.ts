import type { LessonMaterial } from "@/lib/lessons/material";
import type { RepoLesson } from "@/types/repo-lessons";

export const LESSON_DISTILLATION_SCHEMA = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["new", "reinforce", "merge", "challenge"],
            description:
              "new: a lesson no listed one covers. reinforce: the material repeats one listed approved or candidate lesson. merge: one lesson replacing one or more approved ones. challenge: the material shows one approved lesson led the work wrong.",
          },
          section: {
            type: "string",
            enum: ["implementation", "review"],
            description: "implementation: how to make changes here. review: what to check, or not flag, when reviewing changes here.",
          },
          text: {
            type: "string",
            description: "The lesson as one imperative sentence a future agent can act on, with the reason after a dash. Empty for reinforce and challenge.",
          },
          targetIds: {
            type: "array",
            items: { type: "string" },
            description: "reinforce: exactly the one id it repeats. merge: the approved ids it replaces. challenge: exactly the one approved id it disputes. new: empty.",
          },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string", description: "Permalink of the comment, commit or PR, when there is one." },
                note: { type: "string", description: "One line: what in the material supports it." },
              },
              required: ["note"],
              additionalProperties: false,
            },
          },
        },
        required: ["action", "section", "text", "targetIds", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["lessons"],
  additionalProperties: false,
} as const;

function lessonList(lessons: RepoLesson[]): string {
  if (lessons.length === 0) return "None.";
  return lessons.map((l) => `- \`${l.id}\` [${l.section}] ${l.text}`).join("\n");
}

function prSection(m: LessonMaterial): string {
  if (!m.pr) return "No pull request was found for this repository's branch.";
  const outcome = m.closedByArchive
    ? "CLOSED by aiw when the workspace was archived — this says nothing about whether the work was wanted"
    : m.pr.state;
  const threads = m.pr.threads
    .filter((t) => t.comments.length > 0)
    .map((t) => {
      const where = t.path ? ` on \`${t.path}${t.line ? `:${t.line}` : ""}\`` : "";
      const status = t.isResolved ? "resolved" : "unresolved";
      const body = t.comments
        .map((c) => `  - **${c.author}** (${c.url}): ${c.body.slice(0, 1500).replace(/\n+/g, " ")}`)
        .join("\n");
      return `- ${t.kind}${where}, ${status}${t.reviewState ? `, ${t.reviewState}` : ""}\n${body}`;
    })
    .join("\n");
  const timeline = m.events
    .filter((e) => e.kind !== "comment")
    .map((e) => `- ${e.occurredAt} ${e.kind}: ${e.body}`)
    .join("\n");
  return `${m.pr.url} — final state: ${outcome}\n\n#### Comments\n\n${threads || "None."}\n\n#### Timeline\n\n${timeline || "Nothing recorded."}`;
}

function commitsSection(m: LessonMaterial): string {
  if (m.humanCommits.length === 0) return "None.";
  return m.humanCommits
    .map((c) => `##### ${c.sha.slice(0, 12)} ${c.subject} (${c.committedAt})\n\n\`\`\`diff\n${c.patch}\n\`\`\``)
    .join("\n\n");
}

function findingsSection(findings: { summary: string; kind: string; workspace?: string }[]): string {
  if (findings.length === 0) return "None.";
  return findings.map((f) => `- [${f.kind}]${f.workspace ? ` (${f.workspace})` : ""} ${f.summary}`).join("\n");
}

export function buildLessonDistillerPrompt(input: {
  workspaceName: string;
  readmeExcerpt: string;
  material: LessonMaterial;
  approved: RepoLesson[];
  candidates: RepoLesson[];
  rejected: RepoLesson[];
  /** Sections whose approved count is at the cap; only merges may grow them. */
  fullSections: string[];
}): string {
  const m = input.material;
  const cap = input.fullSections.length
    ? `\nThe ${input.fullSections.join(" and ")} section${input.fullSections.length > 1 ? "s are" : " is"} full. Do not add \`new\` lessons there; instead propose \`merge\`s that fold similar approved lessons into one, and reinforce existing ones.\n`
    : "";

  return `# Distill Repository Lessons

You read how one piece of work in the repository \`${m.repoKey}\` went, and turn what it teaches into lessons for future agents working in that repository. A person reviews every lesson you propose before any agent sees it, so propose only what you would defend to them. Everything you need is below; answer from it alone.

## What counts as a lesson

A lesson is a repository-specific practice that someone's reaction showed aiw got wrong or missed, stated so a future agent can follow it. Signals, strongest first (non-exhaustive):

- A reviewer asked for a change, and the thread was resolved or the code changed to match.
- A person committed after aiw handed the work over: what they changed is what aiw should have done.
- The PR was closed without merging and a comment says why. A PR aiw closed on archive is not this signal.
- aiw's own review raised the same kind of finding here in more than one workspace: either agents keep making that mistake (an implementation lesson), or reviewers keep flagging something this repository accepts (a review lesson: what not to flag).

Good lessons name the concrete practice and why, e.g. "Add a down migration next to every schema change — reviewers reject irreversible migrations." or "Do not flag missing null checks on values from the config loader — it validates them at startup." Leave out one-off bugs in this change, task-specific decisions, generic advice any codebase shares, and taste no one expressed. Proposing nothing is a normal outcome.

## When an approved lesson was wrong

Approved lessons were in front of the agents that did this work, so the material can also show one of them misleading them: a reviewer asked to undo what the lesson told the agent to do, a person's commit reverted it, or aiw's review flagged code the lesson asked for. Then:

- Use \`challenge\` with that lesson's id, and evidence saying what went wrong. A person decides whether to keep, reword or reject it.
- When the material also shows what the lesson should say instead, add a \`merge\` whose only target is that id, with the corrected text.

Challenge only on a reaction against the practice itself, not when the work merely happened to touch the same area.

## Avoid duplicates

- When the material supports a lesson already listed as approved or candidate, use \`reinforce\` with its id and add the evidence. Do not restate it as \`new\`.
- Never propose anything a listed rejected lesson already says, in any wording.
- When several signals in this material point at one practice, propose one lesson carrying all of their evidence.
${cap}
## Workspace \`${input.workspaceName}\`

${input.readmeExcerpt}

### Pull request

${prSection(m)}

### Commits people added after aiw

${commitsSection(m)}

### aiw's review findings in this workspace

${findingsSection(m.findings)}

### aiw's review findings in earlier workspaces of this repository

${findingsSection(m.priorFindings)}

## Existing lessons for \`${m.repoKey}\`

### Approved

${lessonList(input.approved)}

### Candidates (awaiting review)

${lessonList(input.candidates)}

### Rejected

${lessonList(input.rejected)}
`;
}
