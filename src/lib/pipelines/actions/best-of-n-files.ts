/**
 * Parallel Best-of-N for file-based operations (TODO updates, plan-todo, etc.).
 * Creates N temporary directories, runs candidates in parallel via
 * ctx.runChildGroup, then uses AI reviewer to select or synthesize.
 */

import { mkdirSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PhaseFunctionContext, GroupChild } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";
import {
  buildBestOfNFileReviewerPrompt,
  buildBestOfNFileSynthesizerPrompt,
  BEST_OF_N_REVIEW_SCHEMA,
} from "@/lib/templates";

export interface BestOfNFilesInput {
  ctx: PhaseFunctionContext;
  n: number;
  operationType: string;
  /** Absolute paths to files to capture and compare between candidates. */
  filesToCapture: string[];
  /**
   * Build GroupChild(ren) for one candidate.
   * @param candidateDir - temp directory containing copies of filesToCapture
   *   (preserving their relative structure from their common parent).
   * @param candidateLabel - e.g. "candidate-1"
   */
  buildChildren: (candidateDir: string, candidateLabel: string) => GroupChild[];
  /** When true, ask user to confirm before starting Best-of-N. */
  confirm?: boolean;
  /** Fallback to run when user declines Best-of-N. */
  runNormal?: (ctx: PhaseFunctionContext) => Promise<boolean>;
  /** When "high", ask user to confirm/override AI reviewer's decision. */
  interactionLevel?: InteractionLevel;
}

