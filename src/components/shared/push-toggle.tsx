"use client";

import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Bell, BellOff, BellRing } from "lucide-react";

export function PushToggle() {
  const { state, subscribe, unsubscribe } = usePushNotifications();

  if (state === "unsupported") return null;

  if (state === "denied") {
    return (
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
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-green-600 hover:bg-accent"
      >
        <BellRing className="h-3.5 w-3.5" />
        <span>Push: ON</span>
      </button>
    );
  }

  return (
    <button
      onClick={subscribe}
      className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Bell className="h-3.5 w-3.5" />
      <span>Enable Push Notifications</span>
    </button>
  );
}
