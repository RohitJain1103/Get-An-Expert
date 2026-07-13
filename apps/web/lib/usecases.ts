import {
  redactObject,
  type ExpertRequestPayload,
  type ExpertResponse,
} from "@get-an-expert/core";
import { hashToken, newDeleteToken, newRequestId, safeEqual } from "./id";
import type { ExpertRequestInput } from "./schema";
import type { Store, StoredRequest } from "./store/types";
import { THIRTY_DAYS_SECONDS } from "./store/types";

/** Raw output of the AI analysis engine. */
export interface AnalysisResult {
  diagnosis: string;
  suggested_prompt: string;
  intro: string;
  expertise_area: string;
  model: string;
}

export type Analyze = (
  payload: ExpertRequestPayload,
) => Promise<AnalysisResult>;

export interface CreateExpertRequestResult {
  requestId: string;
  deleteToken: string;
  deleteUrl: string;
  status: "answered" | "new";
  /** Preformatted markdown the MCP client relays to the user verbatim. */
  message: string;
  response?: ExpertResponse;
}

/**
 * Shown with every response. Honest AI disclosure is a hard requirement
 * (FTC deception standards, CA B.O.T. Act, EU AI Act Art. 50) — do not
 * soften or remove it.
 */
export const DISCLOSURE_LINE =
  "This first pass is AI-assisted triage from Get An Expert — human experts are joining soon. " +
  "Your request auto-deletes in 30 days.";

export async function createExpertRequest(opts: {
  store: Store;
  analyze: Analyze;
  input: ExpertRequestInput;
  baseUrl: string;
  now?: Date;
}): Promise<CreateExpertRequestResult> {
  const { store, analyze, input, baseUrl } = opts;
  const now = opts.now ?? new Date();

  // Re-redact server-side even though the client already did: defense in
  // depth against outdated clients or patterns added after a client shipped.
  const { consent, ...rawPayload } = input;
  const { value, redactions } = redactObject(rawPayload);
  const payload = value as ExpertRequestPayload;

  const id = newRequestId();
  const deleteToken = newDeleteToken();
  const record: StoredRequest = {
    id,
    createdAt: now.toISOString(),
    status: "new",
    payload,
    serverRedactions: redactions,
    consent,
    deleteTokenHash: hashToken(deleteToken),
  };
  await store.create(record, THIRTY_DAYS_SECONDS);
  const deleteUrl = `${baseUrl}/delete/${id}?token=${deleteToken}`;

  try {
    const analysis = await analyze(payload);
    const response: ExpertResponse = {
      intro: analysis.intro,
      diagnosis: analysis.diagnosis,
      suggestedPrompt: analysis.suggested_prompt,
      disclosure: DISCLOSURE_LINE,
      model: analysis.model,
      generatedAt: new Date().toISOString(),
    };
    const answered: StoredRequest = {
      ...record,
      status: "answered",
      payload: {
        ...payload,
        expertiseArea: analysis.expertise_area || payload.expertiseArea,
      },
      response,
    };
    await store.put(answered, THIRTY_DAYS_SECONDS);
    return {
      requestId: id,
      deleteToken,
      deleteUrl,
      status: "answered",
      message: formatExpertMessage(answered.payload.tool, response, deleteUrl),
      response,
    };
  } catch (error: unknown) {
    console.error("[get-an-expert] analysis failed for", id, error);
    return {
      requestId: id,
      deleteToken,
      deleteUrl,
      status: "new",
      message: fallbackMessage(id, deleteUrl),
    };
  }
}

const TOOL_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  windsurf: "Windsurf",
  aider: "Aider",
  replit: "Replit",
};

export function formatExpertMessage(
  tool: string,
  response: ExpertResponse,
  deleteUrl: string,
): string {
  const toolLabel = TOOL_LABELS[tool] ?? "your coding agent";
  return [
    response.intro,
    "",
    `**What's going on:** ${response.diagnosis}`,
    "",
    `**Paste this into ${toolLabel}:**`,
    "",
    "```",
    response.suggestedPrompt,
    "```",
    "",
    `_${response.disclosure} Delete your data anytime: ${deleteUrl}_`,
  ].join("\n");
}

function fallbackMessage(id: string, deleteUrl: string): string {
  return [
    "We hit a snag generating your suggestion — that's on us, not you. " +
      `Your request went through (id: ${id}) and it's saved, so give it ` +
      "another try in a minute.",
    "",
    `_${DISCLOSURE_LINE} Delete your data anytime: ${deleteUrl}_`,
  ].join("\n");
}

export async function deleteExpertRequest(
  store: Store,
  id: string,
  token: string,
): Promise<"deleted" | "not_found" | "forbidden"> {
  const record = await store.get(id);
  if (!record) return "not_found";
  if (!safeEqual(record.deleteTokenHash, hashToken(token))) return "forbidden";
  await store.delete(id);
  return "deleted";
}

/** Dashboard listing without the token hash. */
export async function listExpertRequests(
  store: Store,
  limit: number,
): Promise<Omit<StoredRequest, "deleteTokenHash">[]> {
  const records = await store.list(limit);
  return records.map(({ deleteTokenHash: _hash, ...rest }) => rest);
}
