/**
 * Shared fetch helpers for client-side API calls.
 */

/** Discriminated union for API call results. */
export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** SWR-compatible fetcher that returns parsed JSON. */
export const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** POST JSON to an endpoint and return the parsed response. */
export async function postJson<TResponse = unknown, TBody extends object = Record<string, unknown>>(
  url: string,
  body: TBody,
): Promise<ApiResult<TResponse>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: text };
  }
  const data: TResponse = await res.json();
  return { ok: true, data };
}
