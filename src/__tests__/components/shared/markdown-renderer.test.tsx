import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "@/components/shared/content/markdown-renderer";

const collapsible = [
  "Intro",
  "",
  "<details>",
  "<summary>Prompt for AI agents</summary>",
  "",
  "- **fix** `foo.ts`",
  "",
  "</details>",
].join("\n");

describe("MarkdownRenderer", () => {
  it("renders <details> as a closed collapsible with markdown inside when allowHtml is set", () => {
    const { container } = render(<MarkdownRenderer content={collapsible} allowHtml />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.querySelector("summary")?.textContent).toBe("Prompt for AI agents");
    expect(details!.querySelector("li strong")?.textContent).toBe("fix");
    expect(details!.querySelector("code")?.textContent).toBe("foo.ts");
  });

  it("strips scripts and event handlers from raw HTML", () => {
    const { container } = render(
      <MarkdownRenderer
        content={'<img src="x" onerror="alert(1)">\n\n<script>alert(1)</script>'}
        allowHtml
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("onerror")).toBeNull();
  });

  it("does not render raw HTML without allowHtml", () => {
    const { container } = render(<MarkdownRenderer content={collapsible} />);
    expect(container.querySelector("details")).toBeNull();
  });
});
