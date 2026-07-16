import { HttpBrowserController } from "./browser";
import { PlaywrightBrowserController } from "./browser-playwright";
import type { BrowserController, ConsoleResult, ScreenshotResult } from "./types";

export interface AutoBrowserOptions {
  host?: string;
  executablePath?: string;
  channel?: string;
  /** Called when Playwright can't launch and we fall back to HTTP (once per
   *  failure streak, not on every degraded call). */
  onFallback?: (reason: string) => void;
  /** How long to stay on the HTTP fallback before retrying Playwright, in ms
   *  (default 60s). A browser installed mid-session then gets picked up. */
  retryMs?: number;
}

/** Default cooldown before re-probing Playwright after a launch failure. */
const DEFAULT_RETRY_MS = 60_000;

/**
 * The default browser controller. It prefers a real headless browser
 * (screenshot + console + status via Playwright) and falls back to the HTTP
 * controller when no browser binary is available on the customer's machine.
 *
 * The fallback is NOT permanent: after a launch failure it stays on HTTP for a
 * cooldown, then re-probes Playwright, so a browser installed mid-session is
 * picked up without restarting. Each failure streak fires `onFallback` once so
 * the reason can be surfaced to the expert instead of vanishing.
 */
export class AutoBrowserController implements BrowserController {
  readonly #playwright: PlaywrightBrowserController;
  readonly #http: HttpBrowserController;
  readonly #onFallback?: (reason: string) => void;
  readonly #retryMs: number;
  #failedAt?: number;
  #notified = false;

  constructor(opts: AutoBrowserOptions = {}) {
    this.#playwright = new PlaywrightBrowserController(opts);
    this.#http = new HttpBrowserController(opts);
    this.#onFallback = opts.onFallback;
    this.#retryMs = opts.retryMs ?? DEFAULT_RETRY_MS;
  }

  #shouldTryPlaywright(): boolean {
    if (this.#failedAt === undefined) return true;
    return Date.now() - this.#failedAt >= this.#retryMs;
  }

  #playwrightOk(): void {
    this.#failedAt = undefined;
    this.#notified = false;
  }

  #playwrightFailed(reason: string): void {
    this.#failedAt = Date.now();
    if (!this.#notified) {
      this.#notified = true;
      this.#onFallback?.(reason);
    }
  }

  async screenshot(port: number): Promise<ScreenshotResult> {
    if (this.#shouldTryPlaywright()) {
      try {
        const result = await this.#playwright.screenshot(port);
        this.#playwrightOk();
        return result;
      } catch (err) {
        this.#playwrightFailed(errText(err));
      }
    }
    return this.#http.screenshot(port);
  }

  async console(port: number): Promise<ConsoleResult> {
    if (this.#shouldTryPlaywright()) {
      try {
        const result = await this.#playwright.console(port);
        this.#playwrightOk();
        return result;
      } catch (err) {
        this.#playwrightFailed(errText(err));
      }
    }
    return this.#http.console(port);
  }

  async close(): Promise<void> {
    await this.#playwright.close();
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
