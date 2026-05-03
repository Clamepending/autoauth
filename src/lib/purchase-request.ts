import {
  normalizeOptionalShippingAddress,
  normalizeOptionalWebsiteUrl,
  type TaskUrlPolicy,
} from "@/lib/computeruse-task-prompts";

export type NormalizedPurchaseRequest = {
  taskPrompt: string;
  taskTitle: string;
  rawTask: string;
  merchantName: string | null;
  platformHint: string | null;
  fulfillment: string | null;
  pickupLocation: string | null;
  websiteUrl: string | null;
  shippingAddress: string | null;
  urlPolicy: TaskUrlPolicy;
  maxChargeCents: number | null;
  requestJson: Record<string, unknown>;
};

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readQuantity(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return firstString([value]);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeShortText(value: unknown, limit = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, limit);
}

function buildStructuredLines(params: {
  platformHint: string | null;
  merchantName: string | null;
  fulfillment: string | null;
  itemName: string | null;
  quantity: string | null;
  orderDetails: string | null;
  additionalInstructions: string | null;
}) {
  return [
    params.platformHint ? `Platform: ${params.platformHint}` : "",
    params.merchantName ? `Store or merchant name: ${params.merchantName}` : "",
    params.fulfillment ? `Fulfillment method: ${params.fulfillment}` : "",
    params.itemName ? `Item name: ${params.itemName}` : "",
    params.quantity ? `Quantity: ${params.quantity}` : "",
    params.orderDetails
      ? `Order details, modifiers, and preferences: ${params.orderDetails}`
      : "",
    params.additionalInstructions
      ? `Additional instructions: ${params.additionalInstructions}`
      : "",
  ].filter(Boolean);
}

function parseUrlPolicy(value: unknown, hasUrl: boolean): TaskUrlPolicy {
  if (typeof value !== "string" || !value.trim()) {
    return hasUrl ? "preferred" : "discover";
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "discover" ||
    normalized === "preferred" ||
    normalized === "required"
  ) {
    return normalized;
  }
  throw new Error("url_policy must be discover, preferred, or required.");
}

function parseOptionalCents(payload: Record<string, unknown>) {
  const value =
    payload.max_spend_cents ??
    payload.maxSpendCents ??
    payload.max_charge_cents ??
    payload.maxChargeCents;
  if (value == null || value === "") return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error("max_spend_cents must be a number if provided.");
  }
  return Math.trunc(parsed);
}

function buildPrompt(params: {
  rawTask: string;
  merchantName: string | null;
  platformHint: string | null;
  fulfillment: string | null;
  pickupLocation: string | null;
  deliveryAddress: string | null;
  url: string | null;
  urlPolicy: TaskUrlPolicy;
}) {
  const hints = [
    params.merchantName ? `Merchant hint: ${params.merchantName}` : null,
    params.platformHint ? `Platform hint: ${params.platformHint}` : null,
    params.fulfillment ? `Fulfillment hint: ${params.fulfillment}` : null,
    params.pickupLocation ? `Pickup/search location hint: ${params.pickupLocation}` : null,
    params.deliveryAddress
      ? "Delivery/shipping address is provided separately. Use it exactly as written if checkout asks for it."
      : null,
    params.url ? `URL hint: ${params.url}` : null,
    `URL policy: ${params.urlPolicy}`,
  ].filter((line): line is string => Boolean(line));

  if (hints.length === 0) return params.rawTask;
  return `${params.rawTask}\n\nDeveloper-supplied request hints:\n${hints
    .map((line) => `- ${line}`)
    .join("\n")}`;
}

function buildRequestJson(params: {
  rawTask: string;
  merchantName: string | null;
  platformHint: string | null;
  itemName: string | null;
  quantity: string | null;
  orderDetails: string | null;
  url: string | null;
  urlPolicy: TaskUrlPolicy;
  fulfillment: string | null;
  pickupLocation: string | null;
  deliveryAddressPresent: boolean;
}) {
  return {
    task: params.rawTask,
    merchant_name: params.merchantName,
    platform_hint: params.platformHint,
    item_name: params.itemName,
    quantity: params.quantity,
    order_details: params.orderDetails,
    url: params.url,
    url_policy: params.urlPolicy,
    fulfillment: params.fulfillment,
    pickup_location: params.pickupLocation,
    delivery_address_present: params.deliveryAddressPresent,
  };
}

