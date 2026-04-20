"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Snippet } from "@/types/snippet";
import { Card } from "@/components/shared/containers/card";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher, postJson } from "@/lib/api";

interface SnippetsResponse {
  snippets: Snippet[];
}

function SnippetEditForm({
  snippet,
  onSaved,
  onCancel,
}: {
  snippet: Snippet;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(snippet.title);
  const [content, setContent] = useState(snippet.content);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await postJson("/api/snippets/update", { id: snippet.id, title: title.trim(), content: content.trim() });
      onSaved();
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
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            rows={4}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !title.trim() || !content.trim()}>
            {saving ? "Saving..." : "Update"}
          </Button>
          <Button variant="outline-muted" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function SnippetsPage() {
  const { data, error, isLoading, mutate } = useSWR<SnippetsResponse>(
    "/api/snippets",
    fetcher,
  );

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const snippets = data?.snippets ?? [];

  function cancelCreate() {
    setShowCreateForm(false);
    setCreateTitle("");
    setCreateContent("");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createTitle.trim() || !createContent.trim()) return;
    setCreating(true);
    try {
      await postJson("/api/snippets", { title: createTitle.trim(), content: createContent.trim() });
      await mutate();
      cancelCreate();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this snippet?")) return;
    await postJson("/api/snippets/delete", { id });
    await mutate();
  }

  return (
    <div>
      <PageHeader
        title="Snippets"
        description="Save and manage reusable text snippets for workspace descriptions."
        action={
          !showCreateForm ? (
            <Button variant="outline-muted" onClick={() => { setShowCreateForm(true); setEditingId(null); }}>
              New Snippet
            </Button>
          ) : undefined
        }
      />

      {showCreateForm && (
        <Card className="mb-4">
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Title</label>
              <input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="Snippet title"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Content</label>
              <textarea
                value={createContent}
                onChange={(e) => setCreateContent(e.target.value)}
                placeholder="Snippet content to insert into workspace description..."
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={creating || !createTitle.trim() || !createContent.trim()}>
                {creating ? "Creating..." : "Create"}
              </Button>
              <Button variant="outline-muted" type="button" onClick={cancelCreate}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to fetch snippets.</StatusText>}

      {!isLoading && !error && snippets.length === 0 && !showCreateForm && (
        <StatusText>No snippets yet. Create one to get started.</StatusText>
      )}

      {snippets.length > 0 && (
        <div className="grid gap-2">
          {snippets.map((snippet) =>
            editingId === snippet.id ? (
              <SnippetEditForm
                key={snippet.id}
                snippet={snippet}
                onSaved={() => { setEditingId(null); mutate(); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <Card key={snippet.id} className="text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{snippet.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {snippet.content}
                    </p>
                    <time
                      className="mt-1 block text-xs text-muted-foreground"
                      dateTime={snippet.updatedAt}
                    >
                      {new Date(snippet.updatedAt).toLocaleString()}
                    </time>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline-muted" onClick={() => { setEditingId(snippet.id); setShowCreateForm(false); }}>
                      Edit
                    </Button>
                    <Button variant="destructive-sm" onClick={() => handleDelete(snippet.id)}>
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
