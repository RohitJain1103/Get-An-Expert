import { HttpBrowserController } from "./browser";
import { PlaywrightBrowserController } from "./browser-playwright";
import type { BrowserController, ConsoleResult, ScreenshotResult } from "./types";

export interface AutoBrowserOptions {
  host?: string;
  executablePath?: string;
  channel?: string;
  /** Called once if Playwright can't launch and we fall back to HTTP. */
  onFallback?: (reason: string) => void;
}

/**
 * The default browser controller. It prefers a real headless browser
 * (screenshot + console + status via Playwright) and falls back — once,
 * permanently — to the HTTP reachability controller if no browser binary is
 * available on the customer's machine. Either way `browser_screenshot` and
 * `browser_console` keep working; with a browser present the expert sees the
 * actual rendered page.
 */
export class AutoBrowserController implements BrowserController {
  readonly #playwright: PlaywrightBrowserController;
  readonly #http: HttpBrowserController;
  readonly #onFallback?: (reason: string) => void;
  #mode: "probe" | "playwright" | "http" = "probe";

  constructor(opts: AutoBrowserOptions = {}) {
    this.#playwright = new PlaywrightBrowserController(opts);
    this.#http = new HttpBrowserController(opts);
    this.#onFallback = opts.onFallback;
  }

  #fallback(reason: string): void {
    if (this.#mode !== "http") {
      this.#mode = "http";
      this.#onFallback?.(reason);
    }
  }

  async screenshot(port: number): Promise<ScreenshotResult> {
    if (this.#mode === "http") return this.#http.screenshot(port);
    try {
      const result = await this.#playwright.screenshot(port);
      this.#mode = "playwright";
      return result;
    } catch (err) {
      this.#fallback(errText(err));
      return this.#http.screenshot(port);
    }
  }

  async console(port: number): Promise<ConsoleResult> {
    if (this.#mode === "http") return this.#http.console(port);
    try {
      const result = await this.#playwright.console(port);
      this.#mode = "playwright";
      return result;
    } catch (err) {
      this.#fallback(errText(err));
      return this.#http.console(port);
    }
  }

  async close(): Promise<void> {
    await this.#playwright.close();
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
