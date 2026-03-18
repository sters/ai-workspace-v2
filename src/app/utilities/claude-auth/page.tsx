"use client";

import useSWR from "swr";
import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { FetchStatus } from "@/components/shared/feedback/fetch-status";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusBadge } from "@/components/shared/feedback/status-badge";
import { fetcher } from "@/lib/api-client";

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

function AuthDetail({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p>
      <span className="font-medium text-foreground">{label}:</span> {value}
    </p>
  );
}

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
      <PageHeader
        title="Claude Auth"
        description="Manage Claude Code authentication. Runs claude auth login."
        onRefresh={() => mutate()}
      />

      <FetchStatus
        isLoading={isLoading}
        error={error}
        apiError={status?.error}
        loadingText="Checking auth status..."
        errorText="Failed to check auth status."
      />

      {status && !status.error && (
        <Card className="mb-4">
          <div className="flex items-center gap-2">
            <StatusBadge
              label={loggedIn ? "Logged in" : "Not logged in"}
              variant={loggedIn ? "connected" : "error"}
            />
            {loggedIn && status.email && (
              <span className="text-sm text-muted-foreground">
                ({status.email})
              </span>
            )}
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <AuthDetail label="Method" value={status.authMethod} />
            <AuthDetail label="Provider" value={status.apiProvider} />
            <AuthDetail label="Subscription" value={status.subscriptionType} />
          </div>
        </Card>
      )}

      <ClaudeOperation
        storageKey="utility:claude-auth"
        vertical
        onRunningChange={() => mutate()}
      >
        {({ start, isRunning }) => (
          <Button
            onClick={() => start("claude-login", {})}
            disabled={isRunning || isLoading}
          >
            {loggedIn ? "Relogin" : "Login"}
          </Button>
        )}
      </ClaudeOperation>
    </div>
  );
}
