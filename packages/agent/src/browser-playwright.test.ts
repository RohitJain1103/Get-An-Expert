import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlaywrightBrowserController } from "./browser-playwright";

/**
 * These tests launch a real headless browser. If none is available on the
 * machine, the suite skips itself rather than failing.
 */
let hasBrowser = false;
let probe: PlaywrightBrowserController;

beforeAll(async () => {
  probe = new PlaywrightBrowserController();
  const srv = await serve("<title>probe</title><h1>ok</h1>");
  try {
    const res = await probe.screenshot(srv.port);
    hasBrowser = !!res.imageBase64;
  } catch {
    hasBrowser = false;
  } finally {
    await srv.close();
    await probe.close();
  }
}, 40_000);

let server: { port: number; close: () => Promise<void> };
let controller: PlaywrightBrowserController;

function serve(html: string): Promise<{ port: number; close: () => Promise<void>; server: Server }> {
  return new Promise((resolve) => {
    const s = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html>" + html);
    });
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      resolve({ port, server: s, close: () => new Promise<void>((r) => s.close(() => r())) });
    });
  });
}

beforeEach(() => {
  controller = new PlaywrightBrowserController();
});

afterEach(async () => {
  await controller.close();
  if (server) await server.close();
});

describe("PlaywrightBrowserController", () => {
  it("captures a real PNG screenshot with title and status", async () => {
    if (!hasBrowser) return;
    server = await serve("<title>Gradient Hero</title><h1>The best Landing Page</h1>");
    const res = await controller.screenshot(server.port);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.title).toBe("Gradient Hero");
    expect(res.imageBase64).toBeTruthy();
    // PNG magic number: 89 50 4E 47
    const head = Buffer.from(res.imageBase64!.slice(0, 12), "base64");
    expect(head[0]).toBe(0x89);
    expect(head[1]).toBe(0x50);
    expect(head[2]).toBe(0x4e);
    expect(head[3]).toBe(0x47);
  }, 30_000);

  it("captures console output from the page", async () => {
    if (!hasBrowser) return;
    server = await serve("<title>t</title><script>console.log('compiled ok')</script>");
    await controller.screenshot(server.port);
    const res = await controller.console(server.port);
    expect(res.entries.some((e) => e.text.includes("compiled ok"))).toBe(true);
    expect(res.note).toMatch(/HTTP 200/);
  }, 30_000);

  it("reports an unreachable dev server without throwing", async () => {
    if (!hasBrowser) return;
    // Nothing listening on this port.
    const res = await controller.screenshot(59_999);
    expect(res.ok).toBe(false);
  }, 30_000);
});

afterAll(async () => {
  await probe?.close();
});
