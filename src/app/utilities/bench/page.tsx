"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { BenchRun } from "@/lib/db/bench-runs";
import type { BenchConfigSummary } from "@/lib/bench/summary";
import { Card } from "@/components/shared/containers/card";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { fetcher } from "@/lib/api";

const MODELS = ["opus", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const DEFAULT_CONFIGS = ["opus/medium", "claude-haiku-5-5/max"];

interface BenchResponse {
  steps: { stepType: string; label: string; perRepo: boolean }[];
  runs: (BenchRun & { summary: BenchConfigSummary[] })[];
}

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";
const usd = (n: number | null) => (n === null ? "-" : `$${n.toFixed(2)}`);
const secs = (ms: number | null) => (ms === null ? "-" : `${Math.round(ms / 1000)}s`);
const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text || "(no answer)";
  }
}

function BenchForm({ steps, onStarted }: { steps: BenchResponse["steps"]; onStarted: () => void }) {
  const { workspaces } = useWorkspaces();
  const [workspace, setWorkspace] = useState("");
  const [step, setStep] = useState("");
  const [repo, setRepo] = useState("");
  const [configs, setConfigs] = useState<ReadonlySet<string>>(new Set(DEFAULT_CONFIGS));
  const [reference, setReference] = useState(DEFAULT_CONFIGS[0]);
  const [repeats, setRepeats] = useState(2);
  const [message, setMessage] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const stepDef = steps.find((s) => s.stepType === step);
  const { data: repoData } = useSWR<{ repos: string[] }>(
    workspace && stepDef?.perRepo ? `/api/bench/repos?workspace=${encodeURIComponent(workspace)}` : null,
    fetcher,
  );
  const repos = useMemo(() => repoData?.repos ?? [], [repoData]);

  useEffect(() => { if (!step && steps[0]) setStep(steps[0].stepType); }, [steps, step]);
  useEffect(() => { if (repos.length > 0 && !repos.includes(repo)) setRepo(repos[0]); }, [repos, repo]);
  useEffect(() => {
    if (!configs.has(reference) && configs.size > 0) setReference([...configs][0]);
  }, [configs, reference]);

  const toggle = (key: string) =>
    setConfigs((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const attempts = configs.size * repeats;
  const canRun = workspace && stepDef && (!stepDef.perRepo || repo) && configs.size > 0 && !submitting;

  async function run() {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/operations/bench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace,
          step,
          ...(stepDef?.perRepo && { repo }),
          configs: [...configs].map((k) => {
            const [model, effort] = k.split("/");
            return { model, effort };
          }),
          reference,
          repeats,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? `Failed to start (${res.status})` });
        return;
      }
      setMessage({
        ok: true,
        text: "Bench started. Results appear below when it finishes.",
        href: `/workspace/${encodeURIComponent(workspace)}/operations?operationId=${encodeURIComponent(data.id)}`,
      });
      onStarted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Workspace</span>
          <select className={selectClass} value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
            <option value="">Select…</option>
            {workspaces.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Step</span>
          <select className={selectClass} value={step} onChange={(e) => setStep(e.target.value)}>
            {steps.map((s) => <option key={s.stepType} value={s.stepType}>{s.label} ({s.stepType})</option>)}
          </select>
        </label>
        {stepDef?.perRepo && (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Repository</span>
            <select className={selectClass} value={repo} onChange={(e) => setRepo(e.target.value)}>
              {repos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Attempts per pairing</span>
          <select className={selectClass} value={repeats} onChange={(e) => setRepeats(Number(e.target.value))}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="pr-4 text-left font-medium">Model \\ Effort</th>
              {EFFORTS.map((e) => <th key={e} className="px-2 font-medium">{e}</th>)}
            </tr>
          </thead>
          <tbody>
            {MODELS.map((m) => (
              <tr key={m}>
                <td className="pr-4 font-mono text-xs">{m}</td>
                {EFFORTS.map((e) => {
                  const key = `${m}/${e}`;
                  return (
                    <td key={e} className="px-2 text-center">
                      <input type="checkbox" aria-label={key} checked={configs.has(key)} onChange={() => toggle(key)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Reference (others are scored against it)</span>
          <select className={selectClass} value={reference} onChange={(e) => setReference(e.target.value)}>
            {[...configs].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <Button disabled={!canRun} onClick={run}>
          Run {attempts} attempt{attempts === 1 ? "" : "s"}
        </Button>
      </div>
      {message && (
        <p className={`mt-3 text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {message.text}{" "}
          {message.href && <Link className="underline" href={message.href}>Open the operation</Link>}
        </p>
      )}
    </Card>
  );
}

function BenchResult({ run, stepLabel }: { run: BenchResponse["runs"][number]; stepLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-semibold">{stepLabel}</span>
        <span className="font-mono text-xs">{run.workspace}{run.repo ? ` / ${run.repo}` : ""}</span>
        <time className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</time>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3 font-medium">Pairing</th>
              <th className="py-1 pr-3 text-right font-medium">Answered</th>
              <th className="py-1 pr-3 text-right font-medium">Avg cost</th>
              <th className="py-1 pr-3 text-right font-medium">Avg time</th>
              <th className="py-1 text-right font-medium" title="Share of the reference's verdicts reached; the reference's own row is its repeat-to-repeat agreement">Agreement</th>
            </tr>
          </thead>
          <tbody>
            {run.summary.map((s) => (
              <tr key={s.config} className="border-t border-border">
                <td className="py-1 pr-3 font-mono text-xs">{s.config}{s.config === run.reference ? " (reference)" : ""}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{s.succeeded}/{s.attempts}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{usd(s.avgCostUsd)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{secs(s.avgDurationMs)}</td>
                <td className="py-1 text-right tabular-nums">{pct(s.agreement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="mt-2 text-xs text-muted-foreground underline" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide answers" : "Show answers"}
      </button>
      {open && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {run.attempts.map((a) => (
            <div key={a.label} className="min-w-0">
              <div className="mb-1 font-mono text-xs">{a.label}{a.ok ? "" : " — failed"}</div>
              <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs">{pretty(a.text)}</pre>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function BenchPage() {
  const { data, error, isLoading, mutate } = useSWR<BenchResponse>("/api/bench", fetcher, { refreshInterval: 15_000 });
  const steps = data?.steps ?? [];
  const label = (step: string) => steps.find((s) => s.stepType === step)?.label ?? step;

  return (
    <div>
      <PageHeader
        title="Bench"
        description="Re-run one step's agent against a workspace under several model / effort pairings, and compare cost, time and agreement with a reference pairing. The agents read the workspace as it is now and change nothing; agreement counts the structured verdicts that match, and the answers are shown for the rest."
      />
      {steps.length > 0 && <BenchForm steps={steps} onStarted={() => void mutate()} />}
      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to fetch benches.</StatusText>}
      {data && data.runs.length === 0 && <StatusText>No benches yet.</StatusText>}
      <div className="grid gap-4">
        {data?.runs.map((run) => <BenchResult key={run.operationId} run={run} stepLabel={label(run.step)} />)}
      </div>
    </div>
  );
}
