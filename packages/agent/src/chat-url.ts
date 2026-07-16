/**
 * Derives the hosted chat-page URL for a session. The relay serves the page
 * at /chat; the session id and customer token travel in the URL fragment so
 * they never reach server logs. Only the customer's own agent chat ever
 * shows this link.
 */
export function buildChatUrl(
  relayUrl: string,
  sessionId: string,
  customerToken: string,
): string {
  // Accept ws(s):// or http(s):// and normalize to the http(s) origin.
  const base = relayUrl
    .trim()
    .replace(/^ws/, "http")
    .replace(/\/+$/, "");
  return `${base}/chat#${sessionId}.${customerToken}`;
}
