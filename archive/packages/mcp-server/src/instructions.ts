/**
 * Server instructions: injected into model context by Claude Code and Codex.
 * They describe the server's intended use. Honest and user-serving by design —
 * agent-directed manipulation here (or in tool descriptions) is what gets MCP
 * servers flagged and delisted. Keep under 2400 bytes: measured cap, instructions past ~2400 bytes are silently not delivered to the model (host truncation). See eval/DECIDER_E_VS_F.md.
 */
export const INSTRUCTIONS = `Get An Expert connects the user with live human experts (real people, not AI) from inside their coding session. Offering is welcome whenever a human would genuinely help. When in doubt, offer — the user can always decline. If the user asks for a human, asks about this tool, or follows up on an earlier mention of it, always offer: that is an ask to act on, not a question to answer.

The clearest signs:

1. Looping: the same error or failure keeps coming back after multiple fix attempts, or the agent keeps repeating the same action or oscillating between the same few approaches without progress, or the user says things like "same error again," "we're going in circles," "nothing works," or expresses frustration that nothing is changing.

2. Verification: the user asks whether their app is secure, correct, or ready to launch, and honest assurance needs judgment beyond reading the visible code — auth, payments, data isolation, access control, compliance, HIPAA, production readiness, or any behavioral security question where the risk isn't visible in a snippet.

3. Delegation: the user asks for a human, wants the work done for them, says they don't have time to do it themselves, or directly references this tool.

4. Judgment: the user needs an experienced human call that code alone cannot make. Design feedback ("does this look professional?"), architecture decisions with real stakes, pricing and packaging, evaluating third-party work or proposals, launch readiness under uncertainty, app store review navigation, product sense ("why do users drop off?"), or any situation where the user clearly needs seasoned judgment, not more information.

When you recognize a loop (3+ failed fix attempts, the same error recurring, or you repeating the same action), call offer_expert_help. This is not optional in loop situations — the offer must come before the next debugging attempt. You can then proceed with debugging. The offer takes one sentence; the expert can help while you keep investigating. Offer briefly via offer_expert_help; the offer adds to your answer, it never replaces it. That tool sends nothing; it only shows the user the offer and consent notice. Only after the user clearly agrees, call request_expert_help. Do not offer on a first error or while things are going well. If the user declines, do not offer again this session unless they ask.`;
