import { describe, expect, it, vi } from "vitest";
import { composeStatus, updateStatus } from "@/lib/slack-server/status-message";

describe("composeStatus", () => {
  it("puts the body under the header", () => {
    expect(composeStatus("Created `w`.", "⏳ Working…")).toBe("Created `w`.\n\n⏳ Working…");
  });

  it("is the body alone without a header", () => {
    expect(composeStatus(undefined, "🛠 Creating a workspace…")).toBe("🛠 Creating a workspace…");
  });
});

describe("updateStatus", () => {
  function client(updateFails = false) {
    return {
      chat: {
        update: vi.fn(async () => {
          if (updateFails) throw new Error("message_not_found");
          return { ok: true };
        }),
        postMessage: vi.fn(async () => ({ ok: true, ts: "9.9" })),
      },
    };
  }

  it("edits the status message in place", async () => {
    const c = client();
    const ts = await updateStatus(c as never, "C", "1.0", "1.5", "done");
    expect(c.chat.update).toHaveBeenCalledWith({ channel: "C", ts: "1.5", text: "done" });
    expect(c.chat.postMessage).not.toHaveBeenCalled();
    expect(ts).toBe("1.5");
  });

  // The user must still get the update when the message cannot be edited.
  it("posts a fresh message, and hands back its ts, when the edit fails", async () => {
    const c = client(true);
    const ts = await updateStatus(c as never, "C", "1.0", "1.5", "done");
    expect(c.chat.postMessage).toHaveBeenCalledWith({ channel: "C", thread_ts: "1.0", text: "done" });
    expect(ts).toBe("9.9");
  });

  it("posts a fresh message when there is no status message", async () => {
    const c = client();
    await updateStatus(c as never, "C", "1.0", undefined, "done");
    expect(c.chat.update).not.toHaveBeenCalled();
    expect(c.chat.postMessage).toHaveBeenCalledTimes(1);
  });
});
