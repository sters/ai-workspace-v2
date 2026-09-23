import { NextResponse } from "next/server";
import { repositoryPruneSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import {
  listRepositoryPruneCandidates,
  pruneRepositories,
} from "@/lib/workspace/repository-prune";

export const dynamic = "force-dynamic";

/**
 * Separate from `/api/repositories`, which the repository picker reads on every
 * page load: this one runs `git worktree list` per clone to answer whether
 * anything still uses it, and nobody needs that to tick a box on a form.
 */
export async function GET() {
  try {
    return NextResponse.json({ repositories: listRepositoryPruneCandidates() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(repositoryPruneSchema, body);
  if (!parsed.success) return parsed.response;

  try {
    return NextResponse.json({ outcomes: pruneRepositories(parsed.data.repositories) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
