/**
 * The review's verification reports and SUMMARY.md, built from structured
 * results rather than written by an agent. Counts and rates are computed here,
 * so a report's summary table cannot disagree with its own items.
 *
 * SUMMARY.md is an index for readers and the gate, which also reads every
 * report in full; it states what was found, never whether the work can merge.
 */

import type { ConstraintExecResult } from "./constraint-runner";
import type { FindingConfidence } from "@/types/review-findings";
import type { CompletionVerification, CriterionStatus, TodoItemStatus } from "@/types/review-verification";

const CRITERION_STATUSES: readonly CriterionStatus[] = ["SATISFIED", "UNSATISFIED", "PARTIAL", "PENDING-HUMAN"];
const TODO_STATUSES: readonly TodoItemStatus[] = ["VERIFIED", "UNVERIFIED", "PARTIAL", "INCOMPLETE", "UNMARKED", "SKIPPED"];

const titleCase = (s: string) => s.toLowerCase().split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);

/** A `(manual)` criterion is a handoff to a human, whatever the verifier called it. */
function criterionStatus(r: CompletionVerification["requirements"][number]): CriterionStatus {
  return r.kind === "manual" ? "PENDING-HUMAN" : r.status;
}

function countBy<T extends string>(statuses: readonly T[], values: T[]): Record<T, number> {
  const counts = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<T, number>;
  for (const v of values) counts[v] += 1;
  return counts;
}

function readmeCounts(v: CompletionVerification) {
  const counts = countBy(CRITERION_STATUSES, v.requirements.map(criterionStatus));
  const autoTotal = v.requirements.filter((r) => r.kind === "auto").length;
  return { counts, autoTotal };
}

/** Done means verified, or done without the checkbox ticked; a skipped item is out of the plan. */
function todoCounts(v: CompletionVerification) {
  const counts = countBy(TODO_STATUSES, v.todoItems.map((i) => i.status));
  return { counts, completed: counts.VERIFIED + counts.UNMARKED, total: v.todoItems.length - counts.SKIPPED };
}

function statusTable(statuses: readonly string[], counts: Record<string, number>): string {
  return ["| Status | Count |", "|--------|-------|", ...statuses.map((s) => `| ${titleCase(s)} | ${counts[s]} |`)].join("\n");
}

export function renderReadmeVerification(repoName: string, v: CompletionVerification): string {
  const { counts, autoTotal } = readmeCounts(v);
  const manual = v.requirements.filter((r) => criterionStatus(r) === "PENDING-HUMAN");
  return [
    `# README Verification: ${repoName}`,
    "",
    "## Summary",
    "",
    statusTable(CRITERION_STATUSES, counts),
    "",
    `**Satisfaction Rate**: ${pct(counts.SATISFIED, autoTotal)} (${counts.SATISFIED} / ${autoTotal})`,
    "",
    "_Satisfaction Rate counts only agent-verifiable (auto) criteria. Pending Human items are handed off, not failures._",
    "",
    ...v.requirements.flatMap((r) => [
      `## ${r.requirement}`,
      "",
      `- **Status**: ${criterionStatus(r)}`,
      `- **Evidence**: ${r.evidence || "-"}`,
      ...(r.notes ? [`- **Notes**: ${r.notes}`] : []),
      "",
    ]),
    ...(manual.length > 0 ? ["## Manual Verification / Handoff", "", ...manual.map((r) => `- [ ] ${r.requirement}`), ""] : []),
    ...(v.recommendations.length > 0 ? ["## Recommendations", "", ...v.recommendations.map((r) => `- ${r}`), ""] : []),
  ].join("\n");
}

export function renderTodoVerification(repoName: string, v: CompletionVerification): string {
  const { counts, completed, total } = todoCounts(v);
  return [
    `# TODO Verification: ${repoName}`,
    "",
    "## Summary",
    "",
    statusTable(TODO_STATUSES, counts),
    "",
    `**Completion Rate**: ${pct(completed, total)} (${completed} / ${total})`,
    "",
    "## Items",
    "",
    "| Item | Status | Evidence |",
    "|------|--------|----------|",
    ...v.todoItems.map((i) => `| ${cell(i.item)} | ${i.status} | ${cell(i.evidence || "-")} |`),
    "",
  ].join("\n");
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export interface ReportItem {
  text: string;
  confidence: FindingConfidence;
}

export interface ReportItems {
  critical: ReportItem[];
  warning: ReportItem[];
  suggestion: ReportItem[];
  recurring: string[];
}

const SECTION_OF: Record<string, keyof ReportItems> = {
  "critical issues": "critical",
  warnings: "warning",
  suggestions: "suggestion",
  "recurring (previously accepted)": "recurring",
};

const LIST_ITEM = /^(?:[-*]|\d+\.)\s+(.*)$/;
const isNone = (text: string) => /^none\b/i.test(text.replace(/^(?:[-*]|\d+\.)\s+/, "").replace(/\*/g, "").trim());

function toItem(raw: string): ReportItem {
  const confidence = (/\(Confidence:\s*(high|medium|low)\)/i.exec(raw)?.[1]?.toLowerCase() ?? "medium") as FindingConfidence;
  return { text: raw.replace(/\s*\(Confidence:[^)]*\)/i, "").replace(/\*\*/g, "").trim(), confidence };
}

