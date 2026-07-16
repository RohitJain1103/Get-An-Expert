import { existsSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import type {
  BrowserController,
  ConsoleEntry,
  ConsoleResult,
  ScreenshotResult,
} from "./types";

interface PortState {
  context: BrowserContext;
  page: Page;
  console: ConsoleEntry[];
  status?: number;
}

export interface PlaywrightBrowserOptions {
  host?: string;
  /** Explicit browser binary. Overrides channel discovery. */
  executablePath?: string;
  /** Playwright channel to try (e.g. "chrome", "msedge"). */
  channel?: string;
  /** Screenshot viewport. */
  viewport?: { width: number; height: number };
  /** Max console entries kept per page. */
  consoleCap?: number;
}

/** Browser channels tried, in order, when no explicit binary is given. */
const CHANNELS = ["chrome", "chromium", "msedge"];

/**
 * A real headless-browser controller: it drives Chrome/Chromium on the
 * customer's machine to produce an actual PNG screenshot of the dev server,
 * plus the page's console output and the HTTP status. This is what lets the
 * expert *see* localhost:PORT — not just check that it responds.
 *
 * The browser and one page per port are reused across calls, so repeated
 * captures are cheap. Launch is lazy: the first screenshot/console call spins
 * it up; if no browser binary is available it throws (the caller falls back
 * to the HTTP controller).
 */
export class PlaywrightBrowserController implements BrowserController {
  readonly #host: string;
  readonly #opts: PlaywrightBrowserOptions;
  readonly #consoleCap: number;
  #browser?: Browser;
  #ports = new Map<number, PortState>();

  constructor(opts: PlaywrightBrowserOptions = {}) {
    this.#host = opts.host ?? "127.0.0.1";
    this.#opts = opts;
    this.#consoleCap = opts.consoleCap ?? 200;
  }

  async #ensureBrowser(): Promise<Browser> {
    if (this.#browser && this.#browser.isConnected()) return this.#browser;
    const base = { headless: true, args: ["--no-sandbox"] };
    const envPath = process.env.GET_AN_EXPERT_BROWSER_EXECUTABLE?.trim();
    const explicit = this.#opts.executablePath ?? envPath;
    if (explicit) {
      this.#browser = await chromium.launch({ ...base, executablePath: explicit });
      return this.#browser;
    }
    const channels = this.#opts.channel ? [this.#opts.channel] : CHANNELS;
    let lastErr: unknown;
    for (const channel of channels) {
      try {
        this.#browser = await chromium.launch({ ...base, channel });
        return this.#browser;
      } catch (err) {
        lastErr = err;
      }
    }
    // Channel discovery misses browsers installed outside Playwright's search
    // (common on machines without the CLI helpers). Try well-known install
    // locations for this OS before giving up.
    for (const exe of systemBrowserPaths()) {
      if (!existsSync(exe)) continue;
      try {
        this.#browser = await chromium.launch({ ...base, executablePath: exe });
        return this.#browser;
      } catch (err) {
        lastErr = err;
      }
    }
    // Last resort: Playwright's own downloaded chromium, if installed.
    try {
      this.#browser = await chromium.launch(base);
      return this.#browser;
    } catch {
      throw new Error(
        `No browser available (tried ${channels.join(", ")}). ${errText(lastErr)}`,
      );
    }
  }

  async #getState(port: number, load: boolean): Promise<PortState> {
    let state = this.#ports.get(port);
    if (!state) {
      const browser = await this.#ensureBrowser();
      const context = await browser.newContext({
        viewport: this.#opts.viewport ?? { width: 1000, height: 720 },
      });
      const page = await context.newPage();
      state = { context, page, console: [] };
      page.on("console", (msg) => {
        state!.console.push({ level: msg.type(), text: msg.text() });
        if (state!.console.length > this.#consoleCap) state!.console.shift();
      });
      page.on("pageerror", (err) => {
        state!.console.push({ level: "error", text: err.message });
      });
      this.#ports.set(port, state);
      await this.#navigate(state, port);
    } else if (load) {
      await this.#navigate(state, port);
    }
    return state;
  }

  async #navigate(state: PortState, port: number): Promise<void> {
    state.console = [];
    try {
      const res = await state.page.goto(`http://${this.#host}:${port}/`, {
        waitUntil: "domcontentloaded",
        timeout: 8000,
      });
      state.status = res?.status();
    } catch (err) {
      // Server down / navigation failure is a normal, reportable state — not a
      // browser-availability failure. Keep the page; mark it unreachable.
      state.status = undefined;
      state.console.push({ level: "error", text: `Could not load: ${errText(err)}` });
    }
  }

  async screenshot(port: number): Promise<ScreenshotResult> {
    // A browser-launch failure propagates (the auto controller falls back to
    // HTTP). A dev-server failure is reported as ok:false with status undefined.
    const state = await this.#getState(port, true);
    const buf = await state.page.screenshot({ type: "png" });
    const title = await state.page.title();
    const ok = state.status !== undefined && state.status < 400;
    return {
      ok,
      port,
      status: state.status,
      title,
      contentType: "image/png",
      note: ok
        ? "Live screenshot of the customer's dev server."
        : `Dev server responded with HTTP ${state.status ?? "?"}.`,
      imageBase64: buf.toString("base64"),
    };
  }

  async console(port: number): Promise<ConsoleResult> {
    const state = await this.#getState(port, false);
    return {
      port,
      entries: [...state.console],
      note: `Network: HTTP ${state.status ?? "?"} · ${state.console.length} console message(s).`,
    };
  }

  async close(): Promise<void> {
    for (const state of this.#ports.values()) {
      await state.context.close().catch(() => {});
    }
    this.#ports.clear();
    await this.#browser?.close().catch(() => {});
    this.#browser = undefined;
  }
}

/** Well-known Chrome/Chromium/Edge install paths, by OS, tried when channel
 *  discovery finds nothing. Guarded by existsSync at the call site. */
function systemBrowserPaths(): string[] {
  switch (process.platform) {
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      ];
    case "win32":
      return [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ];
    default:
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
        "/snap/bin/chromium",
      ];
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
