import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import {
  MIN_HUMAN_DECLINE_MS,
  SCOPES_CONFIRM_GUIDANCE,
  buildDeclinedMessage,
  buildElicitationFailedMessage,
  buildScopesMessage,
  canFinalizePending,
  resolveScopeElicitation,
} from "./consent";

describe("buildDeclinedMessage", () => {
  it("returns the standard decline copy", () => {
    expect(buildDeclinedMessage()).toBe(
      "No access was granted, so the request was cancelled. Nothing runs on your machine without your approval.",
    );
  });
});

describe("buildElicitationFailedMessage", () => {
  it("mentions retrying and is distinct from a decline", () => {
    const msg = buildElicitationFailedMessage();
    expect(msg.toLowerCase()).toContain("again");
    expect(msg).not.toBe(buildDeclinedMessage());
  });
});

describe("buildScopesMessage", () => {
  it("includes the project dir, browser port, and all three scopes", () => {
    const msg = buildScopesMessage("/Users/pat/project", 4000);
    expect(msg).toContain("/Users/pat/project");
    expect(msg).toContain("localhost:4000");
    expect(msg).toMatch(/files/i);
    expect(msg).toMatch(/terminal/i);
    expect(msg).toMatch(/browser/i);
  });

  it("does not imply anything is already granted", () => {
    const msg = buildScopesMessage("/proj", 3000);
    expect(msg.toLowerCase()).not.toContain("already granted");
    expect(msg.toLowerCase()).not.toContain("has been granted");
    expect(msg.toLowerCase()).toContain("nothing is granted until you say so");
  });

  it("offers a dismissed variant that keeps the scopes and an explicit way out", () => {
    const msg = buildScopesMessage("/Users/pat/project", 4000, "dismissed");
    expect(msg).toContain("/Users/pat/project");
    expect(msg).toContain("localhost:4000");
    expect(msg).toMatch(/files/i);
    expect(msg).toMatch(/terminal/i);
    expect(msg).toMatch(/browser/i);
    expect(msg.toLowerCase()).toContain("nothing is granted until you say so");
    // The prompt may have been deliberately dismissed — never pressure past a no.
    expect(msg.toLowerCase()).toContain("just say no");
    // Unlike the unsupported variant, don't claim the client can't show prompts.
    expect(msg.toLowerCase()).not.toContain("can't show");
  });
});

describe("SCOPES_CONFIRM_GUIDANCE", () => {
  it("references confirm_expert_scopes and waiting for the user's reply", () => {
    expect(SCOPES_CONFIRM_GUIDANCE).toContain("confirm_expert_scopes");
    expect(SCOPES_CONFIRM_GUIDANCE.toLowerCase()).toContain("wait for their");
  });
});

describe("canFinalizePending", () => {
  const pending = { sessionId: "sess-1" };
  const active = { state: "waiting", sessionId: "sess-1" };

  it("allows finalizing when a pending confirmation matches the active session", () => {
    expect(canFinalizePending(pending, active)).toBe(true);
    expect(canFinalizePending(pending, { state: "connected", sessionId: "sess-1" })).toBe(true);
  });

  it("fails closed with no pending confirmation or no session", () => {
    expect(canFinalizePending(undefined, active)).toBe(false);
    expect(canFinalizePending(pending, undefined)).toBe(false);
  });

  it("rejects an ended or idle session (e.g. after end_session)", () => {
    expect(canFinalizePending(pending, { state: "ended", sessionId: "sess-1" })).toBe(false);
    expect(canFinalizePending(pending, { state: "idle", sessionId: "sess-1" })).toBe(false);
  });

  it("rejects a confirmation from a different session (no replay across sessions)", () => {
    expect(canFinalizePending(pending, { state: "waiting", sessionId: "sess-2" })).toBe(false);
  });

  it("rejects when either session id is missing", () => {
    expect(canFinalizePending({ sessionId: undefined }, active)).toBe(false);
    expect(canFinalizePending(pending, { state: "waiting", sessionId: undefined })).toBe(false);
  });
});

