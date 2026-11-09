"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  User,
  Wand2,
} from "lucide-react";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { useVerificationScenarios } from "@/hooks/use-workspace";
import { Button } from "../shared/buttons/button";
import { Callout } from "../shared/containers/callout";
import { Card } from "../shared/containers/card";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { StatusBadge } from "../shared/feedback/status-badge";
import { StatusText } from "../shared/feedback/status-text";
import { Input } from "../shared/forms/input";
import { Textarea } from "../shared/forms/textarea";
import { chatPagePath, stashChatHandoff } from "@/lib/chat-handoff";
import { buildVerificationChatTopic, editableFrom, expandText } from "@/lib/verification/model";
import { cn } from "@/lib/utils";
import type {
  VerificationScenario,
  VerificationStep,
  VerificationStepDraft,
} from "@/types/verification";

const BADGE: Record<string, string> = {
  ready: "muted",
  pending: "muted",
  running: "op-running",
  waiting: "op-asking",
  failed: "op-failed",
  passed: "op-completed",
  skipped: "muted",
  aborted: "muted",
};

/**
 * The workspace's verification scenarios: one per flow to check in the running
 * software, each an ordered list of steps that Claude runs and people answer.
 * Laid out like Artifacts and Changes — the scenarios on the left, the selected
 * one's steps on the right — with the selection in `?scenario=`.
 */
