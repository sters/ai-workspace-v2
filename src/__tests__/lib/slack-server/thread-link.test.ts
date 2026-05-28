import { mergeWithThreadLink } from "@/lib/slack-server/thread-link";

describe("mergeWithThreadLink", () => {
  it("returns just the labeled link when description is empty", () => {
    expect(mergeWithThreadLink("", "https://slack.com/x")).toBe(
      "--- Slack thread ---\nhttps://slack.com/x",
    );
  });

  it("returns just the description when permalink is empty", () => {
    expect(mergeWithThreadLink("desc", "")).toBe("desc");
  });

  it("combines both with a separator so Claude can recognize the link section", () => {
    expect(mergeWithThreadLink("the request", "https://slack.com/x")).toBe(
      "the request\n\n--- Slack thread ---\nhttps://slack.com/x",
    );
  });

  it("returns empty string when both inputs are empty", () => {
    expect(mergeWithThreadLink("", "")).toBe("");
  });

  it("trims surrounding whitespace from both inputs", () => {
    expect(mergeWithThreadLink("  desc  ", "  https://slack.com/x  ")).toBe(
      "desc\n\n--- Slack thread ---\nhttps://slack.com/x",
    );
  });
});
