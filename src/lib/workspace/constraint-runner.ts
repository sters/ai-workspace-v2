/**
 * Programmatic constraint command execution and report generation.
 * Runs lint/test/build commands and captures exit codes deterministically.
 */

import { getCleanEnv } from "@/lib/env";

export interface ConstraintExecResult {
  label: string;
  command: string;
  exitCode: number | null;
  passed: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  status: "PASS" | "FAIL" | "SKIPPED" | "PRE-EXISTING";
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_CHARS = 5000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... (truncated, ${text.length} chars total)`;
}

export async function execConstraintCommand(
  command: string,
  opts: { cwd: string; timeoutMs?: number; maxChars?: number },
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const start = performance.now();
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: getCleanEnv(),
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timer);
    const durationMs = Math.round(performance.now() - start);

    if (timedOut) {
      return { exitCode: null, stdout: "", stderr: "", timedOut: true, durationMs };
    }

    const stdout = truncate(await new Response(proc.stdout).text(), maxChars).trim();
    const stderr = truncate(await new Response(proc.stderr).text(), maxChars).trim();
    return { exitCode, stdout, stderr, timedOut: false, durationMs };
  } catch {
    clearTimeout(timer);
    const durationMs = Math.round(performance.now() - start);
    return { exitCode: null, stdout: "", stderr: "", timedOut: true, durationMs };
  }
}

/**
 * Report for a repo the README declares no constraint commands for. Written so
 * the review's constraint section distinguishes "nothing was run" from "every
 * command passed" — without it the collector sees no CONSTRAINTS-* file and
 * SUMMARY.md is simply silent, which reads as a pass.
 */
export function buildNoConstraintsReport(repoName: string): string {
  return `# Constraint Verification: ${repoName}

**Overall**: NOT DECLARED (0/0)

No lint/test/build commands are declared for this repository under \`## Repository Constraints\` in the workspace README, so none were run. Nothing mechanically verified this branch — treat this as missing coverage, not as a pass. Declaring the commands (or re-running constraint discovery) restores it for later cycles.
`;
}

export function buildConstraintReport(
  repoName: string,
  results: ConstraintExecResult[],
): string {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const allPassed = passed === total;

  let md = `# Constraint Verification: ${repoName}\n\n`;
  md += `**Overall**: ${allPassed ? "ALL PASSED" : "FAILURES DETECTED"} (${passed}/${total})\n\n`;

  for (const r of results) {
    const displayStatus = r.timedOut ? "TIMEOUT" : r.status;
    md += `## ${r.label}: ${displayStatus}\n\n`;
    md += `- **Command**: \`${r.command}\`\n`;
    md += `- **Exit Code**: ${r.exitCode ?? "N/A (timed out)"}\n`;
    md += `- **Duration**: ${r.durationMs}ms\n`;

    if (r.stdout.trim()) {
      md += `\n### stdout\n\n\`\`\`\n${r.stdout}\n\`\`\`\n\n`;
    }
    if (r.stderr.trim()) {
      md += `\n### stderr\n\n\`\`\`\n${r.stderr}\n\`\`\`\n\n`;
    }
  }

  return md;
}