/**
 * The findings of a report written to the review template, at any heading
 * level: one per top-level list item under a Critical Issues / Warnings /
 * Suggestions / Recurring heading, or one per sub-heading there, whose own
 * bullets are its detail. Indented lines belong to the item above. A section
 * whose body opens with "None" has no items, whatever it goes on to list.
 */
export function parseReportItems(markdown: string): ReportItems {
  const items: ReportItems = { critical: [], warning: [], suggestion: [], recurring: [] };
  let section: keyof ReportItems | null = null;
  let level = 0;
  let underSubHeading = false;
  let empty = false;
  let sawContent = false;

  const push = (raw: string) => {
    if (!section || isNone(raw)) return;
    if (section === "recurring") items.recurring.push(raw.trim());
    else items[section].push(toItem(raw));
  };

  for (const line of markdown.split("\n")) {
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const key = SECTION_OF[heading[2].toLowerCase()];
      if (key) {
        section = key;
        level = heading[1].length;
        underSubHeading = false;
        empty = false;
        sawContent = false;
      } else if (section && heading[1].length > level) {
        if (!empty) push(heading[2]);
        underSubHeading = true;
        sawContent = true;
      } else {
        section = null;
      }
      continue;
    }
    if (!section || line.trim() === "") continue;
    if (!sawContent) {
      sawContent = true;
      if (isNone(line)) {
        empty = true;
        continue;
      }
    }
    if (empty || underSubHeading) continue;
    const item = LIST_ITEM.exec(line);
    if (item) push(item[1]);
  }
  return items;
}

export interface FixVerificationRow {
  number: string;
  ask: string;
  status: string;
}

/** The `| # | Requested fix | Status | Evidence |` table a fix verifier opens its report with. */
export function parseFixVerificationTable(markdown: string): FixVerificationRow[] {
  const rows: FixVerificationRow[] = [];
  for (const line of markdown.split("\n")) {
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length < 3 || !/^\d+$/.test(cells[0])) continue;
    rows.push({ number: cells[0], ask: cells[1], status: cells[2].replace(/\*/g, "").toUpperCase() });
  }
  return rows;
}

export interface RepoSummaryInput {
  repoName: string;
  reviewFile: string;
  /** Null when the code reviewer wrote no report. */
  review: ReportItems | null;
  /** Null when the verifier returned no result. */
  verification: { readmeFile: string; todoFile: string | null; data: CompletionVerification } | null;
  constraints: { file: string; results: ConstraintExecResult[] } | { file: string; undeclared: true } | null;
  fixes: { file: string; rows: FixVerificationRow[] } | null;
}

export interface ReviewSummaryInput {
  reviewTimestamp: string;
  repos: RepoSummaryInput[];
  crossRepository: { file: string; items: ReportItems } | null;
}

const link = (file: string) => `[${file}](./${file})`;

function codeReviewTable(items: { severity: string; confidence: string }[], recurring: number): string {
  const n = (s: string) => items.filter((i) => i.severity === s).length;
  return [
    "| Metric | Count |",
    "|--------|-------|",
    `| Critical Issues | ${n("critical")} |`,
    `| Warnings | ${n("warning")} |`,
    `| Suggestions | ${n("suggestion")} |`,
    `| Low-Confidence Findings | ${items.filter((i) => i.confidence === "low").length} |`,
    `| Recurring (previously accepted) | ${recurring} |`,
  ].join("\n");
}

const UNFINISHED_FIX = new Set(["NOT LANDED", "PARTIAL"]);

