#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_BASE_URL = "http://localhost:3000";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 30_000;

const baseUrl = getBaseUrl();

/**
 * Holds endpoint metadata discovered from OttoAuth.
 * @type {Map<string, EndpointTool>}
 */
const endpointTools = new Map();

/**
 * MCP registered tool handles for dynamic replacement.
 * @type {Map<string, import("@modelcontextprotocol/sdk/server/mcp.js").RegisteredTool>}
 */
const registeredTools = new Map();

let lastRefreshAt = 0;
let refreshPromise = null;

const server = new McpServer({
  name: "ottoauth-mcp-proxy",
  version: "0.1.0",
});

const endpointInputSchema = {
  path_params: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe("Values for path placeholders (for example: runId)."),
  query: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional()
    .describe("Optional query string parameters."),
  body: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("JSON body to forward as-is to OttoAuth."),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional additional HTTP headers."),
};

const genericRequestSchema = {
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .describe("HTTP method to call."),
  path: z
    .string()
    .describe("Absolute OttoAuth path like /api/services/amazon/buy."),
  query: endpointInputSchema.query,
  body: endpointInputSchema.body,
  headers: endpointInputSchema.headers,
};

server.registerTool(
  "ottoauth_http_request",
  {
    title: "OttoAuth HTTP Request",
    description:
      "Generic OttoAuth passthrough tool. Use this if no endpoint-specific tool matches your request.",
    inputSchema: genericRequestSchema,
  },
  async ({ method, path, query, body, headers }) => {
    const normalizedPath = normalizePath(path);
    const result = await forwardRequest({
      method,
      path: normalizedPath,
      query,
      body,
      headers,
    });
    return responseToMcp(result);
  },
);

