"use client";

import { useState } from "react";
import { Button } from "@/components/shared/buttons/button";
import { Input } from "@/components/shared/forms/input";
import { Card } from "@/components/shared/containers/card";
import { addMcpServer } from "@/lib/api-client";

export function AddMcpServerForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState("sse");
  const [scope, setScope] = useState("project");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await addMcpServer({
        name: name.trim(),
        transport,
        scope,
        url: url.trim(),
      });
      if (!res.ok) {
        setResult({ type: "error", message: res.error });
      } else {
        setResult({
          type: "success",
          message: res.data.output || `Added ${name.trim()}`,
        });
        setName("");
        setUrl("");
        onAdded();
      }
    } catch (err) {
      setResult({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // TODO: Support env and headers options for MCP server configuration

  return (
    <Card className="mb-4">
      <h2 className="mb-3 text-sm font-semibold">Add MCP Server</h2>
      <div className="flex items-end gap-2">
        <div className="flex-shrink-0">
          <label className="mb-1 block text-xs text-muted-foreground">
            Scope
          </label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="project">project</option>
            <option value="local">local</option>
          </select>
        </div>
        <div className="flex-shrink-0">
          <label className="mb-1 block text-xs text-muted-foreground">
            Transport
          </label>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </div>
        <div className="w-40 flex-shrink-0">
          <label className="mb-1 block text-xs text-muted-foreground">
            Name
          </label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="server-name"
            className="h-8 w-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">
            URL / Command
          </label>
          <Input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/sse"
            className="h-8 w-full"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) handleSubmit();
            }}
          />
        </div>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !url.trim()}
          className="h-8 flex-shrink-0"
        >
          {submitting ? "Adding..." : "Add"}
        </Button>
      </div>
      {result && (
        <p
          className={`mt-2 text-xs ${result.type === "error" ? "text-red-600" : "text-emerald-600"}`}
        >
          {result.message}
        </p>
      )}
    </Card>
  );
}
