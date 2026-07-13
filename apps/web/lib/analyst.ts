import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ExpertRequestPayload } from "@get-an-expert/core";
import { env } from "./env";
import { SYSTEM_PROMPT } from "./prompts/system";
import type { AnalysisResult, Analyze } from "./usecases";

const MODEL = "claude-opus-4-8";

const analysisSchema = z.object({
  diagnosis: z.string(),
  suggested_prompt: z.string(),
  intro: z.string(),
  expertise_area: z.string(),
});

/**
 * Distinctive markers from SYSTEM_PROMPT that must never appear in model
 * output. Their presence means a prompt-injection tried to make the model
 * regurgitate the proprietary triage prompt — we fail safe instead of
 * returning it. Chosen to be section tags and internal phrasing the model is
 * NOT instructed to emit, so legitimate diagnoses never false-positive.
 */
const SYSTEM_PROMPT_MARKERS = [
  "triage engine for get an expert",
  "you think like a staff engineer who has watched",
  "<suggested_prompt_rules>",
  "<diagnosis>",
  "<intro_rules>",
  "<input_format>",
  "<output_format>",
  "<quality_bar>",
  "banned outright",
  "read-aloud test",
];

/** True if any output field leaks the system prompt (defense in depth). */
export function leaksSystemPrompt(output: {
  diagnosis: string;
  suggested_prompt: string;
  intro: string;
  expertise_area: string;
}): boolean {
  const haystack = [
    output.diagnosis,
    output.suggested_prompt,
    output.intro,
    output.expertise_area,
  ]
    .join("\n")
    .toLowerCase();
  return SYSTEM_PROMPT_MARKERS.some((marker) => haystack.includes(marker));
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = env.anthropicApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Runs the triage analysis for a stuck session. The system prompt is frozen
 * (cacheable); the payload goes in the user turn only.
 */
export const analyzeStuckSession: Analyze = async (
  payload: ExpertRequestPayload,
): Promise<AnalysisResult> => {
  const sessionPayload = {
    goal: payload.goal,
    what_was_tried: payload.whatWasTried,
    error_messages: payload.errorMessages,
    conversation_summary: payload.conversationSummary,
    tech_stack: payload.techStack.join(", "),
    tool_name: payload.tool,
    messages_stuck_count: payload.messagesStuckCount ?? null,
  };

  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: zodOutputFormat(analysisSchema),
    },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          "<session_payload>",
          JSON.stringify(sessionPayload, null, 2),
          "</session_payload>",
          "",
          "Analyze this stuck session and respond with the JSON object.",
        ].join("\n"),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Analysis request was refused");
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Analysis returned no parseable output");
  }
  if (leaksSystemPrompt(parsed)) {
    // A prompt-injection got the model to echo the system prompt; refuse to
    // surface it. The route turns this into a generic error to the caller.
    throw new Error("Analysis output failed safety check");
  }
  return { ...parsed, model: MODEL };
};
