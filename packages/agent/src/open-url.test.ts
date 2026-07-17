import { describe, expect, it, vi } from "vitest";
import { openUrl } from "./open-url";

const URL_OK = "https://relay.example.com/chat#abc.def";
const base = { relayOrigin: "https://relay.example.com", env: {} as NodeJS.ProcessEnv };

describe("openUrl", () => {
  it("darwin uses open with the url as its own argv entry", () => {
    const spawner = vi.fn(() => ({ unref: vi.fn() }));
    expect(openUrl(URL_OK, { ...base, platform: "darwin", spawner })).toBe(true);
    expect(spawner).toHaveBeenCalledWith(
      "open",
      [URL_OK],
      expect.objectContaining({ detached: true, stdio: "ignore", shell: false }),
    );
  });

  it("win32 uses cmd /c start with an empty title arg", () => {
    const spawner = vi.fn(() => ({ unref: vi.fn() }));
    expect(openUrl(URL_OK, { ...base, platform: "win32", spawner })).toBe(true);
    expect(spawner).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", URL_OK],
      expect.objectContaining({ detached: true, stdio: "ignore", shell: false }),
    );
  });

  it("linux uses xdg-open only when a display exists", () => {
    const withDisplay = vi.fn(() => ({ unref: vi.fn() }));
    expect(
      openUrl(URL_OK, {
        ...base,
        platform: "linux",
        env: { DISPLAY: "::1" } as NodeJS.ProcessEnv,
        spawner: withDisplay,
      }),
    ).toBe(true);
    expect(withDisplay).toHaveBeenCalledWith(
      "xdg-open",
      [URL_OK],
      expect.objectContaining({ shell: false }),
    );

    // No DISPLAY / WAYLAND_DISPLAY: headless, so nothing is spawned.
    const headless = vi.fn();
    expect(
      openUrl(URL_OK, {
        ...base,
        platform: "linux",
        env: {} as NodeJS.ProcessEnv,
        spawner: headless,
      }),
    ).toBe(false);
    expect(headless).not.toHaveBeenCalled();
  });

  it("refuses a url on a different origin", () => {
    const spawner = vi.fn();
    expect(
      openUrl("https://evil.example.com/chat#a.b", { ...base, platform: "darwin", spawner }),
    ).toBe(false);
    expect(spawner).not.toHaveBeenCalled();
  });

  it("refuses non-http(s) schemes", () => {
    const spawner = vi.fn();
    expect(
      openUrl("file:///etc/passwd", { ...base, platform: "darwin", spawner }),
    ).toBe(false);
    expect(spawner).not.toHaveBeenCalled();
  });

  it("refuses a url that does not parse", () => {
    const spawner = vi.fn();
    expect(openUrl("not a url", { ...base, platform: "darwin", spawner })).toBe(false);
    expect(spawner).not.toHaveBeenCalled();
  });

  it("GET_AN_EXPERT_NO_AUTO_OPEN=1 short-circuits", () => {
    const spawner = vi.fn();
    expect(
      openUrl(URL_OK, {
        ...base,
        platform: "darwin",
        env: { GET_AN_EXPERT_NO_AUTO_OPEN: "1" } as NodeJS.ProcessEnv,
        spawner,
      }),
    ).toBe(false);
    expect(spawner).not.toHaveBeenCalled();
  });

  it("skips over SSH without a TTY", () => {
    const spawner = vi.fn();
    expect(
      openUrl(URL_OK, {
        ...base,
        platform: "darwin",
        env: { SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22" } as NodeJS.ProcessEnv,
        spawner,
      }),
    ).toBe(false);
    expect(spawner).not.toHaveBeenCalled();
  });

  it("never throws when the spawner throws", () => {
    const spawner = vi.fn(() => {
      throw new Error("ENOENT");
    });
    expect(openUrl(URL_OK, { ...base, platform: "darwin", spawner })).toBe(false);
  });
});
