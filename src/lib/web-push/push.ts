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

export function sendAskNotification(operationId: string, workspace?: string): void {
  const subs = getAllPushSubscriptions();
  if (subs.length === 0) return;

  const vapid = getVapidDetails();
  const payload = JSON.stringify({
    title: "ai-workspace: Input Required",
    body: workspace
      ? `Operation in "${workspace}" needs your input`
      : "An operation needs your input",
    tag: `ask-${operationId}`,
    url: workspace ? `/workspace/${workspace}` : "/",
  });

  for (const sub of subs) {
    webPush
      .sendNotification(sub, payload, {
        vapidDetails: vapid,
        TTL: 60,
      })
      .catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          removePushSubscription(sub.endpoint);
        }
      });
  }
}
