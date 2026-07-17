import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STUN, iceServers, _resetIceCache } from "./ice";

afterEach(() => {
  _resetIceCache();
  vi.restoreAllMocks();
});

describe("iceServers", () => {
  it("returns STUN only when nothing is configured", async () => {
    expect(await iceServers({})).toEqual([{ urls: DEFAULT_STUN }]);
  });

  it("appends a single static TURN server from the convenience vars", async () => {
    const servers = await iceServers({
      GET_AN_EXPERT_TURN_URLS: "turn:turn.example.com:3478",
      GET_AN_EXPERT_TURN_USERNAME: "user",
      GET_AN_EXPERT_TURN_CREDENTIAL: "pass",
    });
    expect(servers).toEqual([
      { urls: DEFAULT_STUN },
      { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
    ]);
  });

  it("splits multiple comma-separated static TURN urls into an array", async () => {
    const servers = await iceServers({
      GET_AN_EXPERT_TURN_URLS: "turn:t.example.com:3478 , turns:t.example.com:5349 ",
      GET_AN_EXPERT_TURN_USERNAME: "u",
      GET_AN_EXPERT_TURN_CREDENTIAL: "c",
    });
    expect(servers[1]).toEqual({
      urls: ["turn:t.example.com:3478", "turns:t.example.com:5349"],
      username: "u",
      credential: "c",
    });
  });

  it("ignores static TURN vars unless url + username + credential are all present", async () => {
    expect(
      await iceServers({
        GET_AN_EXPERT_TURN_URLS: "turn:turn.example.com:3478",
        GET_AN_EXPERT_TURN_USERNAME: "user",
      }),
    ).toEqual([{ urls: DEFAULT_STUN }]);
  });

  it("uses a valid GET_AN_EXPERT_ICE_SERVERS JSON override verbatim", async () => {
    const custom = [
      { urls: "stun:stun.example.com:3478" },
      { urls: "turn:a.example.com:3478", username: "x", credential: "y" },
    ];
    expect(await iceServers({ GET_AN_EXPERT_ICE_SERVERS: JSON.stringify(custom) })).toEqual(custom);
  });

  it("mints Cloudflare TURN credentials and returns their iceServers", async () => {
    const cf = [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
        username: "cf-user",
        credential: "cf-cred",
      },
    ];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ iceServers: cf }), { status: 201 }),
      );

    const servers = await iceServers({
      GET_AN_EXPERT_CLOUDFLARE_TURN_KEY_ID: "key123",
      GET_AN_EXPERT_CLOUDFLARE_TURN_API_TOKEN: "tok456",
    });
    expect(servers).toEqual(cf);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers",
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok456" });
  });

  it("caches Cloudflare credentials so a second call does not re-hit the API", async () => {
    const cf = [{ urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" }];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ iceServers: cf }), { status: 201 }));
    const env = {
      GET_AN_EXPERT_CLOUDFLARE_TURN_KEY_ID: "k",
      GET_AN_EXPERT_CLOUDFLARE_TURN_API_TOKEN: "t",
    };
    await iceServers(env);
    await iceServers(env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to STUN when Cloudflare fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    expect(
      await iceServers({
        GET_AN_EXPERT_CLOUDFLARE_TURN_KEY_ID: "k",
        GET_AN_EXPERT_CLOUDFLARE_TURN_API_TOKEN: "t",
      }),
    ).toEqual([{ urls: DEFAULT_STUN }]);
  });
});
