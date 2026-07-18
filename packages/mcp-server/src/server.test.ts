import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { buildServer } from "./server";
import { loadCardHtml } from "./ui";
import { CONSENT_RESOURCE_URI } from "./cards";

/**
 * End-to-end over an in-memory transport: what a real host sees. The card
 * plumbing must never change the text a text-only host (Codex today) gets,
 * and the structured card data must ride along for hosts with Apps UI.
 */
async function connected() {
  const server = buildServer();
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("buildServer", () => {
  it("keeps the exact consent-notice text fallback on offer_expert_help", async () => {
    const client = await connected();
    const result = await client.callTool({
      name: "offer_expert_help",
      arguments: { expertiseArea: "React state management" },
    });
    const texts = (result.content as { type: string; text: string }[])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    expect(texts).toContain("Want a human expert");
    expect(texts).toContain("React state management");
    expect(texts).toContain("**Proceed? (yes / no)**");
  });

  it("adds consent card data as structuredContent", async () => {
    const client = await connected();
    const result = await client.callTool({
      name: "offer_expert_help",
      arguments: { expertiseArea: "Postgres query tuning" },
    });
    const data = result.structuredContent as Record<string, unknown>;
    expect(data?.card).toBe("consent");
    expect(data?.expertiseArea).toBe("Postgres query tuning");
    expect(typeof data?.projectDir).toBe("string");
    expect(String(data?.privacyUrl)).toMatch(/^https?:\/\//);
  });

  it("returns status card data from expert_status", async () => {
    const client = await connected();
    const result = await client.callTool({
      name: "expert_status",
      arguments: {},
    });
    const data = result.structuredContent as Record<string, unknown>;
    expect(data?.card).toBe("status");
    expect(["idle", "waiting", "connected"]).toContain(data?.state);
    expect(Array.isArray(data?.activity)).toBe(true);
  });

  it("serves the consent card resource when the UI is built", async () => {
    const html = loadCardHtml("consent");
    const client = await connected();
    if (!html) {
      // No built UI in this checkout: tools must still work text-only and the
      // ui:// resource must simply be absent.
      const tools = await client.listTools();
      expect(
        tools.tools.some((t) => t.name === "expert_status_refresh"),
      ).toBe(false);
      return;
    }
    const resource = await client.readResource({ uri: CONSENT_RESOURCE_URI });
    const first = resource.contents[0] as { mimeType?: string; text?: string };
    expect(first.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(first.text).toContain("privacy-grid");
  });

  it("links the offer tool to the consent card only when the UI is built", async () => {
    const html = loadCardHtml("consent");
    const client = await connected();
    const tools = await client.listTools();
    const offer = tools.tools.find((t) => t.name === "offer_expert_help");
    expect(offer).toBeDefined();
    const uiMeta = (offer?._meta as { ui?: { resourceUri?: string } })?.ui;
    if (html) {
      expect(uiMeta?.resourceUri).toBe(CONSENT_RESOURCE_URI);
    } else {
      expect(uiMeta).toBeUndefined();
    }
  });
});
