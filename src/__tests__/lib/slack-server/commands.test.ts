import { describe, expect, it } from "vitest";
import { parseCommand, USAGE } from "@/lib/slack-server/commands";

describe("parseCommand", () => {
  describe("mention prefix stripping", () => {
    it("strips a leading <@U...> mention", () => {
      const r = parseCommand("<@U0BOT123> init do a thing");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({ op: "init", only: false, description: "do a thing" });
    });

    it("strips multiple leading mentions and whitespace", () => {
      const r = parseCommand("  <@U0BOT123>  <@W123|alias>   init do a thing  ");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({ op: "init", only: false, description: "do a thing" });
    });

    it("works without any leading mention", () => {
      const r = parseCommand("init do a thing");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({ op: "init", only: false, description: "do a thing" });
    });
  });

  describe("init (autonomous mode by default)", () => {
    it("captures description", () => {
      const r = parseCommand("init add Slack bot integration");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({
        op: "init",
        only: false,
        description: "add Slack bot integration",
      });
    });

    it("preserves multi-word description with extra whitespace", () => {
      const r = parseCommand("init   fix   the   broken   thing");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({
        op: "init",
        only: false,
        description: "fix   the   broken   thing",
      });
    });

    it("allows empty description (handler decides whether thread context can fill it)", () => {
      const r = parseCommand("init");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({ op: "init", only: false, description: "" });
    });

    it("normalizes whitespace-only description to empty", () => {
      const r = parseCommand("init    ");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({ op: "init", only: false, description: "" });
    });
  });

  describe("init --only", () => {
    it("parses --only before description", () => {
      const r = parseCommand("init --only fix the bug");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({ op: "init", only: true, description: "fix the bug" });
    });

    it("parses --only after description", () => {
      const r = parseCommand("init fix the bug --only");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({ op: "init", only: true, description: "fix the bug" });
    });

    it("parses --only with no description", () => {
      const r = parseCommand("init --only");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.command).toEqual({ op: "init", only: true, description: "" });
    });

    it("rejects unknown flag", () => {
      const r = parseCommand("init --foo do a thing");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reply).toContain("--foo");
    });
  });

  describe("removed commands now reject", () => {
    for (const op of ["execute", "review", "create-pr", "autonomous"]) {
      it(`rejects ${op}`, () => {
        const r = parseCommand(`${op} myws`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reply).toContain("Unknown");
      });
    }
  });

  describe("help / unknown / empty", () => {
    it("returns USAGE on help", () => {
      const r = parseCommand("help");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reply).toBe(USAGE);
    });

    it("returns USAGE on empty input", () => {
      const r = parseCommand("");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reply).toBe(USAGE);
    });

    it("returns Unknown reply on unrecognized op", () => {
      const r = parseCommand("doSomething");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reply).toContain("Unknown");
    });
  });
});
