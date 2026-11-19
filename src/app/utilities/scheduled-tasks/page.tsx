"use client";

import { useState } from "react";
import useSWR from "swr";
import { OperationCard } from "@/components/workspace/operation-card";
import { Card } from "@/components/shared/containers/card";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher, killOperation, postJson } from "@/lib/api";
import type { OperationListItem } from "@/types/operation";
import type { BuiltinWorkerJob } from "@/types/worker-job";
import { SCHEDULED_TASK_OVERLAPS, type ScheduledTask, type ScheduledTaskInput } from "@/types/scheduled-task";

const inputClass = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

const OVERLAP_LABELS: Record<ScheduledTaskInput["overlap"], string> = {
  skip: "Skip — drop the occurrence while the previous run is going",
  parallel: "Parallel — start another run beside it",
  queue: "Queue — run once the previous run finishes",
};

const EMPTY: ScheduledTaskInput = { title: "", request: "", prompt: "", cron: "", overlap: "skip", enabled: false };

/** Runs and planning operations are filed under these labels in place of a workspace. */
const PLAN_LABEL = "scheduled-tasks";
const runLabel = (id: number) => `scheduled-task-${id}`;

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function OperationList({ label, limit, refreshMs }: { label: string; limit: number; refreshMs: number }) {
  const { data, mutate } = useSWR<OperationListItem[]>(
    `/api/operations?workspace=${encodeURIComponent(label)}`,
    fetcher,
    { refreshInterval: refreshMs },
  );
  const items = (data ?? []).slice(0, limit);
  if (items.length === 0) return <StatusText>No runs yet.</StatusText>;
  return (
    <div className="space-y-2">
      {items.map((op) => (
        <OperationCard
          key={op.id}
          operation={op}
          onStartOperation={async () => {}}
          onCancel={async (id) => {
            await killOperation(id);
            await mutate();
          }}
          defaultExpanded={false}
        />
      ))}
    </div>
  );
}

function TaskForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ScheduledTaskInput;
  submitLabel: string;
  onSubmit: (value: ScheduledTaskInput) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ScheduledTaskInput>(key: K, v: ScheduledTaskInput[K]) => setValue((prev) => ({ ...prev, [key]: v }));
  const invalid = !value.title.trim() || !value.prompt.trim() || !value.cron.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    try {
      setError(await onSubmit(value));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="text-sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Title</label>
          <input value={value.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Schedule (cron, server local time)</label>
            <input
              value={value.cron}
              onChange={(e) => set("cron", e.target.value)}
              placeholder="0 9 * * 1-5"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">When the previous run is still going</label>
            <select
              value={value.overlap}
              onChange={(e) => set("overlap", e.target.value as ScheduledTaskInput["overlap"])}
              className={inputClass}
            >
              {SCHEDULED_TASK_OVERLAPS.map((o) => (
                <option key={o} value={o}>{OVERLAP_LABELS[o]}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Instruction</label>
          <textarea value={value.prompt} onChange={(e) => set("prompt", e.target.value)} className={inputClass} rows={10} />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={value.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Enabled
        </label>
        {error && <StatusText variant="error">{error}</StatusText>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || invalid}>{saving ? "Saving..." : submitLabel}</Button>
          <Button variant="outline-muted" type="button" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function PlanForm({ onPlanned }: { onPlanned: () => void }) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!request.trim()) return;
    setBusy(true);
    const res = await postJson("/api/operations/plan-scheduled-task", { request: request.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRequest("");
    onPlanned();
  }

  return (
    <Card className="mb-4 text-sm">
      <form onSubmit={handleSubmit} className="space-y-2">
        <h2 className="font-semibold">Plan a task</h2>
        <p className="text-muted-foreground">
          Describe what to watch and what to do about it. An agent turns it into a schedule and an instruction; the task is saved disabled for you to review.
        </p>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. Every weekday morning, check acme/widgets for new issues labeled bug and start a workspace for any that look fixable."
          className={inputClass}
          rows={3}
        />
        {error && <StatusText variant="error">{error}</StatusText>}
        <Button type="submit" disabled={busy || !request.trim()}>{busy ? "Starting..." : "Plan"}</Button>
      </form>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">Planning runs</summary>
        <div className="mt-2">
          <OperationList label={PLAN_LABEL} limit={5} refreshMs={5000} />
        </div>
      </details>
    </Card>
  );
}

function BuiltinJobs({ jobs }: { jobs: BuiltinWorkerJob[] }) {
  return (
    <section className="mb-4">
      <h2 className="mb-2 text-sm font-semibold">Built-in</h2>
      <div className="grid gap-2">
        {jobs.map((job) => (
          <Card key={job.name} className="text-sm">
            <h3 className="font-semibold">
              {job.title}
              {!job.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">(disabled)</span>}
            </h3>
            <p className="mt-1 text-muted-foreground">{job.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {job.schedule} · last started: {formatTime(job.lastStartedAt)} · last finished: {formatTime(job.lastFinishedAt)}
              {job.toggle && <> · toggle: {job.toggle}</>}
            </p>
            {job.lastError && <StatusText variant="error">Last tick failed: {job.lastError}</StatusText>}
          </Card>
        ))}
      </div>
    </section>
  );
}

function errorMessage(res: { ok: false; error: string }): string {
  try {
    const parsed = JSON.parse(res.error) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : res.error;
  } catch {
    return res.error;
  }
}

export default function ScheduledTasksPage() {
  const { data, error, isLoading, mutate } = useSWR<{ tasks: ScheduledTask[]; builtins: BuiltinWorkerJob[] }>("/api/scheduled-tasks", fetcher, {
    refreshInterval: 10000,
  });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tasks = data?.tasks ?? [];

  async function save(url: string, body: object): Promise<string | null> {
    const res = await postJson(url, body);
    if (!res.ok) return errorMessage(res);
    await mutate();
    setCreating(false);
    setEditingId(null);
    return null;
  }

  async function toggle(task: ScheduledTask) {
    await postJson("/api/scheduled-tasks/update", { ...task, enabled: !task.enabled });
    await mutate();
  }

  async function runNow(task: ScheduledTask) {
    const res = await postJson("/api/scheduled-tasks/run", { id: task.id });
    setNotice(res.ok ? `Started "${task.title}".` : errorMessage(res));
  }

  async function handleDelete(task: ScheduledTask) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await postJson("/api/scheduled-tasks/delete", { id: task.id });
    await mutate();
  }

  return (
    <div>
      <PageHeader
        title="Scheduled Tasks"
        description="Run an instruction on a schedule. Each run reads workspaces and GitHub, may start operations, and sends its summary as a push notification."
        action={
          !creating ? (
            <Button variant="outline-muted" onClick={() => { setCreating(true); setEditingId(null); }}>
              New Task
            </Button>
          ) : undefined
        }
      />

      {data && <BuiltinJobs jobs={data.builtins} />}

      <PlanForm onPlanned={() => setNotice("Planning started. The task appears below, disabled, when it finishes.")} />

      {notice && <StatusText>{notice}</StatusText>}

      {creating && (
        <div className="mb-4">
          <TaskForm initial={EMPTY} submitLabel="Create" onSubmit={(v) => save("/api/scheduled-tasks", v)} onCancel={() => setCreating(false)} />
        </div>
      )}

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to fetch scheduled tasks.</StatusText>}
      {!isLoading && !error && tasks.length === 0 && !creating && <StatusText>No scheduled tasks yet.</StatusText>}

      <div className="mt-2 grid gap-2">
        {tasks.map((task) =>
          editingId === task.id ? (
            <TaskForm
              key={task.id}
              initial={task}
              submitLabel="Update"
              onSubmit={(v) => save("/api/scheduled-tasks/update", { id: task.id, ...v })}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <Card key={task.id} className="text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">
                    {task.title}
                    {!task.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">(disabled)</span>}
                    {task.queued && <span className="ml-2 text-xs font-normal text-muted-foreground">(queued)</span>}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <code>{task.cron}</code> · overlap: {task.overlap} · next: {formatTime(task.nextRunAt)} · last: {formatTime(task.lastRunAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline-muted" onClick={() => toggle(task)}>{task.enabled ? "Disable" : "Enable"}</Button>
                  <Button variant="outline-muted" onClick={() => runNow(task)}>Run now</Button>
                  <Button variant="outline-muted" onClick={() => { setEditingId(task.id); setCreating(false); }}>Edit</Button>
                  <Button variant="destructive-sm" onClick={() => handleDelete(task)}>Delete</Button>
                </div>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Instruction</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{task.prompt}</pre>
                {task.request && (
                  <p className="mt-2 text-xs text-muted-foreground">Requested as: {task.request}</p>
                )}
              </details>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Runs</summary>
                <div className="mt-2">
                  <OperationList label={runLabel(task.id)} limit={10} refreshMs={10000} />
                </div>
              </details>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}
