"use client";

import { useState } from "react";
import useSWR from "swr";
import type { ChatStartPrompt } from "@/types/chat-start-prompt";
import { Card } from "@/components/shared/containers/card";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher, postJson } from "@/lib/api";

interface ChatStartPromptsResponse {
  prompts: ChatStartPrompt[];
  basePrompt: string;
  systemPrompt: string;
}

const inputClass = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

function PromptForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { title: string; content: string };
  submitLabel: string;
  onSubmit: (value: { title: string; content: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [saving, setSaving] = useState(false);
  const invalid = !title.trim() || !content.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    try {
      await onSubmit({ title: title.trim(), content: content.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="text-sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Shown on the Start Chat menu, e.g. Triage CI failures"
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What the session should start by doing, e.g. Check the failing CI checks on this workspace's PRs and propose fixes."
            className={inputClass}
            rows={5}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || invalid}>
            {saving ? "Saving..." : submitLabel}
          </Button>
          <Button variant="outline-muted" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function ChatStartPromptsPage() {
  const { data, error, isLoading, mutate } = useSWR<ChatStartPromptsResponse>(
    "/api/chat-start-prompts",
    fetcher,
  );
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const prompts = data?.prompts ?? [];

  async function handleDelete(id: number) {
    if (!confirm("Delete this chat start prompt?")) return;
    await postJson("/api/chat-start-prompts/delete", { id });
    await mutate();
  }

  return (
    <div>
      <PageHeader
        title="Chat Start Prompts"
        description="Start an Interactive Chat with a saved instruction. Each prompt appears in the Start Chat menu under its title."
        action={
          !creating ? (
            <Button variant="outline-muted" onClick={() => { setCreating(true); setEditingId(null); }}>
              New Prompt
            </Button>
          ) : undefined
        }
      />

      {data && (
        <Card className="mb-4 text-sm">
          <h2 className="font-semibold">Common prompt (read-only)</h2>
          <p className="mt-1 text-muted-foreground">
            Every session started from the menu opens with this message, with the selected prompt&apos;s content in place of the placeholder at the end.
          </p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
            {data.basePrompt}
          </pre>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">System prompt</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {data.systemPrompt}
            </pre>
          </details>
        </Card>
      )}

      {creating && (
        <div className="mb-4">
          <PromptForm
            initial={{ title: "", content: "" }}
            submitLabel="Create"
            onSubmit={async (value) => {
              await postJson("/api/chat-start-prompts", value);
              await mutate();
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to fetch chat start prompts.</StatusText>}

      {!isLoading && !error && prompts.length === 0 && !creating && (
        <StatusText>No chat start prompts yet. Create one to get started.</StatusText>
      )}

      {prompts.length > 0 && (
        <div className="grid gap-2">
          {prompts.map((prompt) =>
            editingId === prompt.id ? (
              <PromptForm
                key={prompt.id}
                initial={prompt}
                submitLabel="Update"
                onSubmit={async (value) => {
                  await postJson("/api/chat-start-prompts/update", { id: prompt.id, ...value });
                  await mutate();
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <Card key={prompt.id} className="text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{prompt.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{prompt.content}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline-muted" onClick={() => { setEditingId(prompt.id); setCreating(false); }}>
                      Edit
                    </Button>
                    <Button variant="destructive-sm" onClick={() => handleDelete(prompt.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}
