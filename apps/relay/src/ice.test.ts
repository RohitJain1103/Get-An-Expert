import { describe, expect, it } from "vitest";
import { DEFAULT_STUN, iceServers } from "./ice";

describe("iceServers", () => {
  it("returns STUN only when nothing is configured", () => {
    expect(iceServers({})).toEqual([{ urls: DEFAULT_STUN }]);
  });

  it("appends a single TURN server from the convenience vars", () => {
    const servers = iceServers({
      GET_AN_EXPERT_TURN_URLS: "turn:turn.example.com:3478",
      GET_AN_EXPERT_TURN_USERNAME: "user",
      GET_AN_EXPERT_TURN_CREDENTIAL: "pass",
    });
    expect(servers).toEqual([
      { urls: DEFAULT_STUN },
      { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
    ]);
  });

  it("supports multiple comma-separated TURN urls as an array", () => {
    const servers = iceServers({
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

  it("ignores TURN vars unless url + username + credential are all present", () => {
    expect(
      iceServers({
        GET_AN_EXPERT_TURN_URLS: "turn:turn.example.com:3478",
        GET_AN_EXPERT_TURN_USERNAME: "user",
        // credential missing
      }),
    ).toEqual([{ urls: DEFAULT_STUN }]);
  });

  it("uses a valid GET_AN_EXPERT_ICE_SERVERS JSON override verbatim", () => {
    const custom = [
      { urls: "stun:stun.example.com:3478" },
      { urls: "turn:a.example.com:3478", username: "x", credential: "y" },
    ];
    expect(iceServers({ GET_AN_EXPERT_ICE_SERVERS: JSON.stringify(custom) })).toEqual(custom);
  });

  it("falls back to STUN when the JSON override is malformed or empty", () => {
    expect(iceServers({ GET_AN_EXPERT_ICE_SERVERS: "not json" })).toEqual([{ urls: DEFAULT_STUN }]);
    expect(iceServers({ GET_AN_EXPERT_ICE_SERVERS: "[]" })).toEqual([{ urls: DEFAULT_STUN }]);
  });
});
