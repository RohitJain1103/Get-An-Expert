import { z } from "zod";

/**
 * Wire format for WebRTC signaling routed opaquely through the relay. It
 * bridges node-datachannel (agent, Node) and the browser RTCPeerConnection
 * (dashboard): both encode descriptions and ICE candidates the same way.
 */
export const signalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("description"),
    sdp: z.string(),
    sdpType: z.enum(["offer", "answer", "pranswer", "rollback"]),
  }),
  z.object({
    kind: z.literal("candidate"),
    candidate: z.string(),
    mid: z.string().nullable().optional(),
  }),
]);

export type SignalPayload = z.infer<typeof signalSchema>;

export function parseSignal(payload: unknown): SignalPayload | undefined {
  const result = signalSchema.safeParse(payload);
  return result.success ? result.data : undefined;
}
