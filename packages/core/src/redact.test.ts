import { describe, expect, it } from "vitest";
import { redactObject, redactText } from "./redact.js";

describe("redactText", () => {
  it("redacts Anthropic API keys", () => {
    const { text, redactions } = redactText(
      "my key is sk-ant-api03-i2bL7fJC_Dan9zHAYaP8dNj9pg74nIROGlNCEDabc123 ok",
    );
    expect(text).not.toContain("sk-ant-api03");
    expect(text).toContain("[REDACTED:anthropic-api-key]");
    expect(redactions).toEqual([{ type: "anthropic-api-key", count: 1 }]);
  });

  it("redacts OpenAI project keys", () => {
    const { text } = redactText(
      "OPENAI sk-proj-AbCdEf1234567890AbCdEf1234567890 end",
    );
    expect(text).toContain("[REDACTED:openai-api-key]");
    expect(text).not.toContain("sk-proj-");
  });

  it("redacts GitHub tokens", () => {
    const { text } = redactText(
      "token gho_16C7e42F292c6912E7710c838347Ae178B4a and ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    );
    expect(text).not.toContain("gho_");
    expect(text).not.toContain("ghp_");
  });

  it("redacts AWS access key IDs", () => {
    const { text } = redactText("aws AKIAIOSFODNN7EXAMPLE done");
    expect(text).toContain("[REDACTED:aws-access-key-id]");
  });

  it("redacts Slack, Stripe, Google, SendGrid, npm, and HF tokens", () => {
    const input = [
      "xoxb-123456789012-abcdefghijklmnop",
      "sk_live_4eC39HqLyjWDarjtT1zdp7dc",
      "AIzaSyA-1234567890abcdefghijklmnopqrstu",
      "SG.abcdefghijklmnop.qrstuvwxyz1234567890",
      "npm_abcdefghijklmnopqrstuvwxyz0123456789",
      "hf_abcdefghijklmnopqrstuvwxyz012345",
    ].join(" ");
    const { text } = redactText(input);
    expect(text).not.toContain("xoxb-");
    expect(text).not.toContain("sk_live_");
    expect(text).not.toContain("AIzaSy");
    expect(text).not.toContain("SG.");
    expect(text).not.toContain("npm_");
    expect(text).not.toContain("hf_");
  });

  it("redacts JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c";
    const { text } = redactText(`Authorization uses ${jwt} here`);
    expect(text).toContain("[REDACTED:jwt]");
    expect(text).not.toContain("eyJhbGciOi");
  });

  it("redacts private key blocks including multiline bodies", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA7x8mQ
xyz123
-----END RSA PRIVATE KEY-----`;
    const { text } = redactText(`config:\n${pem}\nafter`);
    expect(text).toContain("[REDACTED:private-key]");
    expect(text).not.toContain("MIIEpAIBAAK");
    expect(text).toContain("after");
  });

  it("redacts credentials in connection strings but keeps scheme and host", () => {
    const { text } = redactText(
      "DATABASE_URL is postgres://admin:hunter22secret@db.example.com:5432/app",
    );
    expect(text).toContain("postgres://");
    expect(text).toContain("db.example.com");
    expect(text).not.toContain("hunter22secret");
    expect(text).not.toContain("admin:");
  });

  it("redacts bearer tokens", () => {
    const { text } = redactText("header: Bearer abc123def456ghi789jkl012");
    expect(text).toContain("[REDACTED:bearer-token]");
    expect(text).not.toContain("abc123def456");
  });

  it("redacts generic key=value credential assignments", () => {
    const { text } = redactText(
      'API_KEY=super-secret-value-9000 and password: "hunter2hunter2"',
    );
    expect(text).not.toContain("super-secret-value-9000");
    expect(text).not.toContain("hunter2hunter2");
  });

  it("redacts SCREAMING_SNAKE_CASE env-var secrets (suffix keywords)", () => {
    const input = [
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY",
      "STRIPE_SECRET_KEY=whatever_this_is_1234567890",
      "DATABASE_PASSWORD=hunter2hunter2extra",
      "JWT_SECRET=myjwtsupersecretvalue123",
      'client_secret="GOCSPXabc123defg456hijk789lmno"',
    ].join("\n");
    const { text } = redactText(input);
    expect(text).not.toContain("wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY");
    expect(text).not.toContain("whatever_this_is_1234567890");
    expect(text).not.toContain("hunter2hunter2extra");
    expect(text).not.toContain("myjwtsupersecretvalue123");
    // Identifier names are preserved; only the values are redacted.
    expect(text).toContain("AWS_SECRET_ACCESS_KEY=");
  });

  it("redacts credentials embedded in http(s) URLs and DSNs", () => {
    const { text } = redactText(
      "webhook https://myuser:MySuperSecretPass1@example.com/api/hook",
    );
    expect(text).toContain("https://");
    expect(text).toContain("example.com");
    expect(text).not.toContain("MySuperSecretPass1");
    expect(text).not.toContain("myuser:");
  });

  it("redacts PGP/GPG private key blocks", () => {
    const pem = `-----BEGIN PGP PRIVATE KEY BLOCK-----
lQOYBFabc123defXYZ
-----END PGP PRIVATE KEY BLOCK-----`;
    const { text } = redactText(`key:\n${pem}\nend`);
    expect(text).toContain("[REDACTED:private-key]");
    expect(text).not.toContain("lQOYBFabc123defXYZ");
    expect(text).toContain("end");
  });

  it("redacts common vendor token formats without a key= prefix", () => {
    const input = [
      "GOCSPX-abcdefghijklmnopqrstuvwxyz12",
      "dop_v1_abcdefghijklmnopqrstuvwxyz0123456789abcdef",
      "AC0123456789abcdef0123456789abcdef",
      "key-0123456789abcdef0123456789abcdef",
    ].join(" ");
    const { text } = redactText(input);
    expect(text).not.toContain("GOCSPX-abcdefghij");
    expect(text).not.toContain("dop_v1_abcdefghij");
    expect(text).not.toContain("AC0123456789abcdef0123456789abcdef");
    expect(text).not.toContain("key-0123456789abcdef0123456789abcdef");
  });

  it("leaves clean text untouched and reports no redactions", () => {
    const input = "The useEffect hook re-renders because deps change.";
    const { text, redactions } = redactText(input);
    expect(text).toBe(input);
    expect(redactions).toEqual([]);
  });

  it("does not double-redact already-redacted placeholders", () => {
    const first = redactText("API_KEY=sk-ant-api03-abcdefghijklmnop123456");
    const second = redactText(first.text);
    expect(second.text).toBe(first.text);
    expect(second.redactions).toEqual([]);
  });

  it("aggregates counts per type", () => {
    const { redactions } = redactText(
      "a sk-ant-abcdefghijklmnop123 b sk-ant-qrstuvwxyz98765432",
    );
    expect(redactions).toEqual([{ type: "anthropic-api-key", count: 2 }]);
  });
});

describe("redactObject", () => {
  it("deep-redacts strings in nested objects and arrays without mutating input", () => {
    const input = {
      goal: "deploy",
      attempts: ["tried API_KEY=verysecretvalue123", "restarted"],
      nested: { note: "token gho_16C7e42F292c6912E7710c838347Ae178B4a" },
      count: 3,
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const { value, redactions } = redactObject(input);

    expect(input).toEqual(snapshot);
    expect((value as typeof input).attempts[0]).not.toContain(
      "verysecretvalue123",
    );
    expect((value as typeof input).nested.note).not.toContain("gho_");
    expect((value as typeof input).count).toBe(3);
    expect(redactions.length).toBeGreaterThan(0);
  });
});
