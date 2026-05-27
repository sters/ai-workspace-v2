import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentTitle } from "@/hooks/use-document-title";

describe("useDocumentTitle", () => {
  beforeEach(() => {
    document.title = "ai-workspace";
  });

  it("sets document.title with ai-workspace suffix", () => {
    renderHook(() => useDocumentTitle("Dashboard"));
    expect(document.title).toBe("Dashboard | ai-workspace");
  });

  it("updates document.title when title changes", () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: "First" },
    });
    expect(document.title).toBe("First | ai-workspace");

    rerender({ title: "Second" });
    expect(document.title).toBe("Second | ai-workspace");
  });

  it("restores previous title on unmount", () => {
    document.title = "previous";
    const { unmount } = renderHook(() => useDocumentTitle("Page"));
    expect(document.title).toBe("Page | ai-workspace");

    unmount();
    expect(document.title).toBe("previous");
  });
});
