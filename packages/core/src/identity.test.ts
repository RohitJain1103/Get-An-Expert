import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({
  userInfo: vi.fn(() => ({ username: "jordan" })),
}));

import { userInfo } from "node:os";
import { resolveRequesterName } from "./identity";

describe("resolveRequesterName", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(userInfo).mockReturnValue({ username: "jordan" } as never);
  });

  it("prefers an explicit override over everything else", () => {
    vi.stubEnv("GET_AN_EXPERT_CUSTOMER_NAME", "EnvName");
    expect(resolveRequesterName("Explicit Name")).toBe("Explicit Name");
  });

  it("trims an explicit override", () => {
    expect(resolveRequesterName("  Alex  ")).toBe("Alex");
  });

  it("falls back to GET_AN_EXPERT_CUSTOMER_NAME when no override is given", () => {
    vi.stubEnv("GET_AN_EXPERT_CUSTOMER_NAME", "EnvName");
    expect(resolveRequesterName()).toBe("EnvName");
  });

  it("falls back to the OS account username when neither is set", () => {
    expect(resolveRequesterName()).toBe("jordan");
  });

  it("returns undefined when the OS lookup fails and nothing else is set", () => {
    vi.mocked(userInfo).mockImplementation(() => {
      throw new Error("no passwd entry");
    });
    expect(resolveRequesterName()).toBeUndefined();
  });

  it("returns undefined when the OS username is blank", () => {
    vi.mocked(userInfo).mockReturnValue({ username: "" } as never);
    expect(resolveRequesterName()).toBeUndefined();
  });
});
