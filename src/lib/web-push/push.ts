import webPush from "web-push";
import { getVapidDetails } from "./vapid";

interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

declare global {
  var __pushSubscriptions: Map<string, PushSubscriptionData> | undefined;
}

function getSubscriptions(): Map<string, PushSubscriptionData> {
  if (!globalThis.__pushSubscriptions) {
    globalThis.__pushSubscriptions = new Map();
  }
  return globalThis.__pushSubscriptions;
}

export function addSubscription(subscription: PushSubscriptionData): void {
  getSubscriptions().set(subscription.endpoint, subscription);
}

export function removeSubscription(endpoint: string): boolean {
  return getSubscriptions().delete(endpoint);
}

export function sendAskNotification(operationId: string, workspace?: string): void {
  const subs = getSubscriptions();
  if (subs.size === 0) return;

  const vapid = getVapidDetails();
  const payload = JSON.stringify({
    title: "ai-workspace: Input Required",
    body: workspace
      ? `Operation in "${workspace}" needs your input`
      : "An operation needs your input",
    tag: `ask-${operationId}`,
    url: workspace ? `/workspace/${workspace}` : "/",
  });

  for (const [endpoint, sub] of subs) {
    webPush
      .sendNotification(sub, payload, {
        vapidDetails: vapid,
        TTL: 60,
      })
      .catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          subs.delete(endpoint);
        }
      });
  }
}
