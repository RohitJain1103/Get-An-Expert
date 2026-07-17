import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readResume, type ResumeRecord } from "@get-an-expert/core/relay";
import { AgentSession } from "./agent-session";
import { buildChatUrl } from "./chat-url";
import type { Grant } from "./permissions";
import type {
  RegisterInput,
  RelayClientEvents,
  RelayConnection,
} from "./relay-client";
import type { ActivityEntry, BrowserController } from "./types";

/** No real browser needed for these tests — and none should ever launch. */
const fakeBrowser: BrowserController = {
  screenshot: async () => ({ ok: false, port: 3000, note: "test stub" }),
  console: async () => ({ port: 3000, entries: [] }),
  close: async () => {},
};

/** An in-process relay connection: no network, event firing under test control. */
class FakeRelay implements RelayConnection {
  sessionId: string | undefined;
  customerToken: string | undefined = "cust-tok";
  resumeToken: string | undefined;
  events: RelayClientEvents = {};
  reportedPermissions: Grant[] = [];
  endedReason?: string;
  closed = false;

  on(events: RelayClientEvents): void {
    this.events = { ...this.events, ...events };
  }
  async register(_input: RegisterInput): Promise<string> {
    this.sessionId = "sess-1";
    this.resumeToken = "resume-1";
    return this.sessionId;
  }
  async resume(sessionId: string, resumeToken: string): Promise<void> {
    this.sessionId = sessionId;
    this.resumeToken = resumeToken;
  }
  reportPermissions(permissions: Grant): void {
    this.reportedPermissions.push(permissions);
  }
  reportActivity(): void {}
  sendSignal(): void {}
  end(reason?: string): void {
    this.endedReason = reason ?? "ended";
  }
  close(): void {
    this.closed = true;
  }
  // Test controls for the relay-driven events.
  fireExpertJoined(name: string, profile?: unknown): void {
    this.events.onExpertJoined?.(name, profile as never);
  }
  fireExpertLeft(): void {
    this.events.onExpertLeft?.();
  }
  fireReconnecting(): void {
    this.events.onReconnecting?.(1);
  }
  fireResumed(): void {
    this.events.onResumed?.({ status: "waiting" });
  }
  fireResumeFailed(): void {
    this.events.onResumeFailed?.();
  }
  fireSessionEnded(reason?: string): void {
    this.events.onSessionEnded?.(reason);
  }
  fireIssueUpdated(issue: string): void {
    this.events.onIssueUpdated?.(issue);
  }
  fireDelivered(summary: string): void {
    this.events.onDelivered?.(summary);
  }
  fireDeliveryAccepted(): void {
    this.events.onDeliveryAccepted?.();
  }
  fireDeliveryDeclined(): void {
    this.events.onDeliveryDeclined?.();
  }
}

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "get-an-expert-session-")));
  // Isolate the ~/.get-an-expert files (resume/status) from the real home dir.
  homeDir = realpathSync(mkdtempSync(join(tmpdir(), "get-an-expert-home-")));
  process.env.GET_AN_EXPERT_HOME = homeDir;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.GET_AN_EXPERT_HOME;
});

function makeSession(onActivity?: (entry: ActivityEntry) => void): AgentSession {
  return new AgentSession({
    relayUrl: "ws://127.0.0.1:1",
    projectDir,
    customerName: "Jordan Lee",
    browser: fakeBrowser,
    onActivity,
  });
}

function makeSessionWithRelay(relay: FakeRelay): AgentSession {
  return new AgentSession({
    relayUrl: "ws://relay.test",
    projectDir,
    customerName: "Jordan Lee",
    browser: fakeBrowser,
    relayClientFactory: () => relay,
  });
}

const fullGrant: Grant = {
  files: true,
  terminal: true,
  browser: true,
  browserPort: 3000,
};

describe("AgentSession.writeContext", () => {
  it("writes CONTEXT.md under .get-an-expert and logs the activity", async () => {
    const entries: ActivityEntry[] = [];
    const session = makeSession((entry) => entries.push(entry));

    await session.writeContext("# Get An Expert — session context\n");

    const path = join(projectDir, ".get-an-expert", "CONTEXT.md");
    expect(readFileSync(path, "utf8")).toContain("session context");
    const entry = session.activity().find((e) => e.kind === "context");
    expect(entry?.summary).toBe("Session context written: .get-an-expert/CONTEXT.md");
    expect(entries.some((e) => e.kind === "context")).toBe(true);

    await session.end();
  });
});

describe("AgentSession.end", () => {
  it("removes the .get-an-expert directory on end", async () => {
    const session = makeSession();
    await session.writeContext("context");
    const dir = join(projectDir, ".get-an-expert");
    expect(existsSync(dir)).toBe(true);

    await session.end();
    expect(existsSync(dir)).toBe(false);
  });

  it("ends cleanly when no context was ever written", async () => {
    const session = makeSession();
    await session.end();
    expect(existsSync(join(projectDir, ".get-an-expert"))).toBe(false);
    expect(session.state).toBe("ended");
  });
});

