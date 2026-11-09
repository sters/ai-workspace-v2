/**
 * Pure helpers over verification scenarios, shared by the server and the
 * Verify tab: variable expansion, output extraction, and the renderings handed
 * to other agents (the completion verifier, the PR creator, a chat).
 */

import type { VerificationScenario, VerificationStep } from "@/types/verification";

const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Expand `{{name}}` in a command. Values are shell-quoted because they can be
 * anything a human typed; an unknown name fails the step rather than running
 * the command with a hole in it.
 */
export function expandCommand(
  command: string,
  variables: Record<string, string>,
): { ok: true; command: string } | { ok: false; error: string } {
  const missing = [...command.matchAll(VARIABLE)].map((m) => m[1]).find((n) => !(n in variables));
  if (missing) return { ok: false, error: `Unknown variable: ${missing}` };
  return { ok: true, command: command.replace(VARIABLE, (_, n: string) => shellQuote(variables[n])) };
}

/** Expand `{{name}}` in text a human reads; unknown names stay as written. */
export function expandText(text: string, variables: Record<string, string>): string {
  return text.replace(VARIABLE, (whole, n: string) => (n in variables ? variables[n] : whole));
}

export function extractOutputs(
  names: string[],
  stdout: string,
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const trimmed = stdout.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    if (names.length === 1) return { ok: true, values: { [names[0]]: trimmed } };
    return { ok: false, error: `Expected a JSON object on stdout with keys: ${names.join(", ")}` };
  }
  const obj = parsed as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const name of names) {
    if (!(name in obj)) return { ok: false, error: `Output not found on stdout: ${name}` };
    const v = obj[name];
    values[name] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return { ok: true, values };
}

/** Index of the first step that is not done; steps from here on can be edited or replanned. */
export function editableFrom(steps: VerificationStep[]): number {
  const i = steps.findIndex((s) => s.status !== "passed" && s.status !== "skipped");
  return i === -1 ? steps.length : i;
}

const VERDICT: Partial<Record<VerificationStep["status"], string>> = {
  passed: "PASS",
  failed: "NG",
  skipped: "SKIPPED",
};

/**
 * What each scenario has established so far, as Markdown for an agent. Only
 * steps with a verdict are listed; "" when no step has one.
 */
export function renderVerificationResults(scenarios: VerificationScenario[]): string {
  const sections = scenarios.flatMap((sc) => {
    const lines = sc.steps.flatMap((s) => {
      const verdict = VERDICT[s.status];
      if (!verdict || !s.result) return [];
      const parts = [`- [${s.actor}] ${verdict} — ${s.title} (${s.result.at})`];
      for (const c of s.criteria ?? []) parts.push(`  - criterion: ${c}`);
      if (s.result.note) parts.push(`  - note: ${s.result.note}`);
      return parts;
    });
    return lines.length === 0 ? [] : [`### ${sc.title} (${sc.status})\n\n${lines.join("\n")}`];
  });
  return sections.join("\n\n");
}

/** Opening message for a chat that investigates where a scenario stopped. */
export function buildVerificationChatTopic(sc: VerificationScenario): string {
  const stopped = sc.steps.find((s) => s.status === "failed" || s.status === "waiting");
  const lines = [
    `A verification scenario stopped. Look into why, and say what to change: the code, or the scenario's steps.`,
    "",
    `Scenario: ${sc.title} (artifacts/verification/${sc.id}.json)`,
  ];
  if (sc.summary) lines.push(sc.summary);
  lines.push("", "Steps:");
  sc.steps.forEach((s, i) => {
    lines.push(`${i + 1}. [${s.actor}] ${s.status} — ${s.title}${s.repo ? ` (in ${s.repo})` : ""}`);
  });
  if (stopped) {
    lines.push("", `Stopped at: ${stopped.title}`);
    if (stopped.command) lines.push("Command:", "```sh", stopped.command, "```");
    if (stopped.instructions) lines.push("Instructions:", stopped.instructions);
    if (stopped.expected) lines.push(`Expected: ${stopped.expected}`);
    if (stopped.result?.exitCode !== undefined) lines.push(`Exit code: ${stopped.result.exitCode}`);
    if (stopped.result?.output) lines.push("Output (tail):", "```", stopped.result.output, "```");
    if (stopped.result?.note) lines.push(`Note: ${stopped.result.note}`);
  }
  const vars = Object.entries(sc.variables);
  if (vars.length > 0) lines.push("", "Variables:", ...vars.map(([k, v]) => `- ${k} = ${v}`));
  if (sc.processes.length > 0) {
    lines.push("", "Still running:", ...sc.processes.map((p) => `- pid ${p.pid}: ${p.command} (log: ${p.logFile})`));
  }
  return lines.join("\n");
}
