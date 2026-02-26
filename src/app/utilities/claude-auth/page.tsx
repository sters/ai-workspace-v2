"use client";

import useSWR from "swr";
import { ClaudeOperation } from "@/components/operation/claude-operation";

type AuthStatus = {
  loggedIn: boolean;
  authMethod: string;
  apiProvider: string;
  email?: string;
  orgId?: string;
  orgName?: string | null;
  subscriptionType?: string;
  error?: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function ClaudeAuthPage() {
  const {
    data: status,
    error,
    isLoading,
    mutate,
  } = useSWR<AuthStatus>("/api/claude-auth", fetcher, {
    revalidateOnFocus: false,
  });

  const loggedIn = status?.loggedIn ?? false;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Claude Auth</h1>
        <button
          onClick={() => mutate()}
          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
        >
          Refresh
        </button>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Manage Claude Code authentication. Runs{" "}
        <code className="text-xs">claude auth login</code>.
      </p>

      {/* Auth status */}
      {isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">
          Checking auth status...
        </p>
      )}
      {error && (
        <p className="mb-4 text-sm text-destructive">
          Failed to check auth status.
        </p>
      )}
      {status && !status.error && (
        <div className="mb-4 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                loggedIn ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm font-medium">
              {loggedIn ? "Logged in" : "Not logged in"}
            </span>
            {loggedIn && status.email && (
              <span className="text-sm text-muted-foreground">
                ({status.email})
              </span>
            )}
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Method:</span>{" "}
              {status.authMethod}
            </p>
            <p>
              <span className="font-medium text-foreground">Provider:</span>{" "}
              {status.apiProvider}
            </p>
            {status.subscriptionType && (
              <p>
                <span className="font-medium text-foreground">
                  Subscription:
                </span>{" "}
                {status.subscriptionType}
              </p>
            )}
          </div>
        </div>
      )}
      {status?.error && (
        <div className="mb-4 rounded-lg border border-destructive/50 p-4">
          <p className="text-sm text-destructive">{status.error}</p>
        </div>
      )}

      {/* Login operation */}
      <ClaudeOperation
        storageKey="utility:claude-auth"
        vertical
        onRunningChange={() => mutate()}
      >
        {({ start, isRunning }) => (
          <button
            onClick={() => start("claude-login", {})}
            disabled={isRunning || isLoading}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loggedIn ? "Relogin" : "Login"}
          </button>
        )}
      </ClaudeOperation>
    </div>
  );
}
