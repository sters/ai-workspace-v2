"use client";

import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Bell, BellOff, BellRing } from "lucide-react";

export function PushToggle({ compact }: { compact?: boolean } = {}) {
  const { state, subscribe, unsubscribe } = usePushNotifications();

  if (state === "unsupported") return null;

  if (state === "denied") {
    return compact ? (
      <div
        className="p-2 text-muted-foreground"
        title="Notifications blocked"
        aria-label="Notifications blocked"
      >
        <BellOff className="h-3.5 w-3.5" />
      </div>
    ) : (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <BellOff className="h-3.5 w-3.5" />
        <span>Notifications blocked</span>
      </div>
    );
  }

  if (state === "subscribed") {
    return (
      <button
        onClick={unsubscribe}
        title={compact ? "Push: ON" : undefined}
        aria-label={compact ? "Push: ON" : undefined}
        className={
          compact
            ? "rounded-md p-2 text-green-600 hover:bg-accent"
            : "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-green-600 hover:bg-accent"
        }
      >
        <BellRing className="h-3.5 w-3.5" />
        {!compact && <span>Push: ON</span>}
      </button>
    );
  }

  return (
    <button
      onClick={subscribe}
      title={compact ? "Enable Push Notifications" : undefined}
      aria-label={compact ? "Enable Push Notifications" : undefined}
      className={
        compact
          ? "rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          : "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      }
    >
      <Bell className="h-3.5 w-3.5" />
      {!compact && <span>Enable Push Notifications</span>}
    </button>
  );
}
