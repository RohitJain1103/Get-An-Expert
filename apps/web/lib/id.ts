import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const newRequestId = (): string => `req_${randomUUID()}`;

export const newDeleteToken = (): string =>
  randomBytes(24).toString("base64url");

/** Only the hash is stored; the raw token is returned to the client once. */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Constant-time string comparison for tokens and passcodes. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
