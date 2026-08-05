import { describe, it, expect } from "vitest";
import {
  parsePrLocator,
  parsePrView,
  parseReviewThreads,
  parseStatusChecks,
  REVIEW_THREADS_QUERY,
} from "@/lib/workspace/pr-threads";

describe("parsePrLocator", () => {
  it("pulls host, owner, repo and number out of a PR url", () => {
    expect(parsePrLocator("https://github.com/acme/widgets/pull/42")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
  });

  it("keeps an enterprise host, which decides which API the thread query hits", () => {
    expect(parsePrLocator("https://git.corp.example.com/team/svc/pull/7")).toEqual({
      host: "git.corp.example.com",
      owner: "team",
      repo: "svc",
      number: 7,
    });
  });

  it("tolerates a trailing path segment", () => {
    expect(parsePrLocator("https://github.com/acme/widgets/pull/42/files")?.number).toBe(42);
  });

  it("returns null for anything that is not a PR url", () => {
    expect(parsePrLocator("https://github.com/acme/widgets/issues/42")).toBeNull();
    expect(parsePrLocator("not a url")).toBeNull();
    expect(parsePrLocator("")).toBeNull();
  });
});

describe("parsePrView", () => {
  const raw = JSON.stringify({
    number: 42,
    url: "https://github.com/acme/widgets/pull/42",
    title: "Add widget cache",
    state: "OPEN",
    isDraft: false,
    headRefName: "feature/cache",
    baseRefName: "main",
    author: { login: "sters" },
    updatedAt: "2026-08-05T01:02:03Z",
  });

  it("maps the gh json onto the workspace repo it came from", () => {
    const pr = parsePrView(raw, {
      repoName: "widgets",
      repoPath: "github.com/acme/widgets",
      worktreePath: "/ws/feat/widgets",
    });

    expect(pr).toMatchObject({
      repoName: "widgets",
      worktreePath: "/ws/feat/widgets",
      host: "github.com",
      owner: "acme",
      repo: "widgets",
      number: 42,
      title: "Add widget cache",
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      author: "sters",
      threads: [],
    });
  });

  it("returns null when the url is unusable, since the thread query needs it", () => {
    const noUrl = JSON.stringify({ number: 42, url: "", title: "x" });
    expect(parsePrView(noUrl, { repoName: "w", repoPath: "p", worktreePath: "/w" })).toBeNull();
  });

  it("returns null on malformed json rather than throwing", () => {
    expect(parsePrView("{oops", { repoName: "w", repoPath: "p", worktreePath: "/w" })).toBeNull();
  });

  it("falls back to a placeholder author when gh omits it", () => {
    const noAuthor = JSON.stringify({
      number: 1,
      url: "https://github.com/a/b/pull/1",
      title: "t",
    });
    const pr = parsePrView(noAuthor, { repoName: "b", repoPath: "a/b", worktreePath: "/w" });
    expect(pr?.author).toBe("(unknown)");
    expect(pr?.state).toBe("OPEN");
  });
});

describe("parseReviewThreads", () => {
  const raw = JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: "PRRT_kwDOabc",
                isResolved: false,
                isOutdated: false,
                path: "src/cache.ts",
                line: 88,
                comments: {
                  nodes: [
                    {
                      url: "https://github.com/acme/widgets/pull/42#discussion_r1",
                      author: { login: "reviewer" },
                      body: "This can deadlock.",
                      createdAt: "2026-08-04T10:00:00Z",
                    },
                    {
                      url: "https://github.com/acme/widgets/pull/42#discussion_r2",
                      author: null,
                      body: "Agreed.",
                      createdAt: "2026-08-04T11:00:00Z",
                    },
                  ],
                },
              },
              {
                id: "PRRT_kwDOdef",
                isResolved: true,
                isOutdated: true,
                path: null,
                line: null,
                comments: { nodes: [] },
              },
            ],
          },
        },
      },
    },
  });

  it("maps thread nodes, keeping the node id and resolution state", () => {
    const threads = parseReviewThreads(raw);
    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({
      id: "PRRT_kwDOabc",
      isResolved: false,
      isOutdated: false,
      path: "src/cache.ts",
      line: 88,
    });
    expect(threads[0].comments).toHaveLength(2);
    expect(threads[0].comments[0].author).toBe("reviewer");
    expect(threads[1]).toMatchObject({ id: "PRRT_kwDOdef", isResolved: true, path: null, line: null });
  });

  it("keeps a deleted comment author renderable", () => {
    expect(parseReviewThreads(raw)[0].comments[1].author).toBe("(unknown)");
  });

  it("drops a node with no id — nothing downstream could join on it", () => {
    const noId = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }] } } } },
    });
    expect(parseReviewThreads(noId)).toEqual([]);
  });

  it("returns an empty list for malformed or empty responses", () => {
    expect(parseReviewThreads("{oops")).toEqual([]);
    expect(parseReviewThreads("{}")).toEqual([]);
    expect(parseReviewThreads(JSON.stringify({ data: { repository: null } }))).toEqual([]);
  });
});