export function normalizePurchaseRequestPayload(
  payload: Record<string, unknown>,
): NormalizedPurchaseRequest {
  const merchant = getRecord(payload.merchant);
  const product = getRecord(payload.product);

  const freeformTask = firstString([
    payload.task,
    payload.task_prompt,
    payload.taskPrompt,
    payload.request,
    payload.prompt,
  ]);

  const merchantName = normalizeShortText(
    firstString([
      merchant?.name,
      payload.merchant,
      payload.merchant_name,
      payload.merchantName,
      payload.store_name,
      payload.storeName,
    ]),
  );
  const platformHint = normalizeShortText(
    firstString([
      payload.store,
      payload.platform,
      payload.platform_hint,
      payload.platformHint,
      payload.service,
      merchant?.platform,
    ]),
    100,
  );
  const fulfillment = normalizeShortText(
    firstString([
      payload.fulfillment,
      payload.fulfillment_type,
      payload.fulfillmentType,
      payload.order_type,
      payload.orderType,
      payload.fulfillment_method,
      payload.fulfillmentMethod,
    ]),
    100,
  );
  const itemName = normalizeShortText(
    firstString([
      payload.item_name,
      payload.itemName,
      payload.product_name,
      payload.productName,
      payload.product,
      product?.name,
      product?.title,
    ]),
  );
  const quantity = normalizeShortText(readQuantity(payload.quantity), 100);
  const orderDetails = normalizeShortText(
    firstString([payload.order_details, payload.orderDetails, payload.instructions]),
  );
  const additionalInstructions = normalizeShortText(
    firstString([
      payload.additional_instructions,
      payload.additionalInstructions,
    ]),
  );
  const structuredLines = buildStructuredLines({
    platformHint,
    merchantName,
    fulfillment,
    itemName,
    quantity,
    orderDetails,
    additionalInstructions,
  });
  const rawTask = [...structuredLines, freeformTask].filter(Boolean).join("\n");
  if (!rawTask) {
    throw new Error(
      "Provide task, task_prompt, or structured order fields such as store, merchant, item_name, order_type, or order_details.",
    );
  }
  const explicitUrl = firstString([
    payload.url,
    payload.product_url,
    payload.productUrl,
    product?.url,
    merchant?.url,
    payload.merchant_url,
    payload.merchantUrl,
    payload.store_url,
    payload.storeUrl,
    payload.website_url,
    payload.websiteUrl,
  ]);
  const candidateUrl = explicitUrl ? normalizeOptionalWebsiteUrl(explicitUrl) : null;
  const urlPolicy = parseUrlPolicy(payload.url_policy ?? payload.urlPolicy, Boolean(candidateUrl));
  if (urlPolicy === "required" && !candidateUrl) {
    throw new Error("url_policy=required needs a url, product_url, merchant.url, or website_url.");
  }
  const websiteUrl = urlPolicy === "discover" ? null : candidateUrl;

  const shippingAddress = normalizeOptionalShippingAddress(
    payload.delivery_address ??
      payload.deliveryAddress ??
      payload.shipping_address ??
      payload.shippingAddress,
  );
  const pickupLocation = normalizeShortText(
    firstString([
      payload.pickup_location,
      payload.pickupLocation,
      payload.location,
      payload.search_location,
      payload.searchLocation,
      payload.destination,
    ]),
  );
  const maxChargeCents = parseOptionalCents(payload);
  const taskPrompt = buildPrompt({
    rawTask,
    merchantName,
    platformHint,
    fulfillment,
    pickupLocation,
    deliveryAddress: shippingAddress,
    url: candidateUrl,
    urlPolicy,
  });
  const taskTitle =
    firstString([payload.task_title, payload.taskTitle, payload.title]) ||
    [merchantName || platformHint, itemName || fulfillment].filter(Boolean).join(": ") ||
    rawTask.slice(0, 80);

  return {
    taskPrompt,
    taskTitle,
    rawTask,
    merchantName,
    platformHint,
    fulfillment,
    pickupLocation,
    websiteUrl,
    shippingAddress,
    urlPolicy,
    maxChargeCents,
    requestJson: buildRequestJson({
      rawTask,
      merchantName,
      platformHint,
      itemName,
      quantity,
      orderDetails,
      url: candidateUrl,
      urlPolicy,
      fulfillment,
      pickupLocation,
      deliveryAddressPresent: Boolean(shippingAddress),
    }),
  };
}
