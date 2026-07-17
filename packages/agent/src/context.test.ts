import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildContextMarkdown,
  countConversationMessages,
  readProjectOverview,
  readTranscriptPointer,
  readTranscriptTail,
  transcriptToMarkdown,
} from "./context";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "get-an-expert-ctx-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.GET_AN_EXPERT_HOME;
});

const line = (entry: unknown) => JSON.stringify(entry);

describe("transcriptToMarkdown", () => {
  it("renders user prompts and assistant prose, skipping everything else", () => {
    const jsonl = [
      line({ type: "user", message: { content: "How do I fix the build?" } }),
      line({ type: "user", isMeta: true, message: { content: "meta noise" } }),
      line({
        type: "user",
        message: { content: [{ type: "tool_result", content: "tool output" }] },
      }),
      line({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Check the import path." },
            { type: "tool_use", name: "Bash" },
          ],
        },
      }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
      "{{{ not json at all",
      line({ type: "user", message: { content: [{ type: "text", text: "Still failing." }] } }),
    ].join("\n");

    const md = transcriptToMarkdown(jsonl);
    expect(md).toBe(
      "**User:**\nHow do I fix the build?\n\n" +
        "**Assistant:**\nCheck the import path.\n\n" +
        "**User:**\nStill failing.",
    );
    expect(md).not.toContain("meta noise");
    expect(md).not.toContain("tool output");
  });

  it("returns an empty string for garbage-only input", () => {
    expect(transcriptToMarkdown("not json\nalso not json")).toBe("");
    expect(transcriptToMarkdown("")).toBe("");
  });

  it("truncates the OLDEST messages when over the cap, with a note", () => {
    const jsonl = Array.from({ length: 10 }, (_, i) =>
      line({ type: "user", message: { content: `message number ${i}` } }),
    ).join("\n");

    const md = transcriptToMarkdown(jsonl, 80);
    expect(md).toContain("_Transcript truncated");
    expect(md).toContain("message number 9");
    expect(md).not.toContain("message number 0");
  });
});

describe("readTranscriptPointer", () => {
  const writePointer = (value: unknown) => {
    process.env.GET_AN_EXPERT_HOME = dir;
    writeFileSync(
      join(dir, "transcript-pointer.json"),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };

  it("reads a fresh pointer from GET_AN_EXPERT_HOME", () => {
    writePointer({ transcriptPath: "/tmp/t.jsonl", sessionId: "abc", savedAt: Date.now() });
    const pointer = readTranscriptPointer();
    expect(pointer?.transcriptPath).toBe("/tmp/t.jsonl");
    expect(pointer?.sessionId).toBe("abc");
  });

  it("returns null when the pointer is older than ten minutes", () => {
    writePointer({ transcriptPath: "/tmp/t.jsonl", savedAt: Date.now() - 11 * 60 * 1000 });
    expect(readTranscriptPointer()).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    writePointer("{{{ nope");
    expect(readTranscriptPointer()).toBeNull();
  });

  it("returns null for a wrong shape", () => {
    writePointer({ transcriptPath: 42, savedAt: "yesterday" });
    expect(readTranscriptPointer()).toBeNull();
  });

  it("returns null when no pointer file exists", () => {
    process.env.GET_AN_EXPERT_HOME = dir;
    expect(readTranscriptPointer()).toBeNull();
  });
});

describe("readTranscriptTail", () => {
  it("reads a small file whole", () => {
    const path = join(dir, "t.jsonl");
    writeFileSync(path, "hello transcript");
    expect(readTranscriptTail(path)).toBe("hello transcript");
  });

  it("reads only the tail of a file over the cap", () => {
    const path = join(dir, "big.jsonl");
    writeFileSync(path, "0123456789");
    expect(readTranscriptTail(path, 4)).toBe("6789");
  });
});

describe("readProjectOverview", () => {
  it("prefers CLAUDE.md over README.md", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "# Agent notes");
    writeFileSync(join(dir, "README.md"), "# Readme");
    const overview = readProjectOverview(dir);
    expect(overview?.file).toBe("CLAUDE.md");
    expect(overview?.excerpt).toBe("# Agent notes");
  });

  it("falls back to README.md", () => {
    writeFileSync(join(dir, "README.md"), "# Readme");
    expect(readProjectOverview(dir)?.file).toBe("README.md");
  });

  it("returns null when neither file exists", () => {
    expect(readProjectOverview(dir)).toBeNull();
  });

  it("skips an empty CLAUDE.md in favor of README.md", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "   \n");
    writeFileSync(join(dir, "README.md"), "# Readme");
    expect(readProjectOverview(dir)?.file).toBe("README.md");
  });

  it("caps the excerpt at the byte budget", () => {
    writeFileSync(join(dir, "README.md"), "abcdefghij");
    expect(readProjectOverview(dir, 5)?.excerpt).toBe("abcde");
  });
});

