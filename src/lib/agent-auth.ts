import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string) {
  if (!username) return { ok: false, error: "Username is required." };
  if (username.length < 3 || username.length > 32) {
    return { ok: false, error: "Username must be 3-32 characters." };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { ok: false, error: "Username can only include letters, numbers, underscores, and dashes." };
  }
  return { ok: true } as const;
}

export function generatePrivateKey() {
  return randomBytes(32).toString("hex");
}

export function hashPrivateKey(privateKey: string) {
  return createHash("sha256").update(privateKey).digest("hex");
}

export function verifyPrivateKey(privateKey: string, expectedHash: string) {
  const providedHash = hashPrivateKey(privateKey);
  const provided = Buffer.from(providedHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