describe("AgentSession.chatUrl", () => {
  it("is undefined before registration (no session id or token)", () => {
    const session = makeSession();
    expect(session.chatUrl).toBeUndefined();
    expect(session.status().chatUrl).toBeUndefined();
  });
});

describe("buildChatUrl", () => {
  it("converts ws:// to http://", () => {
    expect(buildChatUrl("ws://127.0.0.1:8787", "abc123", "deadbeef")).toBe(
      "http://127.0.0.1:8787/chat#abc123.deadbeef",
    );
  });

  it("converts wss:// to https://", () => {
    expect(buildChatUrl("wss://relay.example.com", "abc123", "deadbeef")).toBe(
      "https://relay.example.com/chat#abc123.deadbeef",
    );
  });

  it("strips trailing slashes before appending the path", () => {
    expect(buildChatUrl("wss://relay.example.com///", "abc", "def")).toBe(
      "https://relay.example.com/chat#abc.def",
    );
  });

  it("leaves an http(s) relay URL scheme untouched", () => {
    expect(buildChatUrl("https://relay.example.com/", "abc", "def")).toBe(
      "https://relay.example.com/chat#abc.def",
    );
  });
});

describe("AgentSession resume persistence", () => {
  it("writes a resume record on request (no grant yet) and adds the grant on approval", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);

    await session.requestExpert("build is broken");
    let record = readResume();
    expect(record?.sessionId).toBe("sess-1");
    expect(record?.resumeToken).toBe("resume-1");
    expect(record?.issue).toBe("build is broken");
    expect(record?.grant).toBeUndefined();

    session.grant(fullGrant);
    record = readResume();
    expect(record?.grant).toEqual(fullGrant);
  });

  it("clears the resume record when the session ends", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);
    await session.requestExpert("x");
    expect(readResume()).not.toBeNull();
    await session.end();
    expect(readResume()).toBeNull();
    expect(relay.closed).toBe(true);
  });
});

describe("AgentSession reconnect", () => {
  it("stays alive (not ended) while the relay client reconnects", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);
    await session.requestExpert("x");
    relay.fireReconnecting();
    expect(session.state).not.toBe("ended");
    // The resume record survives so the reconnect can rejoin.
    expect(readResume()).not.toBeNull();
  });

  it("re-reports the approved scopes when the relay resumes", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);
    await session.requestExpert("x");
    session.grant(fullGrant);
    const before = relay.reportedPermissions.length;
    relay.fireResumed();
    expect(relay.reportedPermissions.length).toBeGreaterThan(before);
  });

  it("ends and clears the resume record when the relay says the session is gone", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);
    await session.requestExpert("x");
    relay.fireResumeFailed();
    expect(session.state).toBe("ended");
    expect(readResume()).toBeNull();
  });
});

describe("AgentSession expert profile", () => {
  const rohit = {
    id: "rohit",
    name: "Rohit Jain",
    photo: "/experts/rohit.jpg",
    role: "Senior software engineer",
    companies: [{ logo: "/experts/amazon.jpg", label: "Amazon" }],
    tag: "Code, payments & APIs",
    rating: 4.8,
    fixesDelivered: 12,
  };

  // A no-op peer so a claim doesn't spin up a real WebRTC connection.
  function makeSessionWithFakePeer(relay: FakeRelay): AgentSession {
    return new AgentSession({
      relayUrl: "ws://relay.test",
      projectDir,
      customerName: "Jordan Lee",
      browser: fakeBrowser,
      relayClientFactory: () => relay,
      peerFactory: () => ({
        onChannel() {},
        onError() {},
        handleSignal() {},
        close() {},
      }),
    });
  }

  it("stores the profile from expert-joined and exposes it in status()", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithFakePeer(relay);
    await session.requestExpert("x");
    relay.fireExpertJoined("Rohit Jain", rohit);

    expect(session.state).toBe("connected");
    expect(session.expertName).toBe("Rohit Jain");
    expect(session.expertProfile?.id).toBe("rohit");
    expect(session.status().expertProfile?.rating).toBe(4.8);

    await session.end();
  });

  it("clears the profile when the expert leaves", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithFakePeer(relay);
    await session.requestExpert("x");
    relay.fireExpertJoined("Rohit Jain", rohit);
    relay.fireExpertLeft();

    expect(session.expertProfile).toBeUndefined();
    expect(session.status().expertProfile).toBeUndefined();

    await session.end();
  });

  it("connects without a profile when the relay sends only a name", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithFakePeer(relay);
    await session.requestExpert("x");
    relay.fireExpertJoined("Someone");

    expect(session.state).toBe("connected");
    expect(session.expertName).toBe("Someone");
    expect(session.expertProfile).toBeUndefined();

    await session.end();
  });
});

