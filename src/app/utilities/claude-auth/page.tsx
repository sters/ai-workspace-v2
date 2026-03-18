"use client";

import useSWR from "swr";
import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { Callout } from "@/components/shared/containers/callout";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
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
        description={`Manage Claude Code authentication. Runs claude auth login.`}
        onRefresh={() => mutate()}
      />

      {/* Auth status */}
      {isLoading && (
        <StatusText className="mb-4">Checking auth status...</StatusText>
      )}
      {error && (
        <StatusText variant="error" className="mb-4">
          Failed to check auth status.
        </StatusText>
      )}
      {status && !status.error && (
        <Card className="mb-4">
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
        </Card>
      )}
      {status?.error && (
        <Callout variant="error" className="mb-4">
          <StatusText variant="error">{status.error}</StatusText>
        </Callout>
      )}

      {/* Login operation */}
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
