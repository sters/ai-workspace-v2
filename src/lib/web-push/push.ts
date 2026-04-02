import webPush from "web-push";
import { getVapidDetails } from "./vapid";
import {
  addPushSubscription,
  removePushSubscription,
  getAllPushSubscriptions,
} from "@/lib/db/push";

interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export function addSubscription(subscription: PushSubscriptionData): void {
  addPushSubscription(subscription);
}

export function removeSubscription(endpoint: string): boolean {
  return removePushSubscription(endpoint);
}

interface NotificationPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

function broadcastNotification(payload: NotificationPayload): void {
  const subs = getAllPushSubscriptions();
  console.log(`[web-push] broadcastNotification: ${subs.length} subscriber(s), tag=${payload.tag}`);
  if (subs.length === 0) return;

  const vapid = getVapidDetails();
  const json = JSON.stringify(payload);

  for (const sub of subs) {
    webPush
      .sendNotification(sub, json, { vapidDetails: vapid, TTL: 60 })
      .then(() => {
        console.log(`[web-push] sent OK to ${sub.endpoint.slice(0, 60)}…`);
      })
      .catch((err) => {
        console.error(`[web-push] send failed: status=${err.statusCode}, message=${err.message}`);
        if (err.statusCode === 404 || err.statusCode === 410) {
          removePushSubscription(sub.endpoint);
        }
      });
  }
}

export function sendCompletionNotification(
  operationId: string,
  success: boolean,
  workspace?: string,
): void {
  const status = success ? "completed" : "failed";
  broadcastNotification({
    title: `ai-workspace: Operation ${status}`,
    body: workspace
      ? `Operation in "${workspace}" ${status}`
      : `An operation ${status}`,
    tag: `complete-${operationId}`,
    url: workspace
      ? `/workspace/${encodeURIComponent(workspace)}/operations?operationId=${encodeURIComponent(operationId)}`
      : "/",
  });
}

export function sendAskNotification(operationId: string, workspace?: string): void {
  broadcastNotification({
    title: "ai-workspace: Input Required",
    body: workspace
      ? `Operation in "${workspace}" needs your input`
      : "An operation needs your input",
    tag: `ask-${operationId}`,
    url: workspace
      ? `/workspace/${encodeURIComponent(workspace)}/operations?operationId=${encodeURIComponent(operationId)}`
      : "/",
  });
}
