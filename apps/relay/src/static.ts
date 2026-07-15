import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Serve a file from `rootDir` for the request path. Resolves and contains
 * the path inside `rootDir` — traversal attempts get a 404. Returns true
 * when the response was handled.
 */
export function serveStatic(
  rootDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", "http://relay.local");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return notFound(res);
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  const root = resolve(rootDir);
  const target = resolve(join(root, normalize(pathname)));
  if (target !== root && !target.startsWith(root + sep)) {
    return notFound(res);
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    return notFound(res);
  }

  res.writeHead(200, {
    "content-type": MIME[extname(target)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(target).pipe(res);
  return true;
}

function notFound(res: ServerResponse): boolean {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
  return true;
}