describe("resolveScopeElicitation", () => {
  const base = { dir: "/proj", port: 3000 };

  it("returns unsupported and never calls elicit when capability is absent", async () => {
    const elicit = vi.fn();
    const outcome = await resolveScopeElicitation({ ...base, capabilities: undefined, elicit });
    expect(outcome).toEqual({ kind: "unsupported" });
    expect(elicit).not.toHaveBeenCalled();
  });

  it("returns declined when the user declines at a human pace", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1000 + 5000);
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
      now,
    });
    expect(outcome).toEqual({ kind: "declined" });
  });

  it("returns declined at exactly the human-decline threshold", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(MIN_HUMAN_DECLINE_MS);
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
      now,
    });
    expect(outcome).toEqual({ kind: "declined" });
  });

  it("returns dismissed when a decline arrives faster than a human could read the form", async () => {
    // Hosts that advertise elicitation but never render it (e.g. the Claude
    // Code desktop GUI) auto-answer in milliseconds.
    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1050);
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
      now,
    });
    expect(outcome).toEqual({ kind: "dismissed" });
  });

  it("treats an un-injected instant decline as dismissed (default Date.now wiring)", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
    });
    expect(outcome).toEqual({ kind: "dismissed" });
  });

  it("returns dismissed on cancel regardless of timing", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "cancel" });
    const slow = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(60_000);
    expect(
      await resolveScopeElicitation({
        ...base,
        capabilities: { elicitation: {} },
        elicit,
        now: slow,
      }),
    ).toEqual({ kind: "dismissed" });
    expect(
      await resolveScopeElicitation({ ...base, capabilities: { elicitation: {} }, elicit }),
    ).toEqual({ kind: "dismissed" });
  });

  it("returns unsupported when the SDK refuses locally over a missing elicitation mode", async () => {
    // @modelcontextprotocol/sdk throws a plain Error (not McpError) when the
    // client advertises elicitation without the form mode we need.
    const elicit = vi
      .fn()
      .mockRejectedValue(new Error("Client does not support form elicitation."));
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
    });
    expect(outcome).toEqual({ kind: "unsupported" });
  });

  it("returns unsupported when the client rejects elicitation as method-not-found", async () => {
    // A host that advertises the capability but never implemented the method
    // behaves like one that never advertised it.
    const elicit = vi
      .fn()
      .mockRejectedValue(new McpError(ErrorCode.MethodNotFound, "Method not found"));
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
    });
    expect(outcome).toEqual({ kind: "unsupported" });
  });

  it("does not time-gate accepts — an instant accept is still granted", async () => {
    const elicit = vi.fn().mockResolvedValue({
      action: "accept",
      content: { files: true, terminal: true, browser: false, conversation: false },
    });
    const now = vi.fn().mockReturnValue(1000);
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
      now,
    });
    expect(outcome.kind).toBe("granted");
  });

  it("returns declined when the user accepts but approves nothing", async () => {
    const elicit = vi.fn().mockResolvedValue({
      action: "accept",
      content: { files: false, terminal: false, browser: false, conversation: true },
    });
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
    });
    expect(outcome).toEqual({ kind: "declined" });
  });

  it("returns failed when the elicit call throws", async () => {
    const elicit = vi.fn().mockRejectedValue(new Error("transport closed"));
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
    });
    expect(outcome).toEqual({ kind: "failed" });
  });

  it("returns granted with the approved scopes and browserPort when browser is approved", async () => {
    const elicit = vi.fn().mockResolvedValue({
      action: "accept",
      content: { files: true, terminal: false, browser: true, conversation: true },
    });
    const outcome = await resolveScopeElicitation({
      dir: "/proj",
      port: 4000,
      capabilities: { elicitation: {} },
      elicit,
    });
    expect(outcome).toEqual({
      kind: "granted",
      consent: {
        grant: { files: true, terminal: false, browser: true, browserPort: 4000 },
        shareTranscript: true,
      },
    });
  });

  it("omits browserPort when browser is not approved", async () => {
    const elicit = vi.fn().mockResolvedValue({
      action: "accept",
      content: { files: true, terminal: true, browser: false, conversation: false },
    });
    const outcome = await resolveScopeElicitation({
      ...base,
      capabilities: { elicitation: {} },
      elicit,
    });
    expect(outcome).toEqual({
      kind: "granted",
      consent: {
        grant: { files: true, terminal: true, browser: false },
        shareTranscript: false,
      },
    });
  });
});
