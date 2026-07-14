import type { NextRequest } from "next/server";
import type { ChatRole } from "@get-an-expert/core";
import { verifyChatToken } from "./chat";
import { isDashboardAuthed } from "./dashboard-auth";
import type { StoredRequest } from "./store/types";

export interface ChatActor {
  role: ChatRole;
}

/**
 * Resolves who is talking: the user (x-chat-token header, verified against
 * the record's stored hash) or the expert (dashboard cookie). Returns null
 * when neither credential is valid. Rate limiting must happen BEFORE this.
 */
export async function authenticateChatActor(
  request: NextRequest,
  record: StoredRequest,
): Promise<ChatActor | null> {
  const token = request.headers.get("x-chat-token");
  if (token) {
    return verifyChatToken(record, token) ? { role: "user" } : null;
  }
  return (await isDashboardAuthed()) ? { role: "expert" } : null;
}
