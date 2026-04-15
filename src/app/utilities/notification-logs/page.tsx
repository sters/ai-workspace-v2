"use client";

import { useState } from "react";
import useSWR from "swr";
import type { NotificationLog } from "@/lib/db/notification-logs";
import { Card } from "@/components/shared/containers/card";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher } from "@/lib/api";

interface NotificationLogsResponse {
  logs: NotificationLog[];
  total: number;
}

const PAGE_SIZE = 50;

export default function NotificationLogsPage() {
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading } = useSWR<NotificationLogsResponse>(
    `/api/notification-logs?limit=${PAGE_SIZE}&offset=${offset}`,
    fetcher,
    { revalidateOnFocus: true, revalidateOnMount: true },
  );

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = offset > 0;

  return (
    <div>
      <PageHeader
        title="Notification Logs"
        description="Web push notification history."
      />

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to fetch notification logs.</StatusText>}

      {!isLoading && !error && logs.length === 0 && (
        <StatusText>No notifications have been sent yet.</StatusText>
      )}

      {logs.length > 0 && (
        <>
          <div className="mb-3 text-sm text-muted-foreground">
            {total} notification(s) total
          </div>
          <div className="grid gap-2">
            {logs.map((log) => (
              <a key={log.id} href={log.url} className="block no-underline">
                <Card className="text-sm transition-colors hover:bg-accent">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            log.success
                              ? "font-semibold text-green-600 dark:text-green-400"
                              : "font-semibold text-destructive"
                          }
                        >
                          {log.success ? "OK" : "FAIL"}
                        </span>
                        <span className="font-medium">{log.title}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{log.body}</p>
                      {log.errorMessage && (
                        <p className="mt-1 text-xs text-destructive">{log.errorMessage}</p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>tag: {log.tag}</span>
                        <span className="truncate max-w-64" title={log.endpoint}>
                          endpoint: {log.endpoint.slice(0, 60)}...
                        </span>
                      </div>
                    </div>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={log.createdAt}
                    >
                      {new Date(log.createdAt).toLocaleString()}
                    </time>
                  </div>
                </Card>
              </a>
            ))}
          </div>

          {(hasPrev || hasNext) && (
            <div className="mt-4 flex items-center justify-between">
              <Button
                variant="outline-muted"
                disabled={!hasPrev}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                {offset + 1} - {Math.min(offset + PAGE_SIZE, total)} / {total}
              </span>
              <Button
                variant="outline-muted"
                disabled={!hasNext}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
