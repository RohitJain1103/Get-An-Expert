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

/** Copy that must never appear in any consent surface (elicitation prompt or
 * plain-language fallback): the phrases we promised legal/positioning we would
 * not use, plus the em dash. */
const FORBIDDEN_SUBSTRINGS = ["sandboxed", "on your machine", "machine access"];
const EM_DASH = "—";

function expectClean(text: string): void {
  const lower = text.toLowerCase();
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    expect(lower).not.toContain(bad);
  }
  expect(text).not.toContain(EM_DASH);
}

describe("buildDeclinedMessage", () => {
  it("returns decline copy free of forbidden phrasing", () => {
    const msg = buildDeclinedMessage();
    expect(msg.toLowerCase()).toContain("no access was granted");
    expectClean(msg);
  });
});

describe("buildElicitationFailedMessage", () => {
  it("mentions retrying and is distinct from a decline", () => {
    const msg = buildElicitationFailedMessage();
    expect(msg.toLowerCase()).toContain("again");
    expect(msg).not.toBe(buildDeclinedMessage());
    expectClean(msg);
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

  it("ends with the calm yes-or-choose invitation and does not imply a prior grant", () => {
    const msg = buildScopesMessage("/proj", 3000);
    expect(msg.toLowerCase()).not.toContain("already granted");
    expect(msg.toLowerCase()).not.toContain("has been granted");
    // The assurance carries the not-yet-granted promise in one voice.
    expect(msg.toLowerCase()).toContain("nothing is accessed or shared until you approve");
    expect(msg.trimEnd()).toMatch(/reply yes to approve, or tell me which parts\.?$/i);
  });

  it("offers a dismissed variant that still lets the user cleanly decline", () => {
    const msg = buildScopesMessage("/Users/pat/project", 4000, "dismissed");
    expect(msg).toContain("/Users/pat/project");
    expect(msg).toContain("localhost:4000");
    expect(msg).toMatch(/files/i);
    // The prompt may have been deliberately dismissed — never pressure past a no.
    expect(msg.toLowerCase()).toContain("no");
    // Unlike the unsupported variant, don't claim the client can't show prompts.
    expect(msg.toLowerCase()).not.toContain("can't show");
  });

  it("keeps both variants free of forbidden phrasing", () => {
    expectClean(buildScopesMessage("/proj", 3000, "unsupported"));
    expectClean(buildScopesMessage("/proj", 3000, "dismissed"));
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
  const caps = { elicitation: {} };

  it("returns unsupported and never calls elicit when capability is absent", async () => {
    const elicit = vi.fn();
    const outcome = await resolveScopeElicitation({ ...base, capabilities: undefined, elicit });
    expect(outcome).toEqual({ kind: "unsupported" });
    expect(elicit).not.toHaveBeenCalled();
  });

  it("presents a single decision field with approve preselected", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: { decision: "approve" } });
    await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    const schema = elicit.mock.calls[0][0].requestedSchema;
    expect(Object.keys(schema.properties)).toEqual(["decision"]);
    expect(schema.properties.decision.default).toBe("approve");
    const consts = schema.properties.decision.oneOf.map((o: { const: string }) => o.const);
    expect(consts).toEqual(["approve", "choose", "decline"]);
  });

  it("grants all three scopes and shares the conversation on approve", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: { decision: "approve" } });
    const outcome = await resolveScopeElicitation({
      dir: "/proj",
      port: 4000,
      capabilities: caps,
      elicit,
    });
    expect(outcome).toEqual({
      kind: "granted",
      consent: {
        grant: { files: true, terminal: true, browser: true, browserPort: 4000 },
        shareTranscript: true,
      },
    });
    expect(elicit).toHaveBeenCalledTimes(1);
  });

  it("declines when the user picks the decline option", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: { decision: "decline" } });
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    expect(outcome).toEqual({ kind: "declined" });
    expect(elicit).toHaveBeenCalledTimes(1);
  });

  it("choose issues a second per-scope prompt and grants exactly what is picked", async () => {
    const elicit = vi
      .fn()
      .mockResolvedValueOnce({ action: "accept", content: { decision: "choose" } })
      .mockResolvedValueOnce({
        action: "accept",
        content: { files: true, terminal: false, browser: true, conversation: false },
      });
    const outcome = await resolveScopeElicitation({
      dir: "/proj",
      port: 4000,
      capabilities: caps,
      elicit,
    });
    expect(outcome).toEqual({
      kind: "granted",
      consent: {
        grant: { files: true, terminal: false, browser: true, browserPort: 4000 },
        shareTranscript: false,
      },
    });
    expect(elicit).toHaveBeenCalledTimes(2);
    // The second prompt is the per-scope form, not the decision enum.
    const second = elicit.mock.calls[1][0].requestedSchema;
    expect(Object.keys(second.properties).sort()).toEqual([
      "browser",
      "conversation",
      "files",
      "terminal",
    ]);
  });

  it("choose then approving nothing is a decline", async () => {
    const elicit = vi
      .fn()
      .mockResolvedValueOnce({ action: "accept", content: { decision: "choose" } })
      .mockResolvedValueOnce({
        action: "accept",
        content: { files: false, terminal: false, browser: false, conversation: true },
      });
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    expect(outcome).toEqual({ kind: "declined" });
  });

  it("choose then dismissing the second prompt is dismissed, not a decline", async () => {
    const elicit = vi
      .fn()
      .mockResolvedValueOnce({ action: "accept", content: { decision: "choose" } })
      .mockResolvedValueOnce({ action: "cancel" });
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    expect(outcome).toEqual({ kind: "dismissed" });
  });

  it("omits browserPort when the chosen scopes exclude browser", async () => {
    const elicit = vi
      .fn()
      .mockResolvedValueOnce({ action: "accept", content: { decision: "choose" } })
      .mockResolvedValueOnce({
        action: "accept",
        content: { files: true, terminal: true, browser: false, conversation: false },
      });
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    expect(outcome).toEqual({
      kind: "granted",
      consent: {
        grant: { files: true, terminal: true, browser: false },
        shareTranscript: false,
      },
    });
  });

  it("returns declined when the user declines at a human pace", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1000 + 5000);
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit, now });
    expect(outcome).toEqual({ kind: "declined" });
  });

  it("returns declined at exactly the human-decline threshold", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(MIN_HUMAN_DECLINE_MS);
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit, now });
    expect(outcome).toEqual({ kind: "declined" });
  });

  it("returns dismissed when a non-accept arrives faster than a human could read it", async () => {
    // Hosts that advertise elicitation but never render it (e.g. the Claude
    // Code desktop GUI) auto-answer in milliseconds.
    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1050);
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit, now });
    expect(outcome).toEqual({ kind: "dismissed" });
  });

  it("treats an un-injected instant decline as dismissed (default clock wiring)", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "decline" });
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    expect(outcome).toEqual({ kind: "dismissed" });
  });

  it("returns dismissed on cancel regardless of timing", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "cancel" });
    const slow = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(60_000);
    expect(
      await resolveScopeElicitation({ ...base, capabilities: caps, elicit, now: slow }),
    ).toEqual({ kind: "dismissed" });
    expect(await resolveScopeElicitation({ ...base, capabilities: caps, elicit })).toEqual({
      kind: "dismissed",
    });
  });

  it("returns unsupported when the SDK refuses locally over a missing elicitation mode", async () => {
    const elicit = vi
      .fn()
      .mockRejectedValue(new Error("Client does not support form elicitation."));
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    expect(outcome).toEqual({ kind: "unsupported" });
  });

  it("returns unsupported when the client rejects elicitation as method-not-found", async () => {
    const elicit = vi
      .fn()
      .mockRejectedValue(new McpError(ErrorCode.MethodNotFound, "Method not found"));
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    expect(outcome).toEqual({ kind: "unsupported" });
  });

  it("does not time-gate an approve — an instant approve is still granted", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: { decision: "approve" } });
    const now = vi.fn().mockReturnValue(1000);
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit, now });
    expect(outcome.kind).toBe("granted");
  });

  it("returns failed when the elicit call throws", async () => {
    const elicit = vi.fn().mockRejectedValue(new Error("transport closed"));
    const outcome = await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    expect(outcome).toEqual({ kind: "failed" });
  });

  it("keeps the inline prompt copy free of forbidden phrasing", async () => {
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: { decision: "approve" } });
    await resolveScopeElicitation({ ...base, capabilities: caps, elicit });
    const params = elicit.mock.calls[0][0];
    expectClean(params.message);
    expectClean(params.requestedSchema.properties.decision.description ?? "");
  });
});
