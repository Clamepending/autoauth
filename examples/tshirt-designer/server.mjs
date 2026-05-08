import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5178);
const defaultOttoAuthBaseUrl =
  process.env.OTTOAUTH_BASE_URL || "https://ottoauth.vercel.app";
const storedDesigns = new Map();

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

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seededPick(seed, values) {
  const hash = createHash("sha256").update(seed).digest();
  return values[hash[0] % values.length];
}

function generateDesign(input) {
  const prompt = sanitizeText(input.prompt, 500);
  const seed = `${prompt} ${input.vibe || ""} ${input.shirtColor || ""}`;
  const palettes = {
    mineral: ["#12355b", "#f26d3d", "#f7d154"],
    studio: ["#222222", "#f5f0e6", "#55a3a3"],
    signal: ["#0c2d48", "#f05454", "#f4f0bb"],
    orchard: ["#2b463c", "#e5b769", "#e05a47"],
  };
  const palette = palettes[seededPick(seed, Object.keys(palettes))];
  const motifs = ["sunburst", "badge", "wave", "orbit", "stack"];
  const motif = seededPick(`${seed}:motif`, motifs);
  const words = prompt
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  const headline =
    sanitizeText(input.headline, 36) ||
    words.slice(0, 3).join(" ").toUpperCase() ||
    "LOCAL DROP";
  const subline =
    sanitizeText(input.subline, 48) ||
    seededPick(`${seed}:subline`, [
      "small batch",
      "made on demand",
      "studio proof",
      "edition one",
    ]).toUpperCase();

  return {
    headline: headline.slice(0, 36),
    subline: subline.slice(0, 48),
    motif,
    inkPrimary: sanitizeText(input.inkPrimary, 20) || palette[0],
    inkSecondary: sanitizeText(input.inkSecondary, 20) || palette[1],
    inkAccent: sanitizeText(input.inkAccent, 20) || palette[2],
    notes:
      prompt ||
      "A clean front-print T-shirt design with centered artwork and two-color typography.",
  };
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDesignSvg(state) {
  const design = state.design || {};
  const shirtColor = state.shirtColor || "#f6f1e8";
  const primary = design.inkPrimary || "#12355b";
  const secondary = design.inkSecondary || "#f26d3d";
  const accent = design.inkAccent || "#f7d154";
  const headline = escapeXml(design.headline || "LOCAL DROP");
  const subline = escapeXml(design.subline || "MADE ON DEMAND");
  const motif = design.motif || "badge";

  const motifMarkup =
    motif === "sunburst"
      ? `<circle cx="250" cy="185" r="54" fill="${accent}"/><g stroke="${primary}" stroke-width="8">${Array.from({ length: 12 }, (_, index) => {
          const angle = (Math.PI * 2 * index) / 12;
          const x1 = 250 + Math.cos(angle) * 72;
          const y1 = 185 + Math.sin(angle) * 72;
          const x2 = 250 + Math.cos(angle) * 96;
          const y2 = 185 + Math.sin(angle) * 96;
          return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
        }).join("")}</g>`
      : motif === "wave"
        ? `<path d="M150 190 C190 130 225 250 270 190 S340 155 360 195" fill="none" stroke="${secondary}" stroke-width="20" stroke-linecap="round"/><circle cx="250" cy="185" r="42" fill="${accent}" opacity=".9"/>`
        : motif === "orbit"
          ? `<circle cx="250" cy="185" r="38" fill="${accent}"/><ellipse cx="250" cy="185" rx="105" ry="42" fill="none" stroke="${secondary}" stroke-width="10" transform="rotate(-18 250 185)"/><circle cx="333" cy="153" r="13" fill="${primary}"/>`
          : motif === "stack"
            ? `<rect x="174" y="136" width="152" height="36" rx="8" fill="${accent}"/><rect x="154" y="184" width="192" height="36" rx="8" fill="${secondary}"/><rect x="184" y="232" width="132" height="36" rx="8" fill="${primary}"/>`
            : `<path d="M250 108 L356 166 L356 292 L250 350 L144 292 L144 166 Z" fill="${accent}" stroke="${primary}" stroke-width="12"/><circle cx="250" cy="230" r="48" fill="${secondary}"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200" viewBox="0 0 500 600">
  <rect width="500" height="600" fill="#ffffff"/>
  <path d="M168 68 L211 42 H289 L332 68 L409 103 L372 190 L332 174 V540 H168 V174 L128 190 L91 103 Z" fill="${shirtColor}" stroke="#1d2630" stroke-width="8" stroke-linejoin="round"/>
  <path d="M211 42 C224 78 276 78 289 42" fill="none" stroke="#1d2630" stroke-width="8" stroke-linecap="round"/>
  <g transform="translate(0 36)">
    ${motifMarkup}
    <text x="250" y="384" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="900" fill="${primary}" letter-spacing="2">${headline}</text>
    <text x="250" y="425" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="${secondary}" letter-spacing="4">${subline}</text>
  </g>
</svg>`;
}

function buildOrderPayload(input, designUrl) {
  const state = input.state || {};
  const design = state.design || {};
  const quantity = Math.max(1, Math.min(200, Number(state.quantity || 1)));
  const maxChargeCents = centsFromUsd(state.maxSpendUsd) || 7500;
  const estimatedUnitCents = 2400;
  const estimatedTotalCents = Math.min(maxChargeCents, estimatedUnitCents * quantity);
  const provider = sanitizeText(state.provider, 80) || "custom_ink";
  const size = sanitizeText(state.size, 40) || "M";
  const shirtColor = sanitizeText(state.shirtColorName, 80) || state.shirtColor || "natural";
  const style = sanitizeText(state.style, 80) || "classic unisex tee";
  const shippingAddress = sanitizeText(state.shippingAddress, 2000);
  const itemName = `${quantity} ${style}, size ${size}, ${shirtColor}`;

  return {
    store: provider,
    merchant: provider === "printful" ? "Printful" : provider === "printify" ? "Printify" : "Custom Ink",
    kind: "custom_human_task",
    order_type: "custom_apparel_order",
    item_name: itemName,
    quantity: String(quantity),
    shipping_address: shippingAddress || undefined,
    max_charge_cents: maxChargeCents,
    files: [
      {
        name: "ottoauth-shirt-design.svg",
        url: designUrl,
        purpose: "front_print_artwork",
        source: "tshirt_designer_demo",
      },
    ],
    quote: {
      source: "tshirt_demo_estimate",
      source_label: "T-shirt demo estimate",
      confidence: "low",
      goods_cents: estimatedTotalCents,
      total_cents: estimatedTotalCents,
      currency: "usd",
    },
    order_details: [
      "Use the attached SVG as the front print artwork.",
      `Headline: ${design.headline || "LOCAL DROP"}`,
      `Subline: ${design.subline || "MADE ON DEMAND"}`,
      `Motif: ${design.motif || "badge"}`,
      `Ink colors: ${[design.inkPrimary, design.inkSecondary, design.inkAccent].filter(Boolean).join(", ")}`,
      `Garment: ${itemName}`,
      "Place the order only if the final total is under max_charge_cents.",
      "If the provider requires choices that are not specified, ask for clarification instead of guessing.",
    ].join("\n"),
    task: `Order a custom printed T-shirt using the attached SVG artwork.\n\nGarment: ${itemName}\nProvider preference: ${provider}\nArtwork URL: ${designUrl}\n\nOnly complete fulfillment if the final total is under the spend cap.`,
    metadata: {
      source_app: "ottoauth_tshirt_designer_demo",
      design,
    },
  };
}

async function uploadDesignToOttoAuth(params) {
  const svg = renderDesignSvg(params.state || {});
  const remote = await fetch(`${params.ottoauthBaseUrl}/api/sdk/files`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.privateKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      files: [
        {
          name: "ottoauth-shirt-design.svg",
          content_type: "image/svg+xml",
          content_base64: Buffer.from(svg, "utf8").toString("base64"),
          metadata: {
            source: "tshirt_designer_demo",
            purpose: "front_print_artwork",
          },
        },
      ],
    }),
    signal: AbortSignal.timeout(12000),
  });
  const text = await remote.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `OttoAuth file upload returned non-JSON status ${remote.status}: ${text.slice(0, 160)}`,
    );
  }
  if (!remote.ok) {
    throw new Error(payload?.error || `OttoAuth file upload failed with status ${remote.status}.`);
  }
  const file = Array.isArray(payload?.files) ? payload.files[0] : null;
  if (!file?.url) {
    throw new Error("OttoAuth file upload did not return a file URL.");
  }
  return file;
}

