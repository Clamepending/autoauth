import { headers } from "next/headers";

/**
 * Canonical base URL for the app. Use everywhere we show curl commands or links.
 * 1. NEXT_PUBLIC_APP_URL or APP_URL (set in Vercel for canonical domain)
 * 2. Request Host (so visiting autoauth.vercel.app shows that, not the deployment URL)
 * 3. VERCEL_URL (deployment host; often the long preview URL)
 */
export function getBaseUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const headerList = headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protoHeader = headerList.get("x-forwarded-proto");
  if (host) {
    const isLocal =
      host.includes("localhost") || host.startsWith("127.0.0.1");
    const proto = protoHeader ?? (isLocal ? "http" : "https");
    return `${proto}://${host}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
  }
  return process.env.NODE_ENV === "production"
    ? "https://YOUR_DEPLOYMENT_URL"
    : "http://localhost:3000";
}