export function buildReviewSummary(input: ReviewSummaryInput): string {
  const top: string[] = [];
  const failed: string[] = [];
  const sections: string[] = [];

  for (const r of input.repos) {
    const findings = r.review
      ? [
          ...r.review.critical.map((i) => ({ ...i, severity: "critical" })),
          ...r.review.warning.map((i) => ({ ...i, severity: "warning" })),
          ...r.review.suggestion.map((i) => ({ ...i, severity: "suggestion" })),
        ]
      : [];
    const recurring = r.review?.recurring ?? [];
    if (!r.review) failed.push(`- ${r.repoName}: the code reviewer wrote no ${r.reviewFile}`);
    if (!r.verification) failed.push(`- ${r.repoName}: the completion verifier returned no result, so README and TODO completion are unverified`);

    for (const f of findings.filter((f) => f.severity === "critical")) top.push(`[${r.repoName}] Critical: ${f.text} (Confidence: ${f.confidence})`);

    const lines = [`### ${r.repoName}`, "", `- **Review File**: ${link(r.reviewFile)}`];
    if (r.verification) {
      lines.push(`- **README Verification**: ${link(r.verification.readmeFile)}`);
      if (r.verification.todoFile) lines.push(`- **TODO Verification**: ${link(r.verification.todoFile)}`);
    }
    if (r.constraints) lines.push(`- **Constraints**: ${link(r.constraints.file)}`);
    if (r.fixes) lines.push(`- **Fix Verification**: ${link(r.fixes.file)}`);

    lines.push("", "#### Code Review", "", codeReviewTable(findings, recurring.length), "");
    const notable = findings.filter((f) => f.severity !== "suggestion");
    if (notable.length > 0) lines.push(...notable.map((f, i) => `${i + 1}. [${f.severity}] ${f.text} (Confidence: ${f.confidence})`), "");
    if (recurring.length > 0) lines.push("Recurring (previously accepted), excluded from the counts above:", "", ...recurring.map((l) => `- ${l}`), "");

    if (r.verification) {
      const v = r.verification.data;
      const { counts, autoTotal } = readmeCounts(v);
      lines.push("#### README Verification", "", statusTable(CRITERION_STATUSES, counts), "", `**Satisfaction Rate**: ${pct(counts.SATISFIED, autoTotal)} (${counts.SATISFIED} / ${autoTotal})`, "");
      for (const req of v.requirements) {
        const status = criterionStatus(req);
        if (status === "UNSATISFIED" || status === "PARTIAL") top.push(`[${r.repoName}] README criterion ${status}: ${req.requirement}`);
      }
      const manual = v.requirements.filter((req) => criterionStatus(req) === "PENDING-HUMAN");
      if (manual.length > 0) lines.push("Manual verification needed:", "", ...manual.map((req) => `- [ ] ${req.requirement}`), "");

      if (r.verification.todoFile) {
        const t = todoCounts(v);
        lines.push("#### TODO Verification", "", statusTable(TODO_STATUSES, t.counts), "", `**Completion Rate**: ${pct(t.completed, t.total)} (${t.completed} / ${t.total})`, "");
        for (const item of v.todoItems.filter((i) => i.status === "UNVERIFIED" || i.status === "INCOMPLETE")) {
          top.push(`[${r.repoName}] TODO ${item.status}: ${item.item}`);
        }
      }
    }

    if (r.constraints) {
      lines.push("#### Constraint Verification", "");
      if ("undeclared" in r.constraints) {
        lines.push("No constraint commands are declared for this repository, so none ran. This is missing coverage, not a pass.", "");
      } else {
        lines.push("| Constraint | Status | Exit Code | Duration |", "|------------|--------|-----------|----------|");
        for (const c of r.constraints.results) {
          lines.push(`| ${cell(c.label)} | ${c.status} | ${c.timedOut ? "timeout" : c.exitCode ?? "-"} | ${(c.durationMs / 1000).toFixed(1)}s |`);
          if (c.status === "FAIL") top.push(`[${r.repoName}] Constraint FAIL: ${c.label} (\`${c.command}\`)`);
        }
        lines.push("");
      }
    }

    if (r.fixes) {
      lines.push("#### Requested Fix Verification", "", "| # | Ask | Status |", "|---|-----|--------|", ...r.fixes.rows.map((f) => `| ${f.number} | ${cell(f.ask)} | ${f.status} |`), "");
      for (const f of r.fixes.rows.filter((f) => UNFINISHED_FIX.has(f.status))) top.push(`[${r.repoName}] Requested fix ${f.status}: ${f.ask}`);
      if (r.fixes.rows.length === 0) failed.push(`- ${r.repoName}: ${link(r.fixes.file)} has no status table to read`);
    }

    sections.push(lines.join("\n"));
  }

  if (input.crossRepository) {
    const { file, items } = input.crossRepository;
    const all = [
      ...items.critical.map((i) => ({ ...i, severity: "critical" })),
      ...items.warning.map((i) => ({ ...i, severity: "warning" })),
      ...items.suggestion.map((i) => ({ ...i, severity: "suggestion" })),
    ];
    for (const i of items.critical) top.unshift(`[cross-repository] Critical: ${i.text} (Confidence: ${i.confidence})`);
    const lines = ["## Cross-Repository", "", `- **Review File**: ${link(file)}`, "", codeReviewTable(all, items.recurring.length), ""];
    const notable = all.filter((i) => i.severity !== "suggestion");
    if (notable.length > 0) lines.push(...notable.map((f, i) => `${i + 1}. [${f.severity}] ${f.text} (Confidence: ${f.confidence})`), "");
    if (items.recurring.length > 0) lines.push("Recurring (previously accepted), excluded from the counts above:", "", ...items.recurring.map((l) => `- ${l}`), "");
    sections.push(lines.join("\n"));
  }

  return [
    "# Workspace Review Summary",
    "",
    `- **Review Date**: ${input.reviewTimestamp}`,
    `- **Repositories Reviewed**: ${input.repos.length}`,
    "",
    "## Top Priority Issues",
    "",
    ...(top.length > 0 ? top.map((t, i) => `${i + 1}. ${t}`) : ["None."]),
    "",
    "## Summary by Repository",
    "",
    sections.join("\n\n"),
    "",
    ...(failed.length > 0 ? ["## Failed Reviews", "", ...failed, ""] : []),
  ].join("\n");
}
