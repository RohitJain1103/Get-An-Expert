/**
 * Client-side secret redaction.
 *
 * Everything in this module runs on the user's machine BEFORE any data leaves
 * it. The payload sent to the Get An Expert API must never contain
 * credentials, so patterns here prefer false positives (over-redacting) to
 * false negatives (leaking a secret).
 */

export interface Redaction {
  type: string;
  count: number;
}

export interface RedactTextResult {
  text: string;
  redactions: Redaction[];
}

export interface RedactObjectResult {
  value: unknown;
  redactions: Redaction[];
}

interface SecretPattern {
  type: string;
  pattern: RegExp;
  /** Replacement string; defaults to the bare placeholder for the type. */
  replacement?: string;
}

const placeholder = (type: string): string => `[REDACTED:${type}]`;

// Order matters: specific vendor formats first, generic catch-alls last, so
// counts attribute to the most precise type available.
const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: "private-key",
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  { type: "anthropic-api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  {
    type: "openai-api-key",
    pattern: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{40,}\b/g,
  },
  {
    type: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g,
  },
  { type: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    type: "stripe-key",
    pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  { type: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    type: "sendgrid-api-key",
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  { type: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { type: "huggingface-token", pattern: /\bhf_[A-Za-z0-9]{30,}\b/g },
  {
    type: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    type: "connection-credentials",
    pattern:
      /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?|s?ftp):\/\/)[^\s:@/]+:[^\s@/]+@/gi,
    replacement: `$1${placeholder("connection-credentials")}@`,
  },
  {
    type: "bearer-token",
    pattern: /\b[Bb]earer\s+(?!\[REDACTED)[A-Za-z0-9._~+/=-]{16,}/g,
  },
  {
    type: "credential",
    pattern:
      /\b((?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)[A-Za-z0-9_-]*)(\s*[:=]\s*)(["']?)(?!\[REDACTED)([^\s"'[\]]{8,})\3/gi,
    replacement: `$1$2$3${placeholder("credential")}$3`,
  },
];

/** Redact secrets from a string. Returns a new string; never mutates input. */
export function redactText(input: string): RedactTextResult {
  let text = input;
  const counts = new Map<string, number>();

  for (const { type, pattern, replacement } of SECRET_PATTERNS) {
    const matches = text.match(pattern);
    if (!matches || matches.length === 0) continue;
    counts.set(type, (counts.get(type) ?? 0) + matches.length);
    text = text.replace(pattern, replacement ?? placeholder(type));
  }

  const redactions = [...counts.entries()].map(([type, count]) => ({
    type,
    count,
  }));
  return { text, redactions };
}

/**
 * Deep-redact every string in a JSON-like value. Returns new structures;
 * never mutates the input.
 */
export function redactObject(input: unknown): RedactObjectResult {
  const counts = new Map<string, number>();

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      const { text, redactions } = redactText(value);
      for (const { type, count } of redactions) {
        counts.set(type, (counts.get(type) ?? 0) + count);
      }
      return text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          walk(v),
        ]),
      );
    }
    return value;
  };

  const value = walk(input);
  const redactions = [...counts.entries()].map(([type, count]) => ({
    type,
    count,
  }));
  return { value, redactions };
}
