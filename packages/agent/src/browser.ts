import type {
  BrowserController,
  ConsoleResult,
  ScreenshotResult,
} from "./types";

/**
 * Default browser controller: reaches the customer's dev server over HTTP on
 * localhost. It verifies the page is reachable and reports status + title —
 * a lightweight "is it rendering" check with no external dependency.
 *
 * Live console/network capture needs a headless browser attached over CDP;
 * that is a swappable controller. This default reports what HTTP alone can
 * see and says so, rather than pretending to have console access it doesn't.
 */
/** Cap the HTML source we ship back so it fits one data-channel frame. */
const MAX_HTML_BYTES = 96 * 1024;

export class HttpBrowserController implements BrowserController {
  readonly #host: string;
  readonly #timeoutMs: number;

  constructor(opts: { host?: string; timeoutMs?: number } = {}) {
    this.#host = opts.host ?? "127.0.0.1";
    this.#timeoutMs = opts.timeoutMs ?? 5000;
  }

  async screenshot(port: number): Promise<ScreenshotResult> {
    const url = `http://${this.#host}:${port}/`;
    try {
      const res = await this.#fetch(url);
      const contentType = res.headers.get("content-type") ?? undefined;
      const body = await res.text();
      const html = body.length > MAX_HTML_BYTES ? body.slice(0, MAX_HTML_BYTES) : body;
      return {
        ok: res.ok,
        port,
        status: res.status,
        title: extractTitle(body),
        contentType,
        html,
        note: res.ok
          ? "No headless browser on the customer's machine — showing the page's HTML source instead of a rendered screenshot."
          : `Dev server responded with HTTP ${res.status}.`,
      };
    } catch (err) {
      return {
        ok: false,
        port,
        note: `Could not reach localhost:${port} — ${errText(err)}`,
      };
    }
  }

  async console(port: number): Promise<ConsoleResult> {
    // Verify reachability so the expert learns whether the server is even up.
    try {
      const res = await this.#fetch(`http://${this.#host}:${port}/`);
      return {
        port,
        entries: [
          {
            level: res.ok ? "info" : "warn",
            text: `Dev server on localhost:${port} responded HTTP ${res.status}.`,
          },
        ],
        note: "Live browser console requires a headless browser attached over CDP; not available in the HTTP controller.",
      };
    } catch (err) {
      return {
        port,
        entries: [
          { level: "error", text: `localhost:${port} unreachable — ${errText(err)}` },
        ],
      };
    }
  }

  async #fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : undefined;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