async function main() {
  try {
    await refreshToolsFromOttoAuth();
  } catch (error) {
    console.error(
      "[ottoauth-mcp] initial tool discovery failed; continuing with generic passthrough tool:",
      error,
    );
  }
  setInterval(() => {
    refreshToolsFromOttoAuth().catch((error) => {
      console.error("[ottoauth-mcp] scheduled refresh failed:", error);
    });
  }, REFRESH_INTERVAL_MS).unref();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Ensures endpoint-specific tools are refreshed at most once per day.
 * @param {boolean} force
 */
async function ensureFreshTools(force = false) {
  const stale = Date.now() - lastRefreshAt > REFRESH_INTERVAL_MS;
  if (force || stale || endpointTools.size === 0) {
    try {
      await refreshToolsFromOttoAuth();
    } catch (error) {
      console.error("[ottoauth-mcp] refresh skipped due to error:", error);
    }
  }
}

async function refreshToolsFromOttoAuth() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const discovered = await discoverEndpoints();
    endpointTools.clear();
    for (const endpoint of discovered) {
      endpointTools.set(endpoint.toolName, endpoint);
    }

    for (const [, handle] of registeredTools) {
      handle.remove();
    }
    registeredTools.clear();

    for (const endpoint of endpointTools.values()) {
      const handle = server.registerTool(
        endpoint.toolName,
        {
          title: endpoint.title,
          description: endpoint.description,
          inputSchema: endpointInputSchema,
        },
        async (args) => {
          await ensureFreshTools(false);
          const latest = endpointTools.get(endpoint.toolName) ?? endpoint;
          const path = applyPathParams(latest.path, args.path_params);
          const result = await forwardRequest({
            method: latest.method,
            path,
            query: args.query,
            body: args.body,
            headers: args.headers,
          });
          return responseToMcp(result);
        },
      );
      registeredTools.set(endpoint.toolName, handle);
    }

    lastRefreshAt = Date.now();
    server.sendToolListChanged();
    console.error(
      `[ottoauth-mcp] refreshed ${endpointTools.size} endpoint tools from ${baseUrl}`,
    );
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * @returns {Promise<EndpointTool[]>}
 */
async function discoverEndpoints() {
  const servicesRes = await fetchWithTimeout(`${baseUrl}/api/services`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!servicesRes.ok) {
    throw new Error(
      `GET /api/services failed with status ${servicesRes.status} ${servicesRes.statusText}`,
    );
  }
  const payload = await servicesRes.json();
  const services = Array.isArray(payload?.services) ? payload.services : [];

  const found = new Map();
  for (const service of services) {
    const serviceId = safeServiceId(service?.id);
    if (!serviceId) continue;
    const serviceUrl =
      typeof service?.serviceUrl === "string" && service.serviceUrl
        ? service.serviceUrl
        : `${baseUrl}/api/services/${serviceId}`;
    const docsUrl =
      typeof service?.docsUrl === "string" && service.docsUrl
        ? service.docsUrl
        : `${baseUrl}/api/services/${serviceId}/docs`;

    let endpoints = await fetchEndpointsFromService(serviceUrl, serviceId);
    if (endpoints.length === 0) {
      const docs = await fetchDocsMarkdown(docsUrl);
      endpoints = extractEndpointsFromMarkdown(docs, serviceId);
    }
    for (const endpoint of endpoints) {
      found.set(`${endpoint.method} ${endpoint.path}`, endpoint);
    }
  }

  return [...found.values()].sort((a, b) =>
    a.toolName.localeCompare(b.toolName),
  );
}

/**
 * @param {string} serviceUrl
 * @param {string} serviceId
 * @returns {Promise<EndpointTool[]>}
 */
async function fetchEndpointsFromService(serviceUrl, serviceId) {
  const res = await fetchWithTimeout(serviceUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return [];
  }

  const payload = await res.json().catch(() => null);
  const tools = Array.isArray(payload?.service?.tools)
    ? payload.service.tools
    : [];

  const endpoints = [];
  for (const tool of tools) {
    const method = normalizeMethod(tool?.method);
    if (!method) continue;

    const path = normalizeDiscoveredPath(String(tool?.path ?? ""));
    if (!path) continue;

    const toolLabel =
      typeof tool?.name === "string" ? tool.name.trim() : "";
    const description =
      typeof tool?.description === "string" ? tool.description.trim() : "";

    endpoints.push({
      toolName: toToolName(serviceId, method, path),
      title: toolLabel
        ? `${serviceId}.${toolLabel}`
        : `${serviceId.toUpperCase()} ${method} ${path}`,
      description:
        description || `Passthrough to ${method} ${path} on OttoAuth.`,
      method,
      path,
      serviceId,
    });
  }

  return endpoints;
}

/**
 * @param {string} docsUrl
 * @returns {Promise<string>}
 */
async function fetchDocsMarkdown(docsUrl) {
  const res = await fetchWithTimeout(docsUrl, {
    method: "GET",
    headers: { Accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" },
  });
  if (!res.ok) {
    return "";
  }
  return res.text();
}

/**
 * @param {string} markdown
 * @param {string} serviceId
 * @returns {EndpointTool[]}
 */
function extractEndpointsFromMarkdown(markdown, serviceId) {
  const endpoints = [];
  if (!markdown) return endpoints;

  const codeBlocks = [...markdown.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
  for (const block of codeBlocks) {
    const directEndpointMatches = block.matchAll(
      /\b(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/[^\s\\`]+|\/[^\s\\`]+)/g,
    );
    for (const match of directEndpointMatches) {
      const method = match[1];
      const rawPath = match[2];
      const path = normalizeDiscoveredPath(rawPath);
      if (!path) continue;

      const toolName = toToolName(serviceId, method, path);
      endpoints.push({
        toolName,
        title: `${serviceId.toUpperCase()} ${method} ${path}`,
        description: `Passthrough to ${method} ${path} on OttoAuth.`,
        method,
        path,
        serviceId,
      });
    }

    const curlMatches = block.matchAll(
      /\bcurl\b[\s\S]*?\b-X\s+(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/[^\s\\`]+|\/[^\s\\`]+)/g,
    );
    for (const match of curlMatches) {
      const method = match[1];
      const rawPath = match[2];
      const path = normalizeDiscoveredPath(rawPath);
      if (!path) continue;

      const toolName = toToolName(serviceId, method, path);
      endpoints.push({
        toolName,
        title: `${serviceId.toUpperCase()} ${method} ${path}`,
        description: `Passthrough to ${method} ${path} on OttoAuth.`,
        method,
        path,
        serviceId,
      });
    }
  }

  return endpoints;
}

/**
 * @param {{
 * method: string;
 * path: string;
 * query?: Record<string, unknown>;
 * body?: Record<string, unknown>;
 * headers?: Record<string, string>;
 * }} input
 */
async function forwardRequest({ method, path, query, body, headers }) {
  const url = new URL(path, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  const requestHeaders = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    ...(headers ?? {}),
  };

  const shouldSendBody = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (shouldSendBody) {
    requestHeaders["Content-Type"] =
      requestHeaders["Content-Type"] ?? "application/json";
  }

  const res = await fetchWithTimeout(url.toString(), {
    method,
    headers: requestHeaders,
    body: shouldSendBody ? JSON.stringify(body ?? {}) : undefined,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const responseBody = isJson ? await res.json() : await res.text();

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    url: url.toString(),
    contentType,
    body: responseBody,
  };
}

/**
 * @param {{
 * ok: boolean;
 * status: number;
 * statusText: string;
 * url: string;
 * contentType: string;
 * body: unknown;
 * }} response
 */
function responseToMcp(response) {
  const text = JSON.stringify(response, null, 2);
  return {
    isError: !response.ok,
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent: response,
  };
}

/**
 * @param {string} pathTemplate
 * @param {Record<string, string | number> | undefined} pathParams
 */
function applyPathParams(pathTemplate, pathParams) {
  return pathTemplate.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    const value = pathParams?.[name];
    if (value === undefined || value === null) {
      throw new Error(
        `Missing required path parameter '${name}' for path '${pathTemplate}'.`,
      );
    }
    return encodeURIComponent(String(value));
  });
}

/**
 * @param {string} value
 */
function normalizePath(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new Error("Path is required.");
  }
  if (!trimmed.startsWith("/")) {
    throw new Error(`Path must start with '/': ${trimmed}`);
  }
  return trimmed.replace(/\/{2,}/g, "/");
}

/**
 * @param {string} value
 */
function normalizeDiscoveredPath(value) {
  const url = value.startsWith("http")
    ? new URL(value)
    : new URL(value, `${baseUrl}/`);

  let path = normalizePath(url.pathname);
  if (!path.startsWith("/api/")) return null;

  path = path
    .split("/")
    .map((segment) => {
      if (/^[A-Z][A-Z0-9_]+$/.test(segment)) {
        const normalized = segment.replace(/_HERE$/g, "").toLowerCase();
        return `:${normalized}`;
      }
      return segment;
    })
    .join("/");

  return path;
}

/**
 * @param {unknown} raw
 */
function normalizeMethod(raw) {
  if (typeof raw !== "string") return null;
  const method = raw.trim().toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return null;
  }
  return method;
}

function getBaseUrl() {
  const raw = (process.env.OTTOAUTH_BASE_URL ?? DEFAULT_BASE_URL).trim();
  try {
    const url = new URL(raw);
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid OTTOAUTH_BASE_URL: ${raw}`);
  }
}

/**
 * @param {string} serviceId
 * @param {string} method
 * @param {string} path
 */
function toToolName(serviceId, method, path) {
  const normalizedPath = path
    .replace(/^\/api\//, "")
    .replace(/[:/]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `ottoauth_${serviceId}_${method.toLowerCase()}_${normalizedPath}`;
}

/**
 * @param {unknown} raw
 */
function safeServiceId(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  return value.replace(/[^a-z0-9_-]/g, "");
}

/**
 * @param {string} url
 * @param {RequestInit} init
 */
async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error("[ottoauth-mcp] fatal error:", error);
  process.exit(1);
});

/**
 * @typedef {Object} EndpointTool
 * @property {string} toolName
 * @property {string} title
 * @property {string} description
 * @property {string} method
 * @property {string} path
 * @property {string} serviceId
 */
