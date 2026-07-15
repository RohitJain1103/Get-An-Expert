import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AutoBrowserController } from "./browser-auto";

let server: Server;
let port: number;

function serve(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>Landing</title><h1>hi</h1>");
    });
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}

afterEach(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("AutoBrowserController fallback", () => {
  it("falls back to the HTTP controller when no browser can launch", async () => {
    await serve();
    let fallbackReason = "";
    const controller = new AutoBrowserController({
      // A binary that cannot launch forces the fallback path.
      executablePath: "/nonexistent/definitely/not/a/browser",
      onFallback: (r) => (fallbackReason = r),
    });
    const res = await controller.screenshot(port);
    // HTTP controller reports reachability + status, but no PNG.
    expect(res.status).toBe(200);
    expect(res.imageBase64).toBeUndefined();
    expect(fallbackReason.length).toBeGreaterThan(0);

    // Once fallen back, console also uses HTTP without retrying the browser.
    const con = await controller.console(port);
    expect(con.note).toBeTruthy();
    await controller.close();
  }, 30_000);
});
