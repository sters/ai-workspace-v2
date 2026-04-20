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

export default function SnippetsPage() {
  const { data, error, isLoading, mutate } = useSWR<SnippetsResponse>(
    "/api/snippets",
    fetcher,
  );

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const snippets = data?.snippets ?? [];

  function openCreateForm() {
    setEditingId(null);
    setTitle("");
    setContent("");
    setShowForm(true);
  }

  function openEditForm(snippet: Snippet) {
    setEditingId(snippet.id);
    setTitle(snippet.title);
    setContent(snippet.content);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setTitle("");
    setContent("");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (editingId !== null) {
        await postJson("/api/snippets/update", { id: editingId, title: title.trim(), content: content.trim() });
      } else {
        await postJson("/api/snippets", { title: title.trim(), content: content.trim() });
      }
      await mutate();
      cancelForm();
    } finally {
      setSaving(false);
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
          !showForm ? (
            <Button variant="outline-muted" onClick={openCreateForm}>
              New Snippet
            </Button>
          ) : undefined
        }
      />

      {showForm && (
        <Card className="mb-4">
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Snippet title"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Content</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Snippet content to insert into workspace description..."
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving || !title.trim() || !content.trim()}>
                {saving ? "Saving..." : editingId !== null ? "Update" : "Create"}
              </Button>
              <Button variant="outline-muted" type="button" onClick={cancelForm}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to fetch snippets.</StatusText>}

      {!isLoading && !error && snippets.length === 0 && !showForm && (
        <StatusText>No snippets yet. Create one to get started.</StatusText>
      )}

      {snippets.length > 0 && (
        <div className="grid gap-2">
          {snippets.map((snippet) => (
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
                  <Button variant="outline-muted" onClick={() => openEditForm(snippet)}>
                    Edit
                  </Button>
                  <Button variant="destructive-sm" onClick={() => handleDelete(snippet.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
