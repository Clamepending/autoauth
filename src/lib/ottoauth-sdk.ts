const DEFAULT_APP_ID = "local-app";
const DEFAULT_APP_NAME = "Local app";

export function normalizeSdkAppId(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || DEFAULT_APP_ID;
}

export function normalizeSdkAppName(value: unknown, appId = DEFAULT_APP_ID) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (normalized) return normalized;
  if (appId === DEFAULT_APP_ID) return DEFAULT_APP_NAME;
  return appId
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .slice(0, 80);
}

export function sdkRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.trim() || requestUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || requestUrl.protocol.replace(/:$/, "") || "http";
  return `${protocol}://${host}`;
}

function allowedReturnOrigins() {
  return new Set(
    String(process.env.OTTOAUTH_SDK_ALLOWED_RETURN_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
}

function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function parseAllowedSdkReturnUrl(value: string | null | undefined) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return null;

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const allowedOrigins = allowedReturnOrigins();
  if (!isLocalHostname(url.hostname) && !allowedOrigins.has(url.origin)) {
    return null;
  }

  return url;
}

export function isAllowedSdkOrigin(origin: string | null | undefined) {
  const rawOrigin = String(origin || "").trim().replace(/\/+$/, "");
  if (!rawOrigin) return false;

  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  return isLocalHostname(url.hostname) || allowedReturnOrigins().has(url.origin);
}

export function sdkCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!isAllowedSdkOrigin(origin)) {
    return {};
  }
  return {
    "access-control-allow-origin": String(origin),
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export function withSdkCors<T extends Response>(response: T, request: Request) {
  for (const [key, value] of Object.entries(sdkCorsHeaders(request))) {
    response.headers.set(key, value);
  }
  return response;
}

export function sdkOptionsResponse(request: Request) {
  return new Response(null, {
    status: 204,
    headers: sdkCorsHeaders(request),
  });
}
