#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3100";

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const headers = response.headers.getSetCookie?.() || [];
    const fallback = response.headers.get("set-cookie");
    if (fallback && headers.length === 0) headers.push(fallback);
    for (const header of headers) {
      const first = header.split(";")[0];
      const eq = first.indexOf("=");
      if (eq > 0) this.cookies.set(first.slice(0, eq), first.slice(eq + 1));
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function compact(value) {
  if (!value || typeof value !== "object") return value;
  return {
    ok: value.ok,
    error: value.error,
    deprecated: value.deprecated,
    replacement_path: value.replacement_path,
    id: value.order?.id,
    reused: value.reused,
    status: value.order?.status ?? value.order_preview?.status,
    mode: value.order?.fulfillment_mode ?? value.order_preview?.fulfillment_mode,
    kind: value.order?.kind ?? value.order_preview?.kind,
    pricing: value.pricing?.state ?? value.order?.pricing?.state ?? value.order_preview?.pricing?.state,
    display_total_cents:
      value.pricing?.display_total_cents ??
      value.order?.pricing?.display_total_cents ??
      value.order_preview?.pricing?.display_total_cents,
    max_charge_cents:
      value.pricing?.max_charge_cents ??
      value.order?.pricing?.max_charge_cents ??
      value.order_preview?.pricing?.max_charge_cents,
    files: value.files?.length ?? value.order_preview?.files?.length,
    messages: value.messages?.length,
    clarifications: value.clarifications?.length,
    events: value.events?.length,
  };
}

async function request(name, path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.json !== undefined) headers.set("content-type", "application/json");
  if (options.cookieJar) {
    const cookie = options.cookieJar.header();
    if (cookie) headers.set("cookie", cookie);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || (options.json !== undefined ? "POST" : "GET"),
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    redirect: "manual",
  });
  options.cookieJar?.capture(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  console.log(JSON.stringify({ name, status: response.status, body: compact(data) }));
  return { response, data, text };
}

async function expect(name, path, options, predicate, message) {
  const result = await request(name, path, options);
  assert(predicate(result.response, result.data, result.text), `${message}: ${result.text}`);
  return result;
}

function authPayload(agent) {
  return { username: agent.username, private_key: agent.privateKey };
}

