/**
 * Shared fetch helpers for client-side API calls.
 */

/** SWR-compatible fetcher that returns parsed JSON. */
export const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** POST JSON to an endpoint and return the parsed response. */
export async function postJson<T = unknown>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: text };
  }
  const data: T = await res.json();
  return { ok: true, data };
}

/** Kill a running operation by ID. */
export async function killOperation(operationId: string): Promise<void> {
  await fetch("/api/operations/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationId }),
  });
}