function attachUploadedDesign(orderPayload, uploadedDesign, localDesignUrl) {
  orderPayload.files = orderPayload.files.map((file, index) =>
    index === 0
      ? {
          ...file,
          id: uploadedDesign.id,
          url: uploadedDesign.url,
          size: uploadedDesign.size,
          sha256: uploadedDesign.sha256,
          content_type: uploadedDesign.content_type,
          storage_backend: uploadedDesign.storage_backend,
        }
      : file,
  );
  orderPayload.metadata = {
    ...orderPayload.metadata,
    local_design_url: localDesignUrl,
    ottoauth_file_id: uploadedDesign.id,
  };
  return orderPayload;
}

async function handleAgentDesign(request, response) {
  const input = await readJson(request);
  sendJson(response, 200, { ok: true, design: generateDesign(input) });
}

async function handlePreview(request, response) {
  const input = await readJson(request);
  const id = randomUUID();
  storedDesigns.set(id, input.state || {});
  const localDesignUrl = `${publicBaseUrl(request)}/api/designs/${id}.svg`;
  let designUrl = localDesignUrl;
  let orderPayload = buildOrderPayload(input, designUrl);
  const ottoauthBaseUrl = (
    sanitizeText(input.ottoauthBaseUrl, 2000) || defaultOttoAuthBaseUrl
  ).replace(/\/$/, "");
  const privateKey =
    sanitizeText(input.privateKey, 400) || sanitizeText(process.env.OTTOAUTH_PRIVATE_KEY, 400);
  let uploadedDesign = null;
  let dryRun = null;
  let dryRunError = null;

  if (privateKey) {
    try {
      uploadedDesign = await uploadDesignToOttoAuth({
        state: input.state || {},
        ottoauthBaseUrl,
        privateKey,
      });
      designUrl = uploadedDesign.url;
      orderPayload = attachUploadedDesign(
        buildOrderPayload(input, designUrl),
        uploadedDesign,
        localDesignUrl,
      );

      const remote = await fetch(`${ottoauthBaseUrl}/v1/quotes`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${privateKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(orderPayload),
        signal: AbortSignal.timeout(5000),
      });
      const text = await remote.text();
      dryRun = text ? JSON.parse(text) : null;
    } catch (error) {
      dryRunError =
        error instanceof Error ? error.message : "Could not reach OttoAuth for quote preview.";
    }
  } else {
    dryRun = {
      skipped: true,
      note: "Paste an agent private key to preview the OttoAuth quote response.",
    };
  }

  sendJson(response, 200, {
    ok: true,
    orderPayload,
    designUrl,
    localDesignUrl,
    uploadedDesign,
    ottoauthBaseUrl,
    dryRun,
    dryRunError,
  });
}

