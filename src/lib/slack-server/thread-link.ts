/**
 * Helper for composing an `init` description that points Claude at a Slack
 * thread via its permalink rather than inlining the thread's full text.
 *
 * Why a link instead of full text: folding entire threads into the description
 * tends to drown the actual request in noise (CI bot output, alert cards,
 * tangential replies) and confuses downstream planning. The init / plan
 * operation can fetch the thread on demand if it actually needs the context.
 */

const SEPARATOR = "--- Slack thread ---";

/**
 * Combine an explicit description (from the mention text) with a Slack thread
 * permalink. Either may be empty; the result is trimmed and the separator is
 * only emitted when both pieces are present so empty cases stay clean.
 */
export function mergeWithThreadLink(description: string, permalink: string): string {
  const d = description.trim();
  const p = permalink.trim();
  if (!d && !p) return "";
  if (!d) return `${SEPARATOR}\n${p}`;
  if (!p) return d;
  return `${d}\n\n${SEPARATOR}\n${p}`;
}
