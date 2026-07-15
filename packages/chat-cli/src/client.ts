import { redactText, type ChatMessage } from "@get-an-expert/core";

export interface ChatClientOptions {
  baseUrl: string;
  requestId: string;
  token: string;
}

export type FetchMessagesResult =
  | {
      ok: true;
      messages: ChatMessage[];
      chatStatus: "active" | "ended";
      expertName?: string;
    }
  | { ok: false; error: string };

export type PostMessageResult =
  | { ok: true; seq: number }
  | { ok: false; error: string; ended?: boolean };

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string | null;
}

const TIMEOUT_MS = 10_000;
const UNREACHABLE =
  "Get An Expert could not be reached — check your connection; retrying keeps your chat intact.";

export class ChatClient {
  constructor(private opts: ChatClientOptions) {}

  private url(path: string): string {
    return `${this.opts.baseUrl}/api/v1/requests/${this.opts.requestId}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      "x-chat-token": this.opts.token,
      "content-type": "application/json",
    };
  }

  async fetchMessages(after: number): Promise<FetchMessagesResult> {
    let response: Response;
    try {
      response = await fetch(this.url(`/messages?after=${after}`), {
        headers: this.headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: UNREACHABLE };
    }
    const envelope = await this.parse<{
      messages: ChatMessage[];
      chat: { status: "active" | "ended"; expertName?: string | null } | null;
    }>(response);
    if (!envelope?.success || !envelope.data) {
      return {
        ok: false,
        error: envelope?.error ?? `HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      messages: envelope.data.messages,
      chatStatus: envelope.data.chat?.status ?? "ended",
      expertName: envelope.data.chat?.expertName ?? undefined,
    };
  }

  async postMessage(text: string): Promise<PostMessageResult> {
    // Local redaction BEFORE anything leaves the machine (the server redacts
    // again — defense in depth, same contract as request submission).
    const cleaned = redactText(text).text;
    let response: Response;
    try {
      response = await fetch(this.url("/messages"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ text: cleaned }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: UNREACHABLE };
    }
    const envelope = await this.parse<{ seq: number }>(response);
    if (response.status === 410) {
      return {
        ok: false,
        ended: true,
        error: envelope?.error ?? "This chat has ended.",
      };
    }
    if (!envelope?.success || envelope.data?.seq === undefined) {
      return {
        ok: false,
        error: envelope?.error ?? `HTTP ${response.status}`,
      };
    }
    return { ok: true, seq: envelope.data.seq };
  }

  async endChat(): Promise<{ ok: boolean; error?: string }> {
    let response: Response;
    try {
      response = await fetch(this.url("/end"), {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: UNREACHABLE };
    }
    const envelope = await this.parse<{ ended: boolean }>(response);
    if (!envelope?.success) {
      return {
        ok: false,
        error: envelope?.error ?? `HTTP ${response.status}`,
      };
    }
    return { ok: true };
  }

  private async parse<T>(response: Response): Promise<Envelope<T> | null> {
    try {
      return (await response.json()) as Envelope<T>;
    } catch {
      return null;
    }
  }
}
