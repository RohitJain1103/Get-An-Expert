import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@get-an-expert/core";
import { formatEventConfirmation, formatIncoming, parseInput } from "./format";

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  seq: 1,
  at: "2026-07-13T00:00:00.000Z",
  from: "expert",
  kind: "message",
  text: "hi",
  ...over,
});

describe("parseInput", () => {
  it("plain text is a message", () => {
    expect(parseInput("  hello there ")).toEqual({
      type: "message",
      text: "hello there",
    });
  });
  it("empty input is ignored", () => {
    expect(parseInput("   ")).toEqual({ type: "empty" });
  });
  it("/end ends", () => {
    expect(parseInput("/end")).toEqual({ type: "end" });
  });
  it("/pause defaults to 15 minutes", () => {
    expect(parseInput("/pause")).toEqual({ type: "pause", minutes: 15 });
  });
  it("/pause 30 pauses for 30 minutes", () => {
    expect(parseInput("/pause 30")).toEqual({ type: "pause", minutes: 30 });
  });
  it("/pause off resumes", () => {
    expect(parseInput("/pause off")).toEqual({ type: "pause-off" });
  });
  it("/pause garbage is refused, not sent", () => {
    expect(parseInput("/pause never")).toEqual({
      type: "unknown-command",
      command: "/pause never",
    });
  });
  it("unknown slash commands are flagged, not sent", () => {
    expect(parseInput("/quit")).toEqual({
      type: "unknown-command",
      command: "/quit",
    });
  });
});

describe("formatEventConfirmation", () => {
  const event = (eventType: ChatMessage["eventType"]): ChatMessage =>
    msg({ kind: "event", eventType, from: "user", text: "…" });

  it("names the expert when known", () => {
    expect(formatEventConfirmation(event("command"), "Priya")).toBe(
      "⟢ your last run is visible to Priya",
    );
  });
  it("falls back when the expert has not joined yet", () => {
    expect(formatEventConfirmation(event("prompt"), undefined)).toBe(
      "⟢ your prompt is visible to the expert",
    );
  });
  it("labels each event type", () => {
    expect(formatEventConfirmation(event("edit"), "P")).toContain("file edit");
    expect(formatEventConfirmation(event("agent_reply"), "P")).toContain(
      "assistant reply",
    );
    expect(formatEventConfirmation(event("output"), "P")).toContain("output");
  });
});

describe("formatIncoming", () => {
  it("expert messages show the expert's name", () => {
    expect(formatIncoming(msg({ authorName: "Priya" }))).toBe("[Priya] hi");
  });
  it("expert messages without a name fall back", () => {
    expect(formatIncoming(msg({}))).toBe("[expert] hi");
  });
  it("own messages render as [you]", () => {
    expect(formatIncoming(msg({ from: "user", text: "mine" }))).toBe(
      "[you] mine",
    );
  });
  it("system notices render as a dot line", () => {
    expect(
      formatIncoming(msg({ kind: "system", text: "Priya joined the chat" })),
    ).toBe("· Priya joined the chat");
  });
});