async function main() {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const adminJar = new CookieJar();
  const adminEmail = process.env.OTTOAUTH_CONTRACT_ADMIN_EMAIL || "admin@example.com";

  await expect(
    "service index",
    "/api/services",
    {},
    (_res, data) => data?.agentStart?.defaultServiceId === "order" && data?.services?.length === 2,
    "Service index should expose only order and wallet",
  );
  await expect(
    "order service manifest",
    "/api/services/order",
    {},
    (_res, data) => data?.service?.id === "order" && data?.service?.tools?.length >= 8,
    "Order service manifest should describe the canonical API",
  );
  await expect(
    "platform catalog",
    "/api/services/order/platforms",
    {},
    (_res, data) => data?.catalog?.platforms?.length === 100 && data?.providers?.length >= 100,
    "Platform catalog should expose the 100-platform catalog",
  );

  for (const [name, path] of [
    ["legacy services computeruse submit", "/api/services/computeruse/submit-task"],
    ["legacy computeruse tasks", "/api/computeruse/tasks"],
    ["legacy amazon pay", "/api/pay/amazon/create-session"],
  ]) {
    await expect(
      name,
      path,
      { method: "POST", json: { task_prompt: "legacy call" } },
      (res, data) => res.status === 410 && data?.deprecated === true && data?.replacement_path === "/api/services/order/submit",
      `${path} should be explicitly deprecated`,
    );
  }

  await expect(
    "invalid json",
    "/api/services/order/submit",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" },
    (res, data) => res.status === 400 && /Invalid JSON/.test(data?.error || ""),
    "Invalid JSON should return 400",
  );
  await expect(
    "missing order dry run",
    "/api/services/order/submit",
    { json: { dry_run: true } },
    (res, data) => res.status === 400 && /needs/i.test(data?.error || ""),
    "Missing order data should return 400",
  );
  await expect(
    "amazon dry run",
    "/api/services/order/submit",
    { json: { dry_run: true, store: "amazon", item_name: "AA batteries", max_charge_cents: 1500 } },
    (_res, data) =>
      data?.ok === true &&
      data?.order_preview?.fulfillment_mode === "human_admin" &&
      data?.order_preview?.pricing?.state === "spend_limit_only" &&
      data?.order_preview?.pricing?.max_charge_cents === 1500,
    "Amazon dry run should route to human admin fallback with spend-limit pricing",
  );
  await expect(
    "explicit estimate dry run",
    "/api/services/order/submit",
    {
      json: {
        dry_run: true,
        store: "amazon",
        item_name: "AA batteries",
        estimated_total_cents: 1299,
        estimate_high_cents: 1800,
        max_charge_cents: 2000,
      },
    },
    (_res, data) =>
      data?.ok === true &&
      data?.pricing?.state === "estimated" &&
      data?.pricing?.source === "explicit_request" &&
      data?.pricing?.display_total_cents === 1299 &&
      data?.pricing?.spend_limit?.covers_high_estimate === true,
    "Explicit estimates should be surfaced in pricing",
  );
  await expect(
    "dry run without spend cap",
    "/api/services/order/submit",
    {
      json: {
        dry_run: true,
        store: "treatstock",
        order_details: "3D print a small bracket.",
        files: [{ file_id: "file_preview", name: "bracket.stl", download_url: "https://example.com/bracket.stl" }],
      },
    },
    (_res, data) =>
      data?.ok === true &&
      data?.pricing?.state === "estimated" &&
      data?.pricing?.spend_limit?.provided === false,
    "Dry runs should return estimates even before a spend limit is chosen",
  );
  await expect(
    "treatstock file dry run",
    "/api/services/order/submit",
    {
      json: {
        dry_run: true,
        store: "treatstock",
        order_details: "3D print this bracket in black PLA",
        max_charge_cents: 1500,
        files: [{ file_id: "file_preview", name: "bracket.stl", download_url: "https://example.com/bracket.stl" }],
      },
    },
    (_res, data) =>
      data?.ok === true &&
      data?.order_preview?.kind === "manufacturing_3d_print" &&
      data?.order_preview?.files?.length === 1 &&
      data?.order_preview?.pricing?.state === "estimated" &&
      data?.order_preview?.pricing?.estimated_total_cents > 0,
    "Manufacturing dry run should preserve file references and return an estimate",
  );

  const agent = await expect(
    "create linked agent",
    "/api/agents/create",
    { json: { username: `contract_${suffix}`, callback_url: "https://example.com/ottoauth/callback" } },
    (_res, data) => Boolean(data?.username && data?.privateKey && data?.pairingKey),
    "Agent creation should return credentials",
  );
  const linkedAgent = agent.data;

  await expect(
    "dev login admin",
    "/api/auth/dev-login",
    { cookieJar: adminJar, json: { email: adminEmail, display_name: "Contract Admin" } },
    (_res, data) => data?.ok === true,
    "Dev login should be enabled for contract tests",
  );
  await expect(
    "human me schema fanout",
    "/api/human/me",
    { cookieJar: adminJar },
    (_res, data) => data?.user?.email === adminEmail,
    "/api/human/me should survive concurrent schema-backed reads",
  );
  await expect(
    "pair linked agent",
    "/api/human/pair-agent",
    { cookieJar: adminJar, json: { pairing_key: linkedAgent.pairingKey } },
    (_res, data) => data?.ok === true,
    "Pairing should link the agent to the logged-in human",
  );
  await expect(
    "real order requires spend cap",
    "/api/services/order/submit",
    {
      json: {
        ...authPayload(linkedAgent),
        store: "amazon",
        item_name: "AA batteries",
      },
    },
    (res, data) => res.status === 400 && /max_charge_cents is required/i.test(data?.error || ""),
    "Real orders should require max_charge_cents",
  );

  const fileUpload = await expect(
    "upload order file",
    "/api/services/order/files",
    {
      json: {
        ...authPayload(linkedAgent),
        filename: "bracket.stl",
        content_type: "model/stl",
        content_base64: Buffer.from("solid test\nendsolid test\n").toString("base64"),
        purpose: "manufacturing_file",
      },
    },
    (_res, data) => data?.ok === true && data?.files?.[0]?.file_id && data?.files?.[0]?.size_bytes > 0,
    "File upload should return a file reference",
  );
  const uploadedFile = fileUpload.data.files[0];
  await expect(
    "file download rejects anonymous",
    `/api/services/order/files/${uploadedFile.file_id}`,
    {},
    (res, data) => res.status === 401 && /authentication/i.test(data?.error || ""),
    "File download should not be anonymous",
  );
  await expect(
    "file download accepts bearer",
    `/api/services/order/files/${uploadedFile.file_id}`,
    { headers: { authorization: `Bearer ${linkedAgent.privateKey}` } },
    (res, _data, text) => res.status === 200 && text.includes("solid test"),
    "File download should allow owning agent bearer auth",
  );

  const idempotencyKey = `contract-${suffix}`;
  const orderBody = {
    ...authPayload(linkedAgent),
    store: "treatstock",
    order_details: "3D print this bracket in black PLA",
    max_charge_cents: 1500,
    files: [uploadedFile],
    idempotency_key: idempotencyKey,
  };
  const created = await expect(
    "create funded linked order",
    "/api/services/order/submit",
    { json: orderBody },
    (res, data) =>
      res.status === 201 &&
      data?.ok === true &&
      data?.order?.status === "human_required" &&
      data?.order?.pricing?.state === "estimated" &&
      data?.order?.pricing?.max_charge_cents === 1500,
    "Linked order should create without x402 when starter credits cover the cap and expose pricing",
  );
  const orderId = created.data.order.id;
  await expect(
    "idempotent order reuse",
    "/api/services/order/submit",
    { json: orderBody },
    (res, data) => res.status === 200 && data?.reused === true && data?.order?.id === orderId,
    "Idempotent submit should reuse the original order",
  );
  await expect(
    "get order status",
    `/api/services/order/tasks/${orderId}`,
    { json: authPayload(linkedAgent) },
    (_res, data) =>
      data?.ok === true &&
      data?.order?.id === orderId &&
      data?.order?.pricing?.state === "estimated" &&
      Array.isArray(data?.events),
    "Status endpoint should return normalized order state and pricing",
  );
  await expect(
    "send provider message",
    `/api/services/order/tasks/${orderId}/messages`,
    { json: { ...authPayload(linkedAgent), channel: "provider_vendor", message: "Please use black PLA." } },
    (_res, data) => data?.ok === true && data?.message?.status === "needs_human_delivery",
    "Provider messages without native messaging should require human delivery",
  );
  const clarification = await expect(
    "create clarification via v1",
    `/v1/orders/${orderId}/clarifications`,
    { json: { ...authPayload(linkedAgent), question: "What infill should the operator use?" } },
    (_res, data) => data?.ok === true && data?.order?.status === "blocked",
    "Clarification creation should block the order",
  );
  await expect(
    "answer clarification",
    `/api/services/order/tasks/${orderId}/clarification`,
    {
      json: {
        ...authPayload(linkedAgent),
        clarification_id: clarification.data.clarification.id,
        clarification_response: "Use 20 percent infill.",
      },
    },
    (_res, data) => data?.ok === true && data?.order?.status === "human_required",
    "Clarification answer should unblock human fulfillment",
  );
  await expect(
    "open dispute",
    `/api/services/order/tasks/${orderId}/disputes`,
    {
      json: {
        ...authPayload(linkedAgent),
        reason: "Need operator review before production.",
        requested_resolution: "Confirm quote before placing order.",
      },
    },
    (_res, data) => data?.ok === true && data?.order?.status === "disputed",
    "Dispute endpoint should record dispute state",
  );
  await expect(
    "admin manual fulfillment",
    `/api/admin/fulfillment/orders/${orderId}/manual`,
    {
      cookieJar: adminJar,
      json: {
        status: "completed",
        merchant: "Treatstock",
        summary: "Contract test manual fulfillment completed.",
        order_number: `CONTRACT-${suffix}`,
        goods_cents: 900,
        shipping_cents: 100,
        tax_cents: 0,
      },
    },
    (_res, data) =>
      data?.ok === true &&
      data?.order?.status === "completed" &&
      data?.order?.result?.manual_admin_fulfillment === true,
    "Admin manual fulfillment should finalize the order",
  );

  const cancelOrder = await expect(
    "create cancel target",
    "/api/services/order/submit",
    {
      json: {
        ...authPayload(linkedAgent),
        store: "amazon",
        item_name: "USB-C cable",
        max_charge_cents: 500,
        idempotency_key: `cancel-${suffix}`,
      },
    },
    (res, data) => res.status === 201 && data?.order?.status === "human_required",
    "Second order should be available for cancellation",
  );
  await expect(
    "manual completion over cap rejects",
    `/api/admin/fulfillment/orders/${cancelOrder.data.order.id}/manual`,
    {
      cookieJar: adminJar,
      json: {
        status: "completed",
        merchant: "Amazon",
        summary: "This should not close because it exceeds the cap.",
        order_number: `OVER-CAP-${suffix}`,
        goods_cents: 600,
      },
    },
    (res, data) => res.status === 409 && /exceeds the spend cap/i.test(data?.error || ""),
    "Manual fulfillment should reject totals above max_charge_cents",
  );
  await expect(
    "cancel order",
    `/api/services/order/tasks/${cancelOrder.data.order.id}/cancel`,
    { json: { ...authPayload(linkedAgent), reason: "Contract cancellation test." } },
    (_res, data) => data?.ok === true && data?.cancelled === true && data?.order?.status === "canceled",
    "Cancel endpoint should mark unfinished orders canceled",
  );

  const unlinked = await expect(
    "create unlinked agent",
    "/api/agents/create",
    { json: { username: `unlinked_${suffix}`, callback_url: "https://example.com/ottoauth/callback" } },
    (_res, data) => Boolean(data?.privateKey),
    "Unlinked agent creation should succeed",
  );
  await expect(
    "unlinked order requires x402",
    "/api/services/order/submit",
    {
      json: {
        username: unlinked.data.username,
        private_key: unlinked.data.privateKey,
        store: "amazon",
        item_name: "AA batteries",
        max_charge_cents: 500,
      },
    },
    (res, data) => res.status === 402 && data?.payment_protocol === "x402",
    "Unlinked orders should require x402 funding when x402 is not configured",
  );

  console.log(JSON.stringify({ ok: true, order_id: orderId, baseUrl }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
