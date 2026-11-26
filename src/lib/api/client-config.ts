export type ClientConfig = { gitHash: string; chatPort: number };

const FALLBACK: ClientConfig = { gitHash: "unknown", chatPort: 3742 };

let pending: Promise<ClientConfig> | null = null;

/** Fetched once per page load; a failed fetch falls back to the default port and is retried next time. */
export function getClientConfig(): Promise<ClientConfig> {
  pending ??= fetch("/api/client-config")
    .then((res) => (res.ok ? (res.json() as Promise<ClientConfig>) : Promise.reject(new Error(`HTTP ${res.status}`))))
    .catch(() => {
      pending = null;
      return FALLBACK;
    });
  return pending;
}

export async function chatWsUrl(): Promise<string> {
  const { chatPort } = await getClientConfig();
  return `ws://${window.location.hostname}:${chatPort}/ws`;
}