describe("REVIEW_THREADS_QUERY", () => {
  it("requests the fields the tab and the triage record both need", () => {
    for (const field of ["id", "isResolved", "isOutdated", "path", "line", "comments"]) {
      expect(REVIEW_THREADS_QUERY).toContain(field);
    }
  });

  it("is parameterized rather than interpolated, so repo names cannot inject", () => {
    expect(REVIEW_THREADS_QUERY).toContain("$owner:String!");
    expect(REVIEW_THREADS_QUERY).toContain("$name:String!");
    expect(REVIEW_THREADS_QUERY).toContain("$number:Int!");
  });

  it("asks for CI in the same query as the threads, not a second call", () => {
    // `gh pr checks` would be another process spawn and another round trip per
    // repository for data GitHub hands over here for free.
    expect(REVIEW_THREADS_QUERY).toContain("statusCheckRollup");
    expect(REVIEW_THREADS_QUERY).toContain("CheckRun");
    expect(REVIEW_THREADS_QUERY).toContain("StatusContext");
  });
});

describe("parseStatusChecks", () => {
  function response(contexts: unknown[]) {
    return JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            commits: {
              nodes: [
                { commit: { statusCheckRollup: { state: "FAILURE", contexts: { nodes: contexts } } } },
              ],
            },
          },
        },
      },
    });
  }

  it("normalizes a CheckRun's status/conclusion pair into one state", () => {
    const raw = response([
      { __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/1" },
      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci/2" },
      { __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS", conclusion: null, detailsUrl: null },
    ]);
    const summary = parseStatusChecks(raw);

    expect(summary.reported).toBe(true);
    expect(summary.counts).toMatchObject({ failure: 1, running: 1, success: 1, queued: 0 });
    expect(summary.checks.find((c) => c.name === "lint")).toEqual({
      name: "lint",
      state: "failure",
      url: "https://ci/2",
    });
  });

  it("keeps a queued run distinct from one that is actually running", () => {
    // GitHub reports these separately and they mean different things to someone
    // deciding whether to wait: a queued job has not started, so its logs do not
    // exist yet and nothing about the outcome is knowable.
    const raw = response([
      { __typename: "CheckRun", name: "waiting", status: "QUEUED", conclusion: null },
      { __typename: "CheckRun", name: "going", status: "IN_PROGRESS", conclusion: null },
    ]);
    const summary = parseStatusChecks(raw);
    expect(summary.checks.find((c) => c.name === "waiting")?.state).toBe("queued");
    expect(summary.checks.find((c) => c.name === "going")?.state).toBe("running");
    expect(summary.counts).toMatchObject({ queued: 1, running: 1 });
  });

  it.each(["WAITING", "PENDING", "REQUESTED"])(
    "reads the %s status as queued rather than as running",
    (status) => {
      const raw = response([{ __typename: "CheckRun", name: "x", status, conclusion: null }]);
      expect(parseStatusChecks(raw).checks[0].state).toBe("queued");
    },
  );

  it("treats an unrecognized non-completed status as in flight, not as unknown", () => {
    // GitHub can add status values. What must survive is that the run is *not
    // finished*: calling it `unknown` would let the summary report "all passed"
    // while something is still outstanding.
    const raw = response([
      { __typename: "CheckRun", name: "new", status: "SOME_NEW_STATE", conclusion: null },
    ]);
    expect(parseStatusChecks(raw).checks[0].state).toBe("queued");
  });

  it("puts failures first, then running, then queued", () => {
    const raw = response([
      { __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "queued-job", status: "QUEUED", conclusion: null },
      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS", conclusion: null },
    ]);
    expect(parseStatusChecks(raw).checks.map((c) => c.name)).toEqual([
      "lint",
      "e2e",
      "queued-job",
      "unit",
    ]);
  });

  it("treats a completed run that needs a human as failing", () => {
    // TIMED_OUT / ACTION_REQUIRED / STARTUP_FAILURE all mean "this did not pass
    // and it will not pass on its own", which is what a reader needs to know.
    for (const conclusion of ["TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]) {
      const raw = response([{ __typename: "CheckRun", name: "x", status: "COMPLETED", conclusion }]);
      expect(parseStatusChecks(raw).counts.failure).toBe(1);
    }
  });

  it("counts skipped and cancelled in their own buckets, not as passing", () => {
    const raw = response([
      { __typename: "CheckRun", name: "skip", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "CheckRun", name: "cancel", status: "COMPLETED", conclusion: "CANCELLED" },
    ]);
    expect(parseStatusChecks(raw).counts).toMatchObject({
      skipped: 1,
      cancelled: 1,
      success: 0,
      failure: 0,
      running: 0,
      queued: 0,
    });
  });

  it.each(["NEUTRAL", "STALE"])(
    "leaves the %s conclusion unknown rather than guessing pass or fail",
    (conclusion) => {
      const raw = response([{ __typename: "CheckRun", name: "x", status: "COMPLETED", conclusion }]);
      expect(parseStatusChecks(raw).counts).toMatchObject({ unknown: 1, success: 0, failure: 0 });
    },
  );

  it("reads a legacy StatusContext's own state vocabulary", () => {
    // A commit status has one field and a different enum. PENDING is what CI
    // posts when it starts work, so it is running; EXPECTED means the status has
    // not been posted at all, which is the queued case.
    const raw = response([
      { __typename: "StatusContext", context: "ci/jenkins", state: "FAILURE", targetUrl: "https://j/1" },
      { __typename: "StatusContext", context: "ci/going", state: "PENDING", targetUrl: null },
      { __typename: "StatusContext", context: "ci/awaited", state: "EXPECTED", targetUrl: null },
      { __typename: "StatusContext", context: "ci/broken", state: "ERROR", targetUrl: null },
      { __typename: "StatusContext", context: "ci/ok", state: "SUCCESS", targetUrl: null },
    ]);
    const summary = parseStatusChecks(raw);
    expect(summary.counts).toMatchObject({ failure: 2, running: 1, queued: 1, success: 1 });
    expect(summary.checks.find((c) => c.name === "ci/jenkins")).toEqual({
      name: "ci/jenkins",
      state: "failure",
      url: "https://j/1",
    });
    // Two failures tie on state, so the name breaks it.
    expect(summary.checks.slice(0, 2).map((c) => c.name)).toEqual(["ci/broken", "ci/jenkins"]);
  });

  it("reports no CI rather than a green result when there is no rollup", () => {
    // An absent rollup means no CI is configured. Rendering that as passing
    // would claim something GitHub never said.
    const noRollup = JSON.stringify({
      data: {
        repository: {
          pullRequest: { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } },
        },
      },
    });
    const summary = parseStatusChecks(noRollup);
    expect(summary.reported).toBe(false);
    expect(summary.checks).toEqual([]);
    expect(Object.values(summary.counts).every((n) => n === 0)).toBe(true);
  });

  it("gives every state a count, so a new state cannot silently vanish", () => {
    const summary = parseStatusChecks("{}");
    expect(Object.keys(summary.counts).sort()).toEqual([
      "cancelled",
      "failure",
      "queued",
      "running",
      "skipped",
      "success",
      "unknown",
    ]);
  });

  it("returns an empty summary for malformed or empty responses", () => {
    for (const raw of ["{oops", "{}", JSON.stringify({ data: { repository: null } })]) {
      expect(parseStatusChecks(raw).reported).toBe(false);
    }
  });

  it("keeps an unnamed check renderable", () => {
    const raw = response([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }]);
    expect(parseStatusChecks(raw).checks[0].name).toBe("(unnamed check)");
  });
});
