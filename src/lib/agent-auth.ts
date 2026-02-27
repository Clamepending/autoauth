import { randomBytes, timingSafeEqual } from "node:crypto";

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

export function validateCallbackUrl(callbackUrl: string) {
  const trimmed = callbackUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "Callback URL is required." } as const;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Callback URL must be a valid absolute URL." } as const;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Callback URL must start with https:// or http://." } as const;
  }

  if (!parsed.hostname) {
    return { ok: false, error: "Callback URL must include a hostname." } as const;
  }

  parsed.hash = "";
  return { ok: true, value: parsed.toString() } as const;
}

export function verifyPrivateKey(providedPassword: string, storedPrivateKey: string) {
  if (providedPassword.length !== storedPrivateKey.length) return false;
  const a = Buffer.from(providedPassword, "utf8");
  const b = Buffer.from(storedPrivateKey, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
