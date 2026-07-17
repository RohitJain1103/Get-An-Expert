import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serveStatic } from "./static";

let servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map((s) => new Promise<void>((res) => s.close(() => res()))),
  );
  servers = [];
});

async function serve(rootDir: string): Promise<string> {
  const server = createServer((req, res) => serveStatic(rootDir, req, res));
  servers.push(server);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

describe("serveStatic MIME", () => {
  it("serves jpg with an image/jpeg content type", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gae-static-"));
    // Minimal JPEG magic bytes; content is irrelevant, only the extension is.
    writeFileSync(join(dir, "x.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const base = await serve(dir);
    const res = await fetch(`${base}/x.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
});
