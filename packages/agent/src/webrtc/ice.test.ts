import { describe, expect, it } from "vitest";
import { parseIceUrl, toNodeIceServers } from "./ice";

describe("parseIceUrl", () => {
  it("parses a STUN url with explicit port", () => {
    expect(parseIceUrl("stun:stun.l.google.com:19302")).toEqual({
      scheme: "stun",
      host: "stun.l.google.com",
      port: 19302,
      transport: undefined,
    });
  });

  it("defaults the port to 3478 for turn and 5349 for turns", () => {
    expect(parseIceUrl("turn:turn.example.com")?.port).toBe(3478);
    expect(parseIceUrl("turns:turn.example.com")?.port).toBe(5349);
  });

  it("extracts the transport query", () => {
    expect(parseIceUrl("turn:turn.example.com:3478?transport=tcp")).toMatchObject({
      scheme: "turn",
      host: "turn.example.com",
      port: 3478,
      transport: "tcp",
    });
  });

  it("returns null for non-ICE schemes and garbage", () => {
    expect(parseIceUrl("https://example.com")).toBeNull();
    expect(parseIceUrl("nonsense")).toBeNull();
  });
});

describe("toNodeIceServers", () => {
  it("converts a STUN server to a plain string", () => {
    expect(toNodeIceServers([{ urls: "stun:stun.l.google.com:19302" }])).toEqual([
      "stun:stun.l.google.com:19302",
    ]);
  });

  it("converts a TURN server to a structured node-datachannel entry with creds", () => {
    expect(
      toNodeIceServers([
        { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
      ]),
    ).toEqual([
      {
        hostname: "turn.example.com",
        port: 3478,
        username: "user",
        password: "pass",
        relayType: "TurnUdp",
      },
    ]);
  });

  it("maps turns -> TurnTls and transport=tcp -> TurnTcp", () => {
    const [tls] = toNodeIceServers([
      { urls: "turns:turn.example.com:5349", username: "u", credential: "c" },
    ]);
    const [tcp] = toNodeIceServers([
      { urls: "turn:turn.example.com:3478?transport=tcp", username: "u", credential: "c" },
    ]);
    expect(tls).toMatchObject({ relayType: "TurnTls", port: 5349 });
    expect(tcp).toMatchObject({ relayType: "TurnTcp", port: 3478 });
  });

  it("expands an array of urls sharing one credential", () => {
    const out = toNodeIceServers([
      {
        urls: ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
        username: "u",
        credential: "c",
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ relayType: "TurnUdp" });
    expect(out[1]).toMatchObject({ relayType: "TurnTls" });
  });

  it("skips unparseable urls without throwing", () => {
    expect(toNodeIceServers([{ urls: "not-a-url" }])).toEqual([]);
  });
});