/** Find the longest common parent directory for a set of absolute paths. */
function findCommonParent(paths: string[]): string {
  if (paths.length === 0) return "/";
  const parts = paths.map((p) => p.split(path.sep));
  const common: string[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    const seg = parts[0][i];
    if (parts.every((p) => p[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }
  return common.join(path.sep) || "/";
}

/**
 * Run an operation N times in parallel, each in its own temp directory.
 * Shows results and lets user compare and pick.
 */
export async function runBestOfNFiles(input: BestOfNFilesInput): Promise<boolean> {
  const { ctx, n, operationType, filesToCapture, buildChildren, confirm, runNormal, interactionLevel } = input;

  // Confirmation ask
  if (confirm) {
    const answers = await ctx.emitAsk([
      {
        question: `Best-of-N mode is enabled (${n} candidates). Use it for this ${operationType}?`,
        options: [
          { label: "Use Best-of-N", description: `Run ${n} candidates in parallel and compare results` },
          { label: "Normal execution", description: `Run single ${operationType} without Best-of-N` },
        ],
      },
    ]);
    if (Object.values(answers)[0] !== "Use Best-of-N") {
      ctx.emitStatus("Best-of-N skipped — running normal execution");
      if (runNormal) return runNormal(ctx);
      return true;
    }
  }

  ctx.emitStatus(`Running ${n} ${operationType} candidates in parallel`);

  // Determine common parent and relative paths
  const commonParent = findCommonParent(filesToCapture);
  const relativePaths = filesToCapture.map((f) => path.relative(commonParent, f));

  // Save originals for comparison
  const originals = new Map<string, string>();
  for (const p of filesToCapture) {
    if (existsSync(p)) {
      originals.set(p, readFileSync(p, "utf-8"));
    }
  }

  // Create temp dirs and copy files
  const tmpBase = path.join(tmpdir(), `bon-files-${Date.now()}`);
  const candidateDirs: string[] = [];
  for (let i = 0; i < n; i++) {
    const dir = path.join(tmpBase, `candidate-${i + 1}`);
    for (const relPath of relativePaths) {
      const src = path.join(commonParent, relPath);
      const dst = path.join(dir, relPath);
      mkdirSync(path.dirname(dst), { recursive: true });
      if (existsSync(src)) {
        copyFileSync(src, dst);
      }
    }
    candidateDirs.push(dir);
  }

  try {
    // Build children for each candidate and flatten
    const allChildren: GroupChild[] = [];
    const candidateChildCounts: number[] = [];
    for (let i = 0; i < n; i++) {
      const candidateLabel = `candidate-${i + 1}`;
      const children = buildChildren(candidateDirs[i], candidateLabel);
      // Prefix labels with candidate label
      const prefixed = children.map((c) => ({
        ...c,
        label: `[${candidateLabel}] ${c.label}`,
      }));
      allChildren.push(...prefixed);
      candidateChildCounts.push(prefixed.length);
    }

    // Run all candidates in parallel
    const results = await ctx.runChildGroup(allChildren);

    // Determine per-candidate success
    let offset = 0;
    interface CandidateResult {
      label: string;
      ok: boolean;
      dir: string;
    }
    const candidateResults: CandidateResult[] = [];
    for (let i = 0; i < n; i++) {
      const count = candidateChildCounts[i];
      const candidateOk = results.slice(offset, offset + count).every(Boolean);
      candidateResults.push({
        label: `candidate-${i + 1}`,
        ok: candidateOk,
        dir: candidateDirs[i],
      });
      ctx.emitStatus(`[candidate-${i + 1}] ${candidateOk ? "Completed successfully" : "Failed"}`);
      offset += count;
    }

    const successful = candidateResults.filter((c) => c.ok);

    if (successful.length === 0) {
      ctx.emitResult(`**Best-of-N ${operationType}: All candidates failed.**`);
      return false;
    }

    if (successful.length === 1) {
      copyResultFiles(successful[0].dir, commonParent, relativePaths);
      ctx.emitStatus(`Only one candidate succeeded (${successful[0].label}) — auto-selected`);
      return true;
    }

    // Collect file contents from each successful candidate for review
    const reviewCandidates = successful.map((c) => {
      const files: { name: string; content: string }[] = [];
      for (const relPath of relativePaths) {
        const filePath = path.join(c.dir, relPath);
        if (existsSync(filePath)) {
          files.push({ name: path.basename(relPath), content: readFileSync(filePath, "utf-8") });
        }
      }
      return { label: c.label, files };
    });

    // Run AI reviewer
    ctx.emitStatus(`Running AI reviewer to compare ${successful.length} candidates`);
    const reviewPrompt = buildBestOfNFileReviewerPrompt({
      operationType,
      candidates: reviewCandidates,
    });

    let reviewResultText: string | undefined;
    const reviewOk = await ctx.runChild("Best-of-N File Reviewer", reviewPrompt, {
      jsonSchema: BEST_OF_N_REVIEW_SCHEMA as unknown as Record<string, unknown>,
      onResultText: (text) => { reviewResultText = text; },
    });

    if (!reviewOk) {
      // Fallback: use first successful candidate
      ctx.emitStatus("Reviewer failed — using first successful candidate");
      copyResultFiles(successful[0].dir, commonParent, relativePaths);
      return true;
    }

    // Parse reviewer decision
    let action: "select" | "synthesize" = "select";
    let candidateNum = 1;
    let sources: number[] = [];
    let reasoning = "";
    try {
      const decision = JSON.parse(reviewResultText ?? "{}");
      action = decision.action ?? "select";
      candidateNum = decision.candidate ?? 1;
      sources = decision.sources ?? [];
      reasoning = decision.reasoning ?? "";
    } catch {
      ctx.emitStatus("Failed to parse reviewer result — using first successful candidate");
      copyResultFiles(successful[0].dir, commonParent, relativePaths);
      return true;
    }

    ctx.emitResult(`**Best-of-N Reviewer:** ${action} — ${reasoning}`);

    // When interactionLevel is "high", let user confirm or override
    if (interactionLevel === "high") {
      const confirmAnswers = await ctx.emitAsk([{
        question: `Reviewer chose to ${action} (candidate-${candidateNum}). Accept?`,
        options: [
          { label: "Accept", description: `Accept reviewer's ${action} decision` },
          ...successful.map((c) => ({
            label: `Override: pick ${c.label}`,
            description: `Use ${c.label} instead`,
          })),
        ],
      }]);
      const confirmAnswer = Object.values(confirmAnswers)[0];
      if (confirmAnswer && confirmAnswer !== "Accept") {
        const match = confirmAnswer.match(/Override: pick candidate-(\d+)/);
        if (match) {
          const overrideIdx = parseInt(match[1], 10) - 1;
          const selected = successful[overrideIdx] ?? successful[0];
          copyResultFiles(selected.dir, commonParent, relativePaths);
          ctx.emitStatus(`Human override: applied ${selected.label}`);
          return true;
        }
      }
    }

    if (action === "select") {
      const selected = successful[candidateNum - 1] ?? successful[0];
      copyResultFiles(selected.dir, commonParent, relativePaths);
      ctx.emitStatus(`Reviewer selected ${selected.label}`);
      return true;
    }

    // Synthesize: run synthesizer child with access to output dir
    ctx.emitStatus("Running synthesizer to merge candidate results");
    const fileNames = relativePaths.map((r) => path.basename(r));
    const synthPrompt = buildBestOfNFileSynthesizerPrompt({
      operationType,
      candidates: reviewCandidates,
      baseCandidate: candidateNum,
      sources,
      outputDir: commonParent,
      fileNames,
    });

    const synthOk = await ctx.runChild("Best-of-N Synthesizer", synthPrompt, {
      addDirs: [commonParent, ...successful.map((c) => c.dir)],
    });

    if (!synthOk) {
      // Fallback: use the base candidate
      ctx.emitStatus("Synthesizer failed — falling back to base candidate");
      const selected = successful[candidateNum - 1] ?? successful[0];
      copyResultFiles(selected.dir, commonParent, relativePaths);
    } else {
      ctx.emitStatus("Synthesized result applied");
    }
    return true;
  } finally {
    // Cleanup temp dirs
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

/** Copy result files from candidate dir back to the original locations. */
function copyResultFiles(candidateDir: string, commonParent: string, relativePaths: string[]): void {
  for (const relPath of relativePaths) {
    const src = path.join(candidateDir, relPath);
    const dst = path.join(commonParent, relPath);
    if (existsSync(src)) {
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
  }
}