describe("AgentSession issue updates", () => {
  const contextInput = () => ({
    customerName: "Jordan Lee",
    issue: "original issue text",
    summary: "where they are stuck",
    overview: null,
    transcriptMarkdown: undefined,
    requestedAt: Date.now(),
  });

  it("rebuilds CONTEXT.md and updates status().issue on issue-updated", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);
    await session.requestExpert("original issue text");
    await session.writeContextFrom(contextInput());
    const path = join(projectDir, ".get-an-expert", "CONTEXT.md");
    expect(readFileSync(path, "utf8")).toContain("original issue text");

    relay.fireIssueUpdated("the revised issue statement");
    await new Promise((r) => setTimeout(r, 30));

    expect(session.status().issue).toBe("the revised issue statement");
    const md = readFileSync(path, "utf8");
    expect(md).toContain("the revised issue statement");
    expect(md).not.toContain("original issue text");

    await session.end();
  });

  it("triggers exactly one context rebuild per issue update", async () => {
    const entries: ActivityEntry[] = [];
    const relay = new FakeRelay();
    const session = new AgentSession({
      relayUrl: "ws://relay.test",
      projectDir,
      customerName: "Jordan Lee",
      browser: fakeBrowser,
      relayClientFactory: () => relay,
      onActivity: (e) => entries.push(e),
    });
    await session.requestExpert("original issue text");
    await session.writeContextFrom(contextInput()); // first context write
    relay.fireIssueUpdated("second version");
    await new Promise((r) => setTimeout(r, 30));
    const contextEntries = entries.filter((e) => e.kind === "context");
    expect(contextEntries.length).toBe(2); // initial + one rebuild

    await session.end();
  });

  it("updates the issue but writes no file when no context was assembled yet", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);
    await session.requestExpert("original issue text");
    relay.fireIssueUpdated("edited before context existed");
    await new Promise((r) => setTimeout(r, 20));
    expect(session.status().issue).toBe("edited before context existed");
    expect(existsSync(join(projectDir, ".get-an-expert"))).toBe(false);

    await session.end();
  });
});

describe("AgentSession.resumeExpert", () => {
  const record: ResumeRecord = {
    sessionId: "sess-restored",
    resumeToken: "resume-restored",
    relayUrl: "ws://relay.test",
    projectDir: "/tmp/whatever",
    customerName: "Jordan Lee",
    issue: "was mid-request",
    grant: { files: true, terminal: true, browser: false },
    createdAt: Date.now() - 1000,
  };

  it("reconnects, re-arms the approved scopes, and logs that access is live", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);

    const { sessionId } = await session.resumeExpert(record);
    expect(sessionId).toBe("sess-restored");
    expect(session.state).toBe("waiting");
    // The previously approved scopes are re-armed and reported to the relay.
    expect(relay.reportedPermissions.at(-1)).toMatchObject({
      files: true,
      terminal: true,
      browser: false,
    });
    // A visible activity entry tells the customer access was re-armed.
    expect(session.activity().some((e) => e.kind === "resume")).toBe(true);
    // The resume record is refreshed and still present.
    expect(readResume()?.sessionId).toBe("sess-restored");

    await session.end();
  });
})

describe("AgentSession delivery status", () => {
  // A no-op peer so a claim doesn't spin up a real WebRTC connection.
  function makeSessionFakePeer(relay: FakeRelay): AgentSession {
    return new AgentSession({
      relayUrl: "ws://relay.test",
      projectDir,
      customerName: "Jordan Lee",
      browser: fakeBrowser,
      relayClientFactory: () => relay,
      peerFactory: () => ({
        onChannel() {},
        onError() {},
        handleSignal() {},
        close() {},
      }),
    });
  }

  it("records a delivered fix and the customer confirmation in status()", async () => {
    const relay = new FakeRelay();
    const session = makeSessionFakePeer(relay);
    await session.requestExpert("fix the thing");
    relay.fireExpertJoined("Rohit Jain");
    expect(session.state).toBe("connected");

    relay.fireDelivered("renamed and rebuilt");
    expect(session.lastDelivery).toEqual({ summary: "renamed and rebuilt" });
    expect(session.status().lastDelivery).toEqual({ summary: "renamed and rebuilt" });

    relay.fireDeliveryAccepted();
    expect(session.lastDelivery).toEqual({ summary: "renamed and rebuilt", accepted: true });

    await session.end();
  });

  it("marks a declined delivery without a confirmation", async () => {
    const relay = new FakeRelay();
    const session = makeSessionFakePeer(relay);
    await session.requestExpert("x");
    relay.fireExpertJoined("Rohit Jain");
    relay.fireDelivered("attempt one");
    relay.fireDeliveryDeclined();
    expect(session.lastDelivery).toEqual({ summary: "attempt one", accepted: false });

    await session.end();
  });
});
