/**
 * Prompt template for Best-of-N reviewer agent.
 * Compares N candidate results and decides whether to select one or synthesize from multiple.
 */

import type {
  BestOfNReviewerInput,
  BestOfNFileReviewerInput,
  BestOfNFileSynthesizerInput,
} from "@/types/prompts";

/**
 * JSON Schema for the structured output of the reviewer.
 */
export const BEST_OF_N_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["select", "synthesize"],
      description:
        "Whether to select a single candidate as-is or synthesize the best parts from multiple candidates.",
    },
    candidate: {
      type: "number",
      description:
        "1-indexed candidate number to select (required for 'select' action, preferred base for 'synthesize').",
    },
    sources: {
      type: "array",
      items: { type: "number" },
      description:
        "1-indexed candidate numbers used as sources (for 'synthesize' action).",
    },
    reasoning: {
      type: "string",
      description: "Brief explanation of the decision.",
    },
  },
  required: ["action", "candidate", "reasoning"],
  additionalProperties: false,
} as const;

export function buildBestOfNReviewerPrompt(
  input: BestOfNReviewerInput,
): string {
  const candidateSections = input.candidates
    .map(
      (c, i) => `### Candidate ${i + 1}: ${c.label}

#### Diff
\`\`\`diff
${c.diff || "(no changes)"}
\`\`\`
${c.resultText ? `\n#### Result Summary\n${c.resultText}` : ""}`,
    )
    .join("\n\n---\n\n");

  return `# Task: Best-of-N Review for ${input.operationType}

## Workspace: ${input.workspaceName}
## Operation Type: ${input.operationType}
## Number of Candidates: ${input.candidates.length}

## Workspace README

${input.readmeContent}

## Candidates

${candidateSections}

## Instructions

You are a specialized reviewer comparing ${input.candidates.length} independent implementations of the same task. Each candidate received the identical prompt and worked on identical codebases in parallel.

### Your Mission

Analyze all candidates and decide the best path forward:

1. **Analyze each candidate**:
   - Correctness: Does it satisfy the task requirements?
   - Code quality: Is the code clean, well-structured, and maintainable?
   - Completeness: Does it handle edge cases?
   - Approach: What strategy was used? Is it sound?

2. **Compare candidates**:
   - Which approaches are superior and why?
   - Are there complementary strengths across candidates?
   - Are there critical flaws in any candidate?

3. **Decide action**:
   - **synthesize** (preferred): Cherry-pick the best parts from each candidate and combine them. You will be given access to all candidate worktrees to produce the merged result.
   - **select**: Only if one candidate is strictly superior in every aspect AND other candidates add nothing of value.

### Output

Respond with a JSON object matching the schema provided via --json-schema.

- For **synthesize**: set \`action: "synthesize"\`, \`candidate\` to the preferred base candidate, \`sources\` to all candidates you drew from.
- For **select**: set \`action: "select"\`, \`candidate\` to the 1-indexed winner.

Include brief \`reasoning\` explaining your decision — highlight what each source candidate contributes.

### Important Notes

- If only one candidate succeeded, select it.
- **Default to synthesize.** Each candidate likely has unique strengths — different edge-case handling, better naming, more thorough comments, additional test cases, etc. Actively look for these and combine them.
- Only use **select** when one candidate is clearly a superset of all others and nothing would be gained by merging.
- When synthesizing, you will be given access to all candidate worktrees to reference their implementations.
`;
}

/**
 * Prompt for reviewing file-based Best-of-N candidates (README, TODO files).
 * Shows file contents instead of diffs.
 */
export function buildBestOfNFileReviewerPrompt(
  input: BestOfNFileReviewerInput,
): string {
  const candidateSections = input.candidates
    .map((c, i) => {
      const fileSections = c.files
        .map((f) => `#### ${f.name}\n\`\`\`markdown\n${f.content}\n\`\`\``)
        .join("\n\n");
      return `### Candidate ${i + 1}: ${c.label}\n\n${fileSections || "(no files)"}`;
    })
    .join("\n\n---\n\n");

  return `# Task: Best-of-N File Review for ${input.operationType}

## Operation Type: ${input.operationType}
## Number of Candidates: ${input.candidates.length}

## Candidates

${candidateSections}

## Instructions

You are a specialized reviewer comparing ${input.candidates.length} independently generated versions of the same file(s). Each candidate received the identical prompt.

### Your Mission

Analyze all candidates and decide the best path forward:

1. **Analyze each candidate**:
   - Completeness: Does it cover all required sections and details?
   - Quality: Is the content well-structured, clear, and actionable?
   - Accuracy: Does it correctly reflect the task requirements?
   - Detail level: Is the granularity appropriate?

2. **Compare candidates**:
   - Which version is most comprehensive?
   - Are there unique insights or sections in any candidate?
   - Are there errors or omissions in any candidate?

3. **Decide action**:
   - **synthesize** (preferred): Cherry-pick the best sections, details, and structure from each candidate and combine them into a superior result.
   - **select**: Only if one candidate is strictly superior in every aspect AND other candidates add nothing of value.

### Output

Respond with a JSON object matching the schema provided via --json-schema.

- For **synthesize**: set \`action: "synthesize"\`, \`candidate\` to the preferred base, \`sources\` to all candidates you drew from.
- For **select**: set \`action: "select"\`, \`candidate\` to the 1-indexed winner.

Include brief \`reasoning\` explaining your decision — highlight what each source candidate contributes.

### Important Notes

- **Default to synthesize.** Each candidate likely has unique strengths — more detailed sections, better structure, additional items, clearer descriptions, etc. Actively look for these and combine them.
- Only use **select** when one candidate is clearly a superset of all others and nothing would be gained by merging.
`;
}

/**
 * Prompt for synthesizing file content from multiple Best-of-N candidates.
 * The synthesizer reads all candidates and writes a merged result.
 */
export function buildBestOfNFileSynthesizerPrompt(
  input: BestOfNFileSynthesizerInput,
): string {
  const candidateSections = input.candidates
    .map((c, i) => {
      const fileSections = c.files
        .map((f) => `#### ${f.name}\n\`\`\`markdown\n${f.content}\n\`\`\``)
        .join("\n\n");
      return `### Candidate ${i + 1}: ${c.label}\n\n${fileSections || "(no files)"}`;
    })
    .join("\n\n---\n\n");

  const fileList = input.fileNames.map((f) => `- ${input.outputDir}/${f}`).join("\n");

  return `# Task: Synthesize Best-of-N Results for ${input.operationType}

## Base Candidate: candidate-${input.baseCandidate}
## Sources: ${input.sources.map((s) => `candidate-${s}`).join(", ")}

## Candidates

${candidateSections}

## Instructions

You are a synthesizer agent. The reviewer has determined that multiple candidates have complementary strengths. Your job is to create a merged version that combines the best parts from each source candidate.

### Steps

1. Start with candidate-${input.baseCandidate} as the base
2. Identify superior sections, details, or approaches from the other source candidates (${input.sources.filter((s) => s !== input.baseCandidate).map((s) => `candidate-${s}`).join(", ")})
3. Merge the best parts into a coherent, unified result
4. Write the final synthesized file(s) to:

${fileList}

### Guidelines

- Maintain consistency in structure and formatting
- Do not simply concatenate — integrate thoughtfully
- Resolve any contradictions by choosing the more accurate or complete version
- The result should be better than any individual candidate
`;
}
