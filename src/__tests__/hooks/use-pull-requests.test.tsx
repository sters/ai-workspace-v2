import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { usePullRequests } from "@/hooks/use-workspace";

const LIST_URL = "/api/workspaces/feat/pull-requests";

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

let releaseGadgets: () => void;
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url === LIST_URL) {
      return Promise.resolve(
        json({
          repos: [
            { repoName: "gadgets", repoPath: "github.com/acme/gadgets" },
            { repoName: "widgets", repoPath: "github.com/acme/widgets" },
          ],
          validations: {},
        }),
      );
    }
    const repo = new URL(url, "http://x").searchParams.get("repo");
    if (repo === "github.com/acme/gadgets") {
      return new Promise((resolve) => {
        releaseGadgets = () =>
          resolve(json({ problem: { repoName: "gadgets", reason: "no pull requests found" } }));
      });
    }
    return Promise.resolve(json({ pr: { repoName: "widgets", title: "Add widget cache" } }));
  });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePullRequests", () => {
  it("shows a repository's PR while a slower repository is still being read", async () => {
    const { result } = renderHook(() => usePullRequests("feat"), { wrapper });

    await waitFor(() => expect(result.current.pullRequests).toHaveLength(1));
    expect(result.current.repos.map((r) => [r.repoName, r.isLoading])).toEqual([
      ["gadgets", true],
      ["widgets", false],
    ]);

    act(() => releaseGadgets());
    await waitFor(() => expect(result.current.problems).toHaveLength(1));
    expect(result.current.repos.every((r) => !r.isLoading)).toBe(true);
  });

  it("asks every repository past the server cache on Refresh", async () => {
    const { result } = renderHook(() => usePullRequests("feat"), { wrapper });
    await waitFor(() => expect(result.current.pullRequests).toHaveLength(1));
    mockFetch.mockClear();

    await act(() => result.current.refresh());

    await waitFor(() =>
      expect(mockFetch.mock.calls.map(([url]) => url).filter((u) => u !== LIST_URL)).toHaveLength(2),
    );
    for (const [url] of mockFetch.mock.calls) {
      if (url !== LIST_URL) expect(url).toContain("refresh=1");
    }
  });

  it("reports a repository whose request failed rather than leaving it loading", async () => {
    mockFetch.mockImplementation((url: string) =>
      url === LIST_URL
        ? Promise.resolve(json({ repos: [{ repoName: "widgets", repoPath: "github.com/acme/widgets" }], validations: {} }))
        : Promise.resolve({ ok: false, status: 500, json: async () => ({}) }),
    );
    const { result } = renderHook(() => usePullRequests("feat"), { wrapper });

    await waitFor(() => expect(result.current.problems).toEqual([{ repoName: "widgets", reason: "HTTP 500" }]));
    expect(result.current.repos[0].isLoading).toBe(false);
  });
});
