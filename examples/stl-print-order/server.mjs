import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5179);
const defaultOttoAuthBaseUrl =
  process.env.OTTOAUTH_BASE_URL || "https://ottoauth.vercel.app";
const appId = "ottoauth-stl-print-order-demo";
const appName = "STL Print Order";
const validationErrorMarkers = [
  "Choose an STL file",
  "must end in .stl",
  "was not loaded",
  "up to 25 MB",
];
const pendingCheckouts = new Map();
const pendingTtlMs = 10 * 60 * 1000;
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, pending] of pendingCheckouts) {
    if (pending.expiresAt <= now) pendingCheckouts.delete(id);
  }
}, 60 * 1000);
cleanupTimer.unref?.();

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sanitizeText(value, maxLength = 1000) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : "";
}

function centsFromUsd(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

function publicBaseUrl(request) {
  const host = request.headers.host || `127.0.0.1:${port}`;
  return `http://${host}`;
}

function ottoauthOrigin() {
  try {
    return new URL(defaultOttoAuthBaseUrl).origin;
  } catch {
    return "https://ottoauth.vercel.app";
  }
}

function localOttoAuthDevOrigins() {
  return new Set([
    ottoauthOrigin(),
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3110",
    "http://localhost:3110",
  ]);
}

function corsHeaders(request) {
  const origin = request.headers.origin || "";
  const allowedOrigins = localOttoAuthDevOrigins();
  const allowOrigin = allowedOrigins.has(origin) ? origin : ottoauthOrigin();
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function estimatePrintCents(state) {
  const quantity = Math.max(1, Math.min(100, Number(state.quantity || 1)));
  const volumeCm3 = Number(state.analysis?.volume_cm3 || 0);
  const billableVolume = Math.max(8, Math.min(2000, volumeCm3 || 20));
  const material = sanitizeText(state.material, 40).toLowerCase();
  const rate =
    material === "resin"
      ? 36
      : material === "nylon"
        ? 45
        : material === "petg"
          ? 24
          : 18;
  const setup = material === "resin" ? 1200 : 900;
  const finish = sanitizeText(state.finish, 60).toLowerCase();
  const finishCents = finish.includes("smooth") || finish.includes("paint") ? 900 : 0;
  return Math.max(1800, Math.round((setup + billableVolume * rate + finishCents) * quantity));
}

function stlFileFromInput(input) {
  const file = input.file && typeof input.file === "object" ? input.file : null;
  if (!file) throw new Error("Choose an STL file first.");
  const name = sanitizeText(file.name, 180) || "part.stl";
  const contentBase64 = sanitizeText(file.content_base64 ?? file.contentBase64, 80_000_000);
  const size = Number(file.size || 0);
  if (!/\.stl$/i.test(name)) throw new Error("The selected file must end in .stl.");
  if (!contentBase64) throw new Error("The STL file was not loaded.");
  if (size > 25 * 1024 * 1024) throw new Error("This demo accepts STL files up to 25 MB.");
  return {
    name,
    size,
    contentBase64,
    contentType: sanitizeText(file.content_type ?? file.contentType, 120) || "model/stl",
  };
}

function buildOrderPayload(input, stlFile) {
  const state = input.state || {};
  const analysis = state.analysis || {};
  const quantity = Math.max(1, Math.min(100, Number(state.quantity || 1)));
  const maxChargeCents = centsFromUsd(state.maxSpendUsd) || 7500;
  const estimateCents = Math.min(maxChargeCents, estimatePrintCents(state));
  const provider = sanitizeText(state.provider, 80) || "treatstock";
  const material = sanitizeText(state.material, 80) || "PLA";
  const color = sanitizeText(state.color, 80) || "black";
  const finish = sanitizeText(state.finish, 120) || "standard";
  const infill = sanitizeText(state.infill, 40) || "20%";
  const layerHeight = sanitizeText(state.layerHeight, 40) || "0.20 mm";
  const shippingAddress = sanitizeText(state.shippingAddress, 2000);
  const notes = sanitizeText(state.notes, 2000);
  const dimensions = analysis.bounds_mm
    ? `${Number(analysis.bounds_mm.x || 0).toFixed(1)} x ${Number(analysis.bounds_mm.y || 0).toFixed(1)} x ${Number(analysis.bounds_mm.z || 0).toFixed(1)} mm`
    : "unknown";
  const volume = Number.isFinite(Number(analysis.volume_cm3))
    ? `${Number(analysis.volume_cm3).toFixed(2)} cm^3`
    : "unknown";
  const triangles = Number.isFinite(Number(analysis.triangle_count))
    ? String(Math.trunc(Number(analysis.triangle_count)))
    : "unknown";
  const merchant =
    provider === "craftcloud" ? "Craftcloud" : provider === "xometry" ? "Xometry" : "Treatstock";
  const itemName = `${quantity}x ${stlFile.name} in ${material}, ${color}`;

  return {
    store: provider,
    merchant,
    merchant_name: merchant,
    platform_hint: "3D printing service",
    kind: "manufacturing_3d_print",
    order_type: "stl_3d_print_order",
    task_title: `3D print ${stlFile.name}`,
    item_name: itemName,
    quantity: String(quantity),
    shipping_address: shippingAddress || undefined,
    max_charge_cents: maxChargeCents,
    files: [
      {
        name: stlFile.name,
        purpose: "3d_print_model",
        content_type: stlFile.contentType,
        content_base64: stlFile.contentBase64,
        size: stlFile.size,
        metadata: {
          source: "stl_print_order_demo",
          analysis,
        },
      },
    ],
    quote: {
      source: "stl_print_demo_estimate",
      source_label: "STL print demo estimate",
      confidence: "low",
      goods_cents: estimateCents,
      total_cents: estimateCents,
      currency: "usd",
    },
    order_details: [
      `Print file: ${stlFile.name}`,
      `Quantity: ${quantity}`,
      `Material: ${material}`,
      `Color: ${color}`,
      `Finish: ${finish}`,
      `Infill: ${infill}`,
      `Layer height: ${layerHeight}`,
      `Approx dimensions: ${dimensions}`,
      `Approx mesh volume: ${volume}`,
      `Triangles: ${triangles}`,
      notes ? `Notes: ${notes}` : "",
      "Use the attached STL file for fulfillment.",
      "Only complete fulfillment if the final total is under max_charge_cents.",
      "If the provider requires choices that are not specified, ask for clarification instead of guessing.",
    ]
      .filter(Boolean)
      .join("\n"),
    task: `Order a 3D print from the attached STL file.

${itemName}
Provider preference: ${provider}
Material: ${material}
Color: ${color}
Finish: ${finish}
Infill: ${infill}
Layer height: ${layerHeight}
Approx dimensions: ${dimensions}
Approx mesh volume: ${volume}

Only complete fulfillment if the final total is under the spend cap.`,
    metadata: {
      source_app: "ottoauth_stl_print_order_demo",
      analysis,
      material,
      color,
      finish,
      infill,
      layer_height: layerHeight,
    },
  };
}

function buildCheckoutBody(request, input) {
  const stlFile = stlFileFromInput(input);
  const demoBaseUrl = publicBaseUrl(request);
  const orderPayload = buildOrderPayload(input, stlFile);
  return {
    auth_mode: "human_session",
    app_id: appId,
    app_name: appName,
    success_url: `${demoBaseUrl}/?print_order=success&order_id={ORDER_ID}&task_id={TASK_ID}`,
    cancel_url: `${demoBaseUrl}/?print_order=canceled&session_id={CHECKOUT_SESSION_ID}`,
    external_id: `stl-print-${randomUUID()}`,
    order: orderPayload,
    metadata: {
      source_app: "ottoauth_stl_print_order_demo",
      file_name: stlFile.name,
    },
  };
}

async function handleBuy(request, response) {
  const input = await readJson(request);
  const ottoauthBaseUrl = defaultOttoAuthBaseUrl.replace(/\/$/, "");
  const id = randomUUID();
  const checkoutBody = buildCheckoutBody(request, input);
  pendingCheckouts.set(id, {
    checkoutBody,
    expiresAt: Date.now() + pendingTtlMs,
  });
  const payloadUrl = `${publicBaseUrl(request)}/api/pending/${encodeURIComponent(id)}`;
  const handoffUrl = new URL("/checkout/import", ottoauthBaseUrl);
  handoffUrl.searchParams.set("payload_url", payloadUrl);

  sendJson(response, 201, {
    ok: true,
    handoffUrl: handoffUrl.href,
    payloadUrl,
    expiresAt: new Date(Date.now() + pendingTtlMs).toISOString(),
  });
}

async function handlePendingCheckout(request, response, id) {
  const pending = pendingCheckouts.get(id);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingCheckouts.delete(id);
    response.writeHead(404, {
      ...corsHeaders(request),
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ ok: false, error: "Checkout handoff expired." }));
    return;
  }
  response.writeHead(200, {
    ...corsHeaders(request),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ ok: true, checkout: pending.checkoutBody }));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  const ext = path.extname(filePath);
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : "application/octet-stream";
  response.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/buy") {
      await handleBuy(request, response);
      return;
    }
    if (request.method === "OPTIONS" && request.url.startsWith("/api/pending/")) {
      response.writeHead(204, corsHeaders(request));
      response.end();
      return;
    }
    if (request.method === "GET" && request.url.startsWith("/api/pending/")) {
      const id = decodeURIComponent(request.url.slice("/api/pending/".length).split("?")[0]);
      await handlePendingCheckout(request, response, id);
      return;
    }
    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }
    sendJson(response, 405, { ok: false, error: "method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = validationErrorMarkers.some((marker) => message.includes(marker))
      ? 400
      : 502;
    sendJson(response, status, {
      ok: false,
      error: message,
    });
  }
});

server.listen(port, "127.0.0.1", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(__dirname, "package.json"), "utf8").catch(() => "{}"),
  );
  console.log(`${packageJson.name || "stl-print-order"} running at http://127.0.0.1:${port}`);
  console.log(`OttoAuth checkout URL: ${defaultOttoAuthBaseUrl}`);
});
