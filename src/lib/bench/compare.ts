/**
 * Agreement between two runs of one step: each run's structured output reduced
 * to verdicts — `key` → `value` — and the keys matched across runs.
 *
 * A key of the form `group: text` names an item the model wrote itself (a
 * requirement, a TODO item, a finding), so two runs word it differently; it is
 * matched within its group by word overlap. Any other key (`shouldLoop`) is a
 * fixed field and matches exactly. Prose (reasons, evidence) is not a verdict.
 */

export interface Verdict {
  key: string;
  value: string;
}

export interface Agreement {
  /** Reference verdicts the other run reached too. */
  same: number;
  /** Reference verdicts: the denominator. */
  total: number;
  /** Matched to a reference item, with a different verdict. */
  differs: number;
  /** Reference items the other run has no counterpart for. */
  missing: number;
  /** Items only the other run has. */
  extra: number;
}

const MIN_SIMILARITY = 0.5;

/** Words, with CJK runs split per character since they carry no spaces. */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)) for (const ch of word) out.add(ch);
    else out.add(word);
  }
  return out;
}

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

function split(key: string): { group: string | null; text: string } {
  const i = key.indexOf(": ");
  return i === -1 ? { group: null, text: key } : { group: key.slice(0, i), text: key.slice(i + 2) };
}

/** Pairs each reference verdict with at most one of `other`'s, best match first. */
export function agreement(reference: Verdict[], other: Verdict[]): Agreement {
  const candidates: { r: number; o: number; score: number }[] = [];
  reference.forEach((rv, r) => {
    const rk = split(rv.key);
    other.forEach((ov, o) => {
      const ok = split(ov.key);
      if (rk.group !== ok.group) return;
      const score = rk.group === null ? (rk.text === ok.text ? 1 : 0) : similarity(rk.text, ok.text);
      if (score >= MIN_SIMILARITY) candidates.push({ r, o, score });
    });
  });
  candidates.sort((a, b) => b.score - a.score);

  const pairedRef = new Set<number>();
  const pairedOther = new Set<number>();
  let same = 0;
  let differs = 0;
  for (const c of candidates) {
    if (pairedRef.has(c.r) || pairedOther.has(c.o)) continue;
    pairedRef.add(c.r);
    pairedOther.add(c.o);
    if (reference[c.r].value === other[c.o].value) same += 1;
    else differs += 1;
  }
  return {
    same,
    total: reference.length,
    differs,
    missing: reference.length - pairedRef.size,
    extra: other.length - pairedOther.size,
  };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const str = (v: unknown) => (typeof v === "string" ? v : String(v));

const EXTRACTORS: Partial<Record<string, (o: Json) => Verdict[]>> = {
  "verify-completion": (o) => [
    ...list(o.requirements).map((r) => ({
      key: `requirement: ${str(r.requirement)}`,
      value: r.kind === "manual" ? "PENDING-HUMAN" : str(r.status),
    })),
    ...list(o.todoItems).map((i) => ({ key: `todo: ${str(i.item)}`, value: str(i.status) })),
  ],
  "review-todos": (o) => [
    { key: "status", value: str(o.status) },
    ...list(o.findings).map((f) => ({ key: `finding: ${str(f.item)}`, value: str(f.kind) })),
  ],
  "readme-clarity-gate": (o) => [
    { key: "sufficient", value: str(o.sufficient) },
    ...strings(o.missing).map((m) => ({ key: `missing: ${m}`, value: "listed" })),
  ],
  "autonomous-gate": (o) => [
    { key: "shouldLoop", value: str(o.shouldLoop) },
    { key: "giveUp", value: str(o.giveUp === true) },
    ...strings(o.unfinishedRepositories).map((r) => ({ key: `unfinished: ${r}`, value: "listed" })),
  ],
  "criteria-feasibility": (o) =>
    list(o.infeasible).map((c) => ({ key: `infeasible: ${str(c.criterion)}`, value: "listed" })),
};

export function verdictsFor(step: string, output: unknown): Verdict[] {
  const extract = EXTRACTORS[step];
  return extract && isObject(output) ? extract(output) : [];
}
