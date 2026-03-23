"use client";

import { useCallback, useEffect, useState } from "react";

type PushState = "unsupported" | "default" | "denied" | "granted" | "subscribed";

export function usePushNotifications() {
  const [state, setState] = useState<PushState>(() => {
    if (typeof window === "undefined") return "default";
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    return "default";
  });

  // Async subscription check — setState in callback is OK
  useEffect(() => {
    if (state !== "default" || typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setState(sub ? "subscribed" : Notification.permission === "granted" ? "granted" : "default");
      });
    });
  }, [state]);

  const subscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;

    const permission = await Notification.requestPermission();
    if (permission === "denied") {
      setState("denied");
      return;
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const res = await fetch("/api/push/vapid-public-key");
    const { publicKey } = await res.json();

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });

    const json = subscription.toJSON();
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
      }),
    });

    setState("subscribed");
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;

    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
    }
    setState("granted");
  }, []);

  return { state, subscribe, unsubscribe };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
