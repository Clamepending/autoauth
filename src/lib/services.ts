/**
 * Canonical list of supported platforms. Used by /api/services and /api/onboard.
 */
export const SUPPORTED_SERVICES = [
  { id: "github", label: "Create its own GitHub account" },
  { id: "telegram", label: "Send messages to your agent via Telegram" },
  { id: "email", label: "Receive/send email with its own account" },
  { id: "doordash", label: "Order food via DoorDash" },
  { id: "amazon", label: "Shop and order via Amazon" },
  { id: "snackpass", label: "Order food on Snackpass" },
  { id: "other", label: "Other integration" },
] as const;

export const SUPPORTED_SERVICE_IDS = SUPPORTED_SERVICES.map((s) => s.id) as readonly string[];

export function isSupportedPlatform(platform: string): boolean {
  return SUPPORTED_SERVICE_IDS.includes(platform.toLowerCase() as (typeof SUPPORTED_SERVICE_IDS)[number]);
}

export function getServiceLabel(id: string): string | null {
  const s = SUPPORTED_SERVICES.find((x) => x.id === id.toLowerCase());
  return s?.label ?? null;
}