async function handleBuy(request, response) {
  const input = await readJson(request);
  const privateKey =
    sanitizeText(input.privateKey, 400) || sanitizeText(process.env.OTTOAUTH_PRIVATE_KEY, 400);
  if (!privateKey) {
    sendJson(response, 400, {
      ok: false,
      error:
        "Missing OttoAuth private key. Set OTTOAUTH_PRIVATE_KEY before launching this demo, or paste a local test key in the settings drawer.",
    });
    return;
  }

  const id = randomUUID();
  storedDesigns.set(id, input.state || {});
  const ottoauthBaseUrl = (
    sanitizeText(input.ottoauthBaseUrl, 2000) || defaultOttoAuthBaseUrl
  ).replace(/\/$/, "");
  const localDesignUrl = `${publicBaseUrl(request)}/api/designs/${id}.svg`;
  const demoBaseUrl = publicBaseUrl(request);
  const successUrl = `${demoBaseUrl}/?ottoauth_checkout=success&session_id={CHECKOUT_SESSION_ID}&order_id={ORDER_ID}&task_id={TASK_ID}`;
  const cancelUrl = `${demoBaseUrl}/?ottoauth_checkout=canceled&session_id={CHECKOUT_SESSION_ID}`;
  let orderPayload = null;

  try {
    const uploadedDesign = await uploadDesignToOttoAuth({
      state: input.state || {},
      ottoauthBaseUrl,
      privateKey,
    });
    orderPayload = attachUploadedDesign(
      buildOrderPayload(input, uploadedDesign.url),
      uploadedDesign,
      localDesignUrl,
    );

    const checkoutBody = {
      app_id: "ottoauth-tshirt-designer-demo",
      app_name: "T-Shirt Studio",
      success_url: successUrl,
      cancel_url: cancelUrl,
      external_id: `tshirt-${id}`,
      order: orderPayload,
      metadata: {
        source_app: "ottoauth_tshirt_designer_demo",
        design_id: id,
        ottoauth_file_id: uploadedDesign.id,
      },
    };

    let remote = null;
    let payload = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      remote = await fetch(`${ottoauthBaseUrl}/v1/checkout/sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${privateKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(checkoutBody),
        signal: AbortSignal.timeout(12000),
      });
      const text = await remote.text();
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        if (attempt === 1) {
          await sleep(350);
          continue;
        }
        throw new Error(
          `OttoAuth returned non-JSON status ${remote.status}: ${text.slice(0, 160)}`,
        );
      }
      if (remote.status === 404 && attempt === 1) {
        await sleep(350);
        continue;
      }
      break;
    }
    if (!remote) throw new Error("Could not reach OttoAuth.");
    sendJson(response, remote.status, {
      ok: remote.ok,
      ottoauthBaseUrl,
      localDesignUrl,
      designUrl: uploadedDesign.url,
      uploadedDesign,
      request: orderPayload,
      response: payload,
      checkoutUrl: payload?.url || payload?.session?.url || null,
    });
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not create OttoAuth checkout session.",
      ottoauthBaseUrl,
      request: orderPayload,
    });
  }
}

function serveDesign(request, response) {
  const id = decodeURIComponent(request.url.split("/").pop()?.replace(/\.svg$/, "") || "");
  const state = storedDesigns.get(id);
  if (!state) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("design not found");
    return;
  }
  response.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(renderDesignSvg(state));
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
          : ext === ".svg"
            ? "image/svg+xml; charset=utf-8"
            : "application/octet-stream";
  response.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url.startsWith("/api/designs/")) {
      serveDesign(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/agent-design") {
      await handleAgentDesign(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/ottoauth-preview") {
      await handlePreview(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/buy") {
      await handleBuy(request, response);
      return;
    }
    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }
    sendJson(response, 405, { ok: false, error: "method not allowed" });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
});

server.listen(port, "127.0.0.1", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(__dirname, "package.json"), "utf8").catch(() => "{}"),
  );
  console.log(`${packageJson.name || "tshirt-designer"} running at http://127.0.0.1:${port}`);
  console.log(`OttoAuth default base URL: ${defaultOttoAuthBaseUrl}`);
});