export function VerificationBrowser({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { scenarios, isLoading, refresh } = useVerificationScenarios(workspaceName);
  const selectedId = searchParams.get("scenario") ?? scenarios[0]?.id ?? null;
  const selected = scenarios.find((s) => s.id === selectedId) ?? null;

  const select = (id: string) => {
    router.replace(
      `/workspace/${encodeURIComponent(workspaceName)}/verify?scenario=${encodeURIComponent(id)}`,
      { scroll: false },
    );
  };

  if (isLoading && scenarios.length === 0) return <StatusText>Loading...</StatusText>;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(14rem,20rem)_1fr]">
      <div className="space-y-4">
        {scenarios.length > 0 && (
          <Card variant="flush" className="h-fit overflow-hidden py-1">
            <ul className="text-sm">
              {scenarios.map((sc) => (
                <li key={sc.id}>
                  <button
                    type="button"
                    onClick={() => select(sc.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent",
                      sc.id === selected?.id && "bg-accent font-medium",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{sc.title}</span>
                    <StatusBadge label={sc.status} variant={BADGE[sc.status]} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <PlanForm workspaceName={workspaceName} hasScenarios={scenarios.length > 0} />
      </div>

      <div className="min-w-0">
        {selected ? (
          <ScenarioView key={selected.id} workspaceName={workspaceName} scenario={selected} refresh={refresh} />
        ) : (
          <StatusText>
            No verification scenarios yet. Plan them from the README and the changes, then run them here.
          </StatusText>
        )}
      </div>
    </div>
  );
}

function PlanForm({ workspaceName, hasScenarios }: { workspaceName: string; hasScenarios: boolean }) {
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const [instruction, setInstruction] = useState("");
  return (
    <Card className="space-y-2">
      <p className="text-sm font-medium">{hasScenarios ? "Plan more scenarios" : "Plan scenarios"}</p>
      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Optional: what to check, or how to start the app"
        rows={3}
      />
      <Button
        onClick={async () => {
          if (await startAndNavigate("plan-verification", { workspace: workspaceName, instruction })) setInstruction("");
        }}
      >
        <Wand2 className="h-3.5 w-3.5" />
        Plan with Claude
      </Button>
    </Card>
  );
}

type Action =
  | { action: "run" }
  | { action: "abort" }
  | { action: "answer"; stepId: string; verdict: "ok" | "ng"; note?: string; values?: Record<string, string> }
  | { action: "rerun"; stepId: string }
  | { action: "skip"; stepId: string }
  | { action: "edit"; steps: VerificationStepDraft[] };

function ScenarioView({
  workspaceName,
  scenario: sc,
  refresh,
}: {
  workspaceName: string;
  scenario: VerificationScenario;
  refresh: () => Promise<unknown>;
}) {
  const router = useRouter();
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [replanText, setReplanText] = useState<string | null>(null);
  const url = `/api/workspaces/${encodeURIComponent(workspaceName)}/verification/${encodeURIComponent(sc.id)}`;
  const running = sc.status === "running";
  const finished = sc.status === "passed" || sc.status === "aborted";

  const act = async (body: Action): Promise<boolean> => {
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? res.statusText);
    }
    await refresh();
    return res.ok;
  };

  const remove = async () => {
    setError(null);
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) setError(res.statusText);
    router.replace(`/workspace/${encodeURIComponent(workspaceName)}/verify`, { scroll: false });
    await refresh();
  };

  const investigate = () => {
    stashChatHandoff(workspaceName, { discussion: buildVerificationChatTopic(sc) });
    router.push(chatPagePath(workspaceName));
  };

  const stopped = sc.status === "failed" || sc.status === "waiting";
  const hasPending = sc.steps.some((s) => s.status === "pending" && !s.teardown);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{sc.title}</h2>
            <StatusBadge label={sc.status} variant={BADGE[sc.status]} />
          </div>
          {sc.summary && <p className="text-sm text-muted-foreground">{sc.summary}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sc.status === "ready" && hasPending && (
            <Button onClick={() => act({ action: "run" })}>
              <Play className="h-3.5 w-3.5" />
              {sc.steps.some((s) => s.status === "passed") ? "Continue" : "Run"}
            </Button>
          )}
          {!finished && !running && !editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit steps
            </Button>
          )}
          {!finished && !running && (
            <Button variant="outline" onClick={() => setReplanText((v) => (v === null ? "" : null))}>
              <Wand2 className="h-3.5 w-3.5" />
              Replan from here
            </Button>
          )}
          {stopped && (
            <Button variant="outline" onClick={investigate}>
              <MessageSquare className="h-3.5 w-3.5" />
              Investigate in chat
            </Button>
          )}
          {(running || stopped || sc.processes.length > 0) && (
            <Button variant="destructive-sm" onClick={() => act({ action: "abort" })}>
              <Square className="h-3.5 w-3.5" />
              Abort and tear down
            </Button>
          )}
          {!running && (
            <Button variant="destructive-sm" onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && <Callout variant="error" className="text-sm">{error}</Callout>}

      {replanText !== null && (
        <Card className="space-y-2">
          <p className="text-sm">
            Claude rewrites the steps from the first unfinished one on, from the results and notes so far. Finished steps,
            variables and running processes are kept.
          </p>
          <Textarea
            value={replanText}
            onChange={(e) => setReplanText(e.target.value)}
            placeholder="What changed, or what to do differently"
            rows={3}
          />
          <Button
            onClick={() =>
              startAndNavigate("plan-verification", { workspace: workspaceName, scenarioId: sc.id, instruction: replanText })
            }
          >
            Replan
          </Button>
        </Card>
      )}

      {sc.processes.length > 0 && (
        <Card className="space-y-1 text-xs">
          <p className="font-medium">Running in the background</p>
          {sc.processes.map((p) => (
            <p key={p.pid} className="font-mono text-muted-foreground">
              pid {p.pid} · {p.command.split("\n")[0]} · {p.logFile}
            </p>
          ))}
        </Card>
      )}

      {Object.keys(sc.variables).length > 0 && (
        <Card className="space-y-1 text-xs">
          <p className="font-medium">Variables</p>
          {Object.entries(sc.variables).map(([k, v]) => (
            <p key={k} className="font-mono">
              <span className="text-muted-foreground">{k}</span> = {v}
            </p>
          ))}
        </Card>
      )}

      {editing ? (
        <StepsEditor
          scenario={sc}
          onCancel={() => setEditing(false)}
          onSave={async (steps) => {
            if (await act({ action: "edit", steps })) setEditing(false);
          }}
        />
      ) : (
        <ol className="space-y-2">
          {sc.steps.map((step, i) => (
            <StepCard
              key={step.id}
              index={i}
              step={step}
              variables={sc.variables}
              scenarioRunning={running}
              act={act}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepCard({
  index,
  step,
  variables,
  scenarioRunning,
  act,
}: {
  index: number;
  step: VerificationStep;
  variables: Record<string, string>;
  scenarioRunning: boolean;
  act: (body: Action) => Promise<boolean>;
}) {
  const Icon = step.actor === "human" ? User : Bot;
  const r = step.result;
  return (
    <li>
      <Card
        className={cn(
          "space-y-2",
          step.status === "waiting" && "border-orange-400 dark:border-orange-600",
          step.status === "failed" && "border-destructive/60",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-5 text-right text-muted-foreground">{index + 1}</span>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={step.actor} />
          <span className="font-medium">{step.title}</span>
          <StatusBadge label={step.status} variant={BADGE[step.status]} />
          {step.teardown && <StatusBadge label="teardown" variant="muted" />}
          {step.background && <StatusBadge label="background" variant="muted" />}
          {step.repo && <span className="text-xs text-muted-foreground">in {step.repo}</span>}
          {step.revision > 0 && <span className="text-xs text-muted-foreground">rev {step.revision}</span>}
        </div>

        {step.command && <Code>{step.command}</Code>}
        {step.readyCommand && (
          <p className="text-xs text-muted-foreground">
            Ready when <code className="font-mono">{step.readyCommand}</code> succeeds
          </p>
        )}
        {step.outputs && step.outputs.length > 0 && (
          <p className="text-xs text-muted-foreground">Sets: {step.outputs.join(", ")}</p>
        )}
        {step.instructions && (
          <div className="text-sm">
            <MarkdownRenderer content={expandText(step.instructions, variables)} />
          </div>
        )}
        {step.expected && (
          <p className="text-sm">
            <span className="text-muted-foreground">Expected: </span>
            {expandText(step.expected, variables)}
          </p>
        )}
        {step.criteria && step.criteria.length > 0 && (
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {step.criteria.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}

        {r && (
          <div className="space-y-1 text-xs">
            <p className="text-muted-foreground">
              {new Date(r.at).toLocaleString()}
              {r.exitCode !== undefined && ` · exit ${r.exitCode ?? "—"}`}
              {r.durationMs !== undefined && ` · ${(r.durationMs / 1000).toFixed(1)}s`}
            </p>
            {r.note && <p>{r.note}</p>}
            {r.values && (
              <p className="font-mono">
                {Object.entries(r.values).map(([k, v]) => `${k}=${v}`).join("  ")}
              </p>
            )}
            {r.output && (
              <details open={step.status === "failed"}>
                <summary className="cursor-pointer text-muted-foreground">Output</summary>
                <Code>{r.output}</Code>
              </details>
            )}
          </div>
        )}

        {step.status === "waiting" && <HumanAnswer step={step} act={act} />}

        {!scenarioRunning && (step.status === "failed" || step.status === "waiting") && (
          <div className="flex gap-1.5">
            <Button variant="outline" onClick={() => act({ action: "rerun", stepId: step.id })}>
              <RotateCcw className="h-3.5 w-3.5" />
              Rerun from here
            </Button>
            <Button variant="outline" onClick={() => act({ action: "skip", stepId: step.id })}>
              Skip and continue
            </Button>
          </div>
        )}
        {!scenarioRunning && (step.status === "passed" || step.status === "skipped") && !step.teardown && (
          <Button variant="ghost" onClick={() => act({ action: "rerun", stepId: step.id })}>
            Rerun from here
          </Button>
        )}
      </Card>
    </li>
  );
}

function HumanAnswer({ step, act }: { step: VerificationStep; act: (body: Action) => Promise<boolean> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const answer = (verdict: "ok" | "ng") => act({ action: "answer", stepId: step.id, verdict, note, values });
  return (
    <div className="space-y-2 rounded-md bg-muted/50 p-2">
      {(step.inputs ?? []).map((input) => (
        <label key={input.name} className="flex flex-col gap-1 text-sm">
          {input.label}
          {input.options ? (
            <select
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
              value={values[input.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [input.name]: e.target.value }))}
            >
              <option value="">—</option>
              {input.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <Input
              value={values[input.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [input.name]: e.target.value }))}
            />
          )}
        </label>
      ))}
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (what you saw)" rows={2} />
      <div className="flex gap-1.5">
        <Button onClick={() => answer("ok")}>OK</Button>
        <Button variant="destructive" onClick={() => answer("ng")}>NG</Button>
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs">
      {children}
    </pre>
  );
}

function toDraft(s: VerificationStep): VerificationStepDraft {
  const { id: _id, status: _status, revision: _revision, result: _result, ...draft } = s;
  return draft;
}

/** One input per line: `name | label` or `name | label | option, option`. */
function formatInputs(inputs: VerificationStepDraft["inputs"]): string {
  return (inputs ?? [])
    .map((i) => [i.name, i.label, ...(i.options ? [i.options.join(", ")] : [])].join(" | "))
    .join("\n");
}

function parseInputs(text: string): VerificationStepDraft["inputs"] {
  const inputs = text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, label, options] = line.split("|").map((p) => p.trim());
    const opts = options?.split(",").map((o) => o.trim()).filter(Boolean);
    return { name, label: label || name, ...(opts && opts.length > 0 && { options: opts }) };
  });
  return inputs.length > 0 ? inputs : undefined;
}

function splitList(text: string, sep: RegExp): string[] | undefined {
  const items = text.split(sep).map((t) => t.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Edits the steps from the first unfinished one on; the finished ones above
 * stay as they ran. Saving resets the edited steps to pending.
 */
function StepsEditor({
  scenario,
  onCancel,
  onSave,
}: {
  scenario: VerificationScenario;
  onCancel: () => void;
  onSave: (steps: VerificationStepDraft[]) => Promise<void>;
}) {
  const from = editableFrom(scenario.steps);
  // Rows carry a key of their own: the list-valued fields are edited as text and
  // parsed on blur, so a row's inputs must follow it when it moves.
  const [rows, setRows] = useState(() =>
    scenario.steps.slice(from).map((s) => ({ key: s.id, d: toDraft(s) })),
  );
  const drafts = rows.map((r) => r.d);

  const update = (i: number, patch: Partial<VerificationStepDraft>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, d: { ...r.d, ...patch } } : r)));
  const move = (i: number, by: number) =>
    setRows((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="space-y-2">
      {from > 0 && (
        <p className="text-xs text-muted-foreground">
          Steps 1–{from} are done and stay as they ran.
        </p>
      )}
      {drafts.map((d, i) => (
        <Card key={rows[i].key} className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-right text-muted-foreground">{from + i + 1}</span>
            <Input className="min-w-0 flex-1" value={d.title} onChange={(e) => update(i, { title: e.target.value })} />
            <select
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              value={d.actor}
              onChange={(e) => update(i, { actor: e.target.value as VerificationStepDraft["actor"] })}
            >
              <option value="claude">Claude</option>
              <option value="human">Human</option>
            </select>
            <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="p-1 hover:text-foreground">
              <ArrowUp className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="p-1 hover:text-foreground">
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Delete step"
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
              className="p-1 text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {d.actor === "claude" ? (
            <>
              <Textarea
                className="font-mono text-xs"
                value={d.command ?? ""}
                onChange={(e) => update(i, { command: e.target.value || undefined })}
                placeholder="Command (sh -c), {{variable}} for values"
                rows={2}
              />
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={d.repo ?? ""}
                  onChange={(e) => update(i, { repo: e.target.value || undefined })}
                  placeholder="Worktree (empty = workspace)"
                />
                <Input
                  className="min-w-0 flex-1"
                  defaultValue={d.outputs?.join(", ") ?? ""}
                  onBlur={(e) => update(i, { outputs: splitList(e.target.value, /,/) })}
                  placeholder="Outputs: name, name"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!!d.background}
                    onChange={(e) => update(i, { background: e.target.checked || undefined })}
                  />
                  Background
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!!d.teardown}
                    onChange={(e) => update(i, { teardown: e.target.checked || undefined })}
                  />
                  Teardown
                </label>
                {d.background && (
                  <Input
                    className="min-w-0 flex-1 font-mono text-xs"
                    value={d.readyCommand ?? ""}
                    onChange={(e) => update(i, { readyCommand: e.target.value || undefined })}
                    placeholder="Ready check, e.g. curl -sf localhost:3000"
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <Textarea
                value={d.instructions ?? ""}
                onChange={(e) => update(i, { instructions: e.target.value || undefined })}
                placeholder="Instructions (Markdown), {{variable}} for values"
                rows={3}
              />
              <Textarea
                className="font-mono text-xs"
                defaultValue={formatInputs(d.inputs)}
                onBlur={(e) => update(i, { inputs: parseInputs(e.target.value) })}
                placeholder={"Inputs, one per line: name | label | option, option"}
                rows={2}
              />
            </>
          )}
          <Input
            className="w-full"
            value={d.expected ?? ""}
            onChange={(e) => update(i, { expected: e.target.value || undefined })}
            placeholder="Expected result"
          />
          <Textarea
            className="text-xs"
            defaultValue={d.criteria?.join("\n") ?? ""}
            onBlur={(e) => update(i, { criteria: splitList(e.target.value, /\n/) })}
            placeholder="Acceptance criteria this step establishes, one per line"
            rows={1}
          />
        </Card>
      ))}
      <div className="flex gap-1.5">
        <Button variant="outline" onClick={() => setRows((all) => [...all, { key: crypto.randomUUID(), d: { title: "New step", actor: "claude" } }])}>
          <Plus className="h-3.5 w-3.5" />
          Add step
        </Button>
        <Button onClick={() => onSave(drafts)}>Save</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