describe("buildContextMarkdown", () => {
  const base = {
    customerName: "Jordan Lee",
    issue: "Build failing on HeroImage import",
    summary: "Vite build fails; tried renaming the export, path alias unchanged.",
    overview: { file: "CLAUDE.md", excerpt: "# Landing page\nA Vite app." },
    transcriptMarkdown: "**User:**\nHelp me fix the build.",
    requestedAt: Date.UTC(2026, 6, 15, 12, 0, 0),
  };

  it("lays out header, summary, overview, and transcript in order", () => {
    const md = buildContextMarkdown(base).markdown;
    expect(md).toContain("# Get An Expert — session context");
    expect(md).toContain("- **Customer:** Jordan Lee");
    expect(md).toContain("- **Issue:** Build failing on HeroImage import");
    expect(md).toContain("- **Requested:** 2026-07-15T12:00:00.000Z");
    expect(md).toContain(".gitignore");
    expect(md.indexOf("## Where they're stuck (agent summary)")).toBeLessThan(
      md.indexOf("## Project overview"),
    );
    expect(md.indexOf("## Project overview")).toBeLessThan(
      md.indexOf("## Conversation transcript"),
    );
    expect(md).toContain("_Full overview: CLAUDE.md_");
    expect(md).toContain("**User:**\nHelp me fix the build.");
  });

  it("omits the overview section when there is no overview", () => {
    const md = buildContextMarkdown({ ...base, overview: null }).markdown;
    expect(md).not.toContain("## Project overview");
  });

  it("falls back to a clear line when the transcript is unavailable", () => {
    const md = buildContextMarkdown({ ...base, transcriptMarkdown: undefined })
      .markdown;
    expect(md).toContain("Not available — work from the summary above.");
  });

  it("marks a missing issue as not provided", () => {
    const md = buildContextMarkdown({ ...base, issue: undefined }).markdown;
    expect(md).toContain("- **Issue:** (not provided)");
  });

  it("redacts planted secrets and reports the count", () => {
    const fakeKey = `sk-ant-${"a".repeat(24)}`;
    const built = buildContextMarkdown({
      ...base,
      summary: `The API call fails with key ${fakeKey}.`,
    });
    expect(built.markdown).not.toContain(fakeKey);
    expect(built.markdown).toContain("[REDACTED:anthropic-api-key]");
    expect(built.markdown).toContain("_1 secret was redacted._");
    expect(built.secretsRedacted).toBe(1);
  });

  it("appends no redaction note when nothing was redacted", () => {
    const built = buildContextMarkdown(base);
    expect(built.markdown).not.toContain("redacted._");
    expect(built.secretsRedacted).toBe(0);
  });

  it("counts the conversation turns rendered in the transcript", () => {
    const built = buildContextMarkdown({
      ...base,
      transcriptMarkdown:
        "**User:**\nHelp me fix the build.\n\n**Assistant:**\nCheck the import.\n\n**User:**\nStill broken.",
    });
    expect(built.conversationMessages).toBe(3);
  });

  it("reports zero conversation turns when no transcript is present", () => {
    expect(
      buildContextMarkdown({ ...base, transcriptMarkdown: undefined })
        .conversationMessages,
    ).toBe(0);
  });
});

describe("countConversationMessages", () => {
  it("counts User and Assistant section headers", () => {
    const md =
      "**User:**\nhi\n\n**Assistant:**\nhello\n\n**User:**\nbye";
    expect(countConversationMessages(md)).toBe(3);
  });

  it("ignores a truncation note and body prose that mention the words", () => {
    const md =
      "_Transcript truncated._\n\n**User:**\nThe Assistant said User earlier.\n\n**Assistant:**\nok";
    expect(countConversationMessages(md)).toBe(2);
  });

  it("returns zero for empty or undefined input", () => {
    expect(countConversationMessages("")).toBe(0);
    expect(countConversationMessages(undefined)).toBe(0);
  });
});
