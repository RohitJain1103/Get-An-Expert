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
  fireReconnecting(): void {
    this.events.onReconnecting?.(1);
  }
  fireResumed(status: { status?: string; expertName?: string } = { status: "waiting" }): void {
    this.events.onResumed?.(status);
  }
  fireResumeFailed(): void {
    this.events.onResumeFailed?.();
  }
  fireSessionEnded(reason?: string): void {
    this.events.onSessionEnded?.(reason);
  }
  fireExpertJoined(name = "Priya Sharma"): void {
    this.events.onExpertJoined?.(name);
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
  /** A session whose peers are observable, wired to a controllable relay. */
  function sessionWithPeers(relay: FakeRelay) {
    const peers: { closed: boolean }[] = [];
    const session = new AgentSession({
      relayUrl: "ws://relay.test",
      projectDir,
      customerName: "Jordan Lee",
      browser: fakeBrowser,
      relayClientFactory: () => relay,
      peerFactory: () => {
        const peer = {
          closed: false,
          onChannel: () => {},
          onError: () => {},
          handleSignal: () => {},
          close() {
            this.closed = true;
          },
        };
        peers.push(peer);
        return peer;
      },
    });
    return { session, peers };
  }

  it("stays alive (not ended) while the relay client reconnects", async () => {
    const relay = new FakeRelay();
    const session = makeSessionWithRelay(relay);
    await session.requestExpert("x");
    relay.fireReconnecting();
    expect(session.state).not.toBe("ended");
    // The resume record survives so the reconnect can rejoin.
    expect(readResume()).not.toBeNull();
  });

  it("keeps the live peer (and terminal) alive across a relay blip", async () => {
    const relay = new FakeRelay();
    const { session, peers } = sessionWithPeers(relay);
    await session.requestExpert("x");
    relay.fireExpertJoined();
    expect(peers).toHaveLength(1);

    relay.fireReconnecting();
    // The root-cause fix: a relay-socket blip must NOT tear down the P2P peer.
    expect(peers[0]!.closed).toBe(false);
    expect(session.state).toBe("connected");

    // Resuming to a still-active session leaves the peer untouched.
    relay.fireResumed({ status: "active", expertName: "Priya Sharma" });
    expect(peers[0]!.closed).toBe(false);
    expect(session.state).toBe("connected");
    await session.end("done");
  });

  it("tears the kept peer down if the expert was released during the outage", async () => {
    const relay = new FakeRelay();
    const { session, peers } = sessionWithPeers(relay);
    await session.requestExpert("x");
    relay.fireExpertJoined();
    relay.fireReconnecting();
    expect(peers[0]!.closed).toBe(false);

    // Stayed offline past grace: the relay resumes us to a waiting session.
    relay.fireResumed({ status: "waiting" });
    expect(peers[0]!.closed).toBe(true);
    expect(session.state).toBe("waiting");
    await session.end("done");
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

describe("AgentSession expert re-join", () => {
  it("tears down the stale peer when the expert re-claims (fresh expert-joined)", async () => {
    const relay = new FakeRelay();
    const peers: { closed: boolean }[] = [];
    const session = new AgentSession({
      relayUrl: "ws://relay.test",
      projectDir,
      customerName: "Jordan Lee",
      browser: fakeBrowser,
      relayClientFactory: () => relay,
      peerFactory: () => {
        const peer = {
          closed: false,
          onChannel: () => {},
          onError: () => {},
          handleSignal: () => {},
          close() {
            this.closed = true;
          },
        };
        peers.push(peer);
        return peer;
      },
    });
    await session.requestExpert("bug");
    relay.fireExpertJoined();
    expect(peers).toHaveLength(1);
    // Dashboard refresh: the same expert re-claims — a second expert-joined
    // arrives while the first peer still exists.
    relay.fireExpertJoined();
    expect(peers).toHaveLength(2);
    expect(peers[0]!.closed).toBe(true);
    expect(peers[1]!.closed).toBe(false);
    await session.end("test over");
  });
});
