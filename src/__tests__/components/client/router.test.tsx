import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import { useEffect } from "react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { useParams } from "@/lib/router/navigation";

const mounts: string[] = [];

function recordMount(label: (params: Record<string, string>) => string) {
  return function Recorder({ children }: { children?: React.ReactNode }) {
    const params = useParams<Record<string, string>>();
    useEffect(() => {
      mounts.push(label(params));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return children ?? null;
  };
}

vi.mock("@/components/workspace/workspace-layout-content", () => ({
  WorkspaceLayoutContent: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/workspace/[name]/chat/interactive/page", () => ({
  default: recordMount((p) => `chat ${p.name}`),
}));
vi.mock("@/app/workspace/[name]/review/layout", () => ({
  default: recordMount((p) => `review layout ${p.name}`),
}));
vi.mock("@/app/workspace/[name]/review/[timestamp]/page", () => ({
  default: recordMount((p) => `review ${p.timestamp}`),
}));

const { router } = await import("@/client/router");

type TestRouter = ReturnType<typeof createRouter>;

async function visit(first: string, next: (r: TestRouter) => Promise<unknown>) {
  const testRouter = createRouter({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [first] }),
  });
  render(<RouterProvider router={testRouter} />);
  await act(async () => {
    await testRouter.load();
  });
  await act(async () => {
    await next(testRouter);
  });
}

// Pages keep state that belongs to the param they were opened for — the chat
// session hook connects only from idle, a review keeps its typed instruction —
// so a page kept mounted across a param change shows the previous one's.
describe("routes with params", () => {
  beforeEach(() => {
    mounts.length = 0;
  });

  it("mount the page afresh when the workspace changes", async () => {
    await visit("/workspace/ws-a/chat/interactive", (r) =>
      r.navigate({ to: "/workspace/$name/chat/interactive", params: { name: "ws-b" } }),
    );
    expect(mounts).toEqual(["chat ws-a", "chat ws-b"]);
  });

  it("mount the review afresh but keep its layout when the review changes", async () => {
    await visit("/workspace/ws-a/review/t1", (r) =>
      r.navigate({ to: "/workspace/$name/review/$timestamp", params: { name: "ws-a", timestamp: "t2" } }),
    );
    expect(mounts).toEqual(["review t1", "review layout ws-a", "review t2"]);
  });
});
