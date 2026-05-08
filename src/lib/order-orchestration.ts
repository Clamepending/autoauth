import { createHash, randomUUID } from "node:crypto";

import { sendAdminOrderSms } from "@/lib/admin-sms-notifications";
import { addCreditLedgerEntry, getHumanCreditBalance } from "@/lib/human-accounts";
import { estimateOrderPricing } from "@/lib/order-pricing";
import { PLATFORM_CATALOG, type PlatformCatalogEntry } from "@/lib/platform-catalog";
import { runSerializedSchemaMigration } from "@/lib/schema-lock";
import { getTursoClient } from "@/lib/turso";
import type { NonBrowserPriceQuote } from "@/lib/non-browser-price-quotes";

export type OrderKind =
  | "retail_purchase"
  | "grocery_delivery"
  | "restaurant_delivery"
  | "ride"
  | "manufacturing_3d_print"
  | "manufacturing_pcb"
  | "custom_human_task";

export type OrderStatus =
  | "submitted"
  | "routed"
  | "quote_requested"
  | "quoted"
  | "awaiting_approval"
  | "awaiting_payment"
  | "ready_to_fulfill"
  | "api_ordering"
  | "human_required"
  | "human_claimed"
  | "blocked"
  | "completed"
  | "failed"
  | "canceled"
  | "disputed";

export type FulfillmentMode =
  | "native_api"
  | "quote_first_api"
  | "human_admin"
  | "legacy_browser";

export type ProviderCapabilities = {
  quote: boolean;
  place_order: boolean;
  cancel: boolean;
  status_tracking: boolean;
  live_tracking: boolean;
  messaging: boolean;
  clarification: boolean;
  dispute: boolean;
  file_upload: boolean;
  proof_of_completion: boolean;
  refund: boolean;
};

export type ProviderDefinition = {
  id: string;
  label: string;
  defaultKind: OrderKind;
  preferredMode: FulfillmentMode;
  nativeAvailable: boolean;
  aliases: string[];
  capabilities: ProviderCapabilities;
};

export type NormalizedOrderItem = {
  name: string;
  quantity: string | null;
  details: string | null;
  url: string | null;
};

export type NormalizedOrderRequest = {
  kind: OrderKind;
  store: string | null;
  merchant: string | null;
  task: string;
  title: string;
  orderType: string | null;
  storeUrl: string | null;
  pickupLocation: string | null;
  shippingAddress: string | null;
  items: NormalizedOrderItem[];
  files: Array<Record<string, unknown>>;
  notes: string | null;
  raw: Record<string, unknown>;
};

export type HumanFulfillmentPacket = {
  title: string;
  priority: "normal" | "high";
  provider_label: string;
  kind: OrderKind;
  fulfillment_goal: string;
  spend_cap_cents: number | null;
  merchant: string | null;
  store_url: string | null;
  pickup_location: string | null;
  shipping_address: string | null;
  items: NormalizedOrderItem[];
  files: Array<Record<string, unknown>>;
  checklist: string[];
  customer_visible_fields: string[];
  risk_notes: string[];
};

export type OttoAuthOrderRecord = {
  id: number;
  public_id: string;
  agent_id: number;
  agent_username_lower: string;
  human_user_id: number;
  submission_source: "agent" | "human" | "admin";
  external_id: string | null;
  idempotency_key: string | null;
  status: OrderStatus;
  fulfillment_mode: FulfillmentMode;
  provider_id: string;
  provider_label: string;
  provider_order_id: string | null;
  kind: OrderKind;
  request_json: string;
  normalized_items_json: string | null;
  quote_json: string | null;
  human_packet_json: string | null;
  result_json: string | null;
  payment_status: string;
  max_charge_cents: number | null;
  quoted_total_cents: number | null;
  authorized_cents: number;
  captured_cents: number;
  currency: string;
  agent_mandate_policy_id: number | null;
  agent_mandate_revision: number | null;
  callback_url: string | null;
  admin_notes: string | null;
  claimed_by_admin_email: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OttoAuthOrderEventRecord = {
  id: number;
  order_id: number;
  type: string;
  payload_json: string | null;
  created_at: string;
};

export type OttoAuthOrderMessageRecord = {
  id: number;
  order_id: number;
  channel: string;
  author_type: string;
  author_label: string | null;
  body: string;
  delivery_mode: "native_api" | "human_admin" | "internal";
  status: string;
  created_at: string;
};

export type OttoAuthOrderClarificationRecord = {
  id: number;
  order_id: number;
  question: string;
  status: "open" | "answered" | "canceled";
  response: string | null;
  requested_by: string | null;
  responded_by: string | null;
  created_at: string;
  responded_at: string | null;
};

export type OttoAuthOrderDisputeRecord = {
  id: number;
  order_id: number;
  reason: string;
  status: "open" | "in_review" | "resolved" | "rejected";
  requested_resolution: string | null;
  evidence_json: string | null;
  provider_case_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OttoAuthOrderFileRecord = {
  id: number;
  file_id: string;
  agent_id: number;
  agent_username_lower: string;
  human_user_id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  purpose: string;
  storage_kind: "db_blob";
  blob_data: Uint8Array;
  metadata_json: string | null;
  created_at: string;
};

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  quote: false,
  place_order: false,
  cancel: false,
  status_tracking: false,
  live_tracking: false,
  messaging: false,
  clarification: true,
  dispute: true,
  file_upload: false,
  proof_of_completion: true,
  refund: false,
};

const BASE_PROVIDERS: ProviderDefinition[] = [
  {
    id: "amazon",
    label: "Amazon",
    defaultKind: "retail_purchase",
    preferredMode: "human_admin",
    nativeAvailable: false,
    aliases: ["amazon", "amzn"],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      cancel: true,
      status_tracking: true,
      dispute: true,
      refund: true,
    },
  },
  {
    id: "treatstock",
    label: "Treatstock",
    defaultKind: "manufacturing_3d_print",
    preferredMode: "quote_first_api",
    nativeAvailable: false,
    aliases: ["treatstock", "3d print", "3d printing", "stl", "3mf"],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      quote: true,
      place_order: true,
      cancel: true,
      status_tracking: true,
      file_upload: true,
      dispute: true,
      refund: true,
    },
  },
  {
    id: "jlcpcb",
    label: "JLCPCB",
    defaultKind: "manufacturing_pcb",
    preferredMode: "quote_first_api",
    nativeAvailable: false,
    aliases: ["jlc", "jlcpcb", "pcb", "pcba", "gerber", "cpl", "bom"],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      quote: true,
      place_order: true,
      cancel: true,
      status_tracking: true,
      file_upload: true,
      dispute: true,
    },
  },
  {
    id: "mouser",
    label: "Mouser",
    defaultKind: "retail_purchase",
    preferredMode: "quote_first_api",
    nativeAvailable: false,
    aliases: ["mouser", "electronics parts", "component"],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      quote: true,
      place_order: true,
      cancel: true,
      status_tracking: true,
      dispute: true,
    },
  },
  {
    id: "instacart",
    label: "Instacart",
    defaultKind: "grocery_delivery",
    preferredMode: "human_admin",
    nativeAvailable: false,
    aliases: ["instacart", "grocery", "groceries"],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      status_tracking: true,
      live_tracking: true,
      messaging: true,
      cancel: true,
      refund: true,
    },
  },
  {
    id: "uber",
    label: "Uber",
    defaultKind: "ride",
    preferredMode: "human_admin",
    nativeAvailable: false,
    aliases: ["uber", "ride", "rideshare", "taxi"],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      cancel: true,
      status_tracking: true,
      live_tracking: true,
      messaging: true,
      refund: true,
    },
  },
  {
    id: "ubereats",
    label: "Uber Eats",
    defaultKind: "restaurant_delivery",
    preferredMode: "human_admin",
    nativeAvailable: false,
    aliases: ["uber eats", "ubereats", "food delivery"],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      cancel: true,
      status_tracking: true,
      live_tracking: true,
      messaging: true,
      refund: true,
    },
  },
  {
    id: "restaurant_delivery",
    label: "Restaurant delivery",
    defaultKind: "restaurant_delivery",
    preferredMode: "human_admin",
    nativeAvailable: false,
    aliases: [
      "restaurant_delivery",
      "restaurant delivery",
      "restaurant",
      "food delivery",
      "food",
      "hot dog",
      "doordash",
      "door dash",
      "grubhub",
      "grub hub",
    ],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      cancel: true,
      status_tracking: true,
      live_tracking: true,
      messaging: true,
      refund: true,
    },
  },
  {
    id: "snackpass",
    label: "Snackpass",
    defaultKind: "restaurant_delivery",
    preferredMode: "human_admin",
    nativeAvailable: false,
    aliases: ["snackpass"],
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      cancel: true,
      status_tracking: true,
      dispute: true,
      refund: true,
    },
  },
  {
    id: "manual",
    label: "Manual Human Fulfillment",
    defaultKind: "custom_human_task",
    preferredMode: "human_admin",
    nativeAvailable: true,
    aliases: ["manual", "human", "unknown"],
    capabilities: {
      quote: true,
      place_order: true,
      cancel: true,
      status_tracking: true,
      live_tracking: false,
      messaging: true,
      clarification: true,
      dispute: true,
      file_upload: true,
      proof_of_completion: true,
      refund: true,
    },
  },
];

function capabilitiesForPlatform(platform: PlatformCatalogEntry): ProviderCapabilities {
  const fileUpload = platform.fileTypes.length > 0;
  const quoteHeavy =
    platform.category === "get_made_manufacturing" ||
    platform.category === "pcb_electronics" ||
    platform.category === "print_custom_goods";
  return {
    ...DEFAULT_CAPABILITIES,
    quote: quoteHeavy,
    place_order: true,
    cancel: true,
    status_tracking: true,
    live_tracking: platform.kind === "ride" || platform.kind === "restaurant_delivery" || platform.kind === "grocery_delivery",
    messaging:
      platform.kind === "ride" ||
      platform.kind === "restaurant_delivery" ||
      platform.kind === "grocery_delivery" ||
      quoteHeavy,
    dispute: true,
    file_upload: fileUpload,
    refund: true,
  };
}

function providerFromPlatform(platform: PlatformCatalogEntry): ProviderDefinition {
  return {
    id: platform.id,
    label: platform.name,
    defaultKind: platform.kind as OrderKind,
    preferredMode:
      platform.category === "get_made_manufacturing" || platform.category === "pcb_electronics"
        ? "quote_first_api"
        : "human_admin",
    nativeAvailable: false,
    aliases: [
      platform.id,
      platform.name,
      platform.category.replace(/_/g, " "),
      ...platform.aliases,
    ],
    capabilities: capabilitiesForPlatform(platform),
  };
}

const BASE_PROVIDER_IDS = new Set(BASE_PROVIDERS.map((provider) => provider.id));
const PROVIDERS: ProviderDefinition[] = [
  ...BASE_PROVIDERS,
  ...PLATFORM_CATALOG.platforms
    .filter((platform) => !BASE_PROVIDER_IDS.has(platform.id))
    .map(providerFromPlatform),
];

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

function optionalString(value: unknown, maxLength = 2000) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function multilineString(value: unknown, maxLength = 4000) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function optionalRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeCents(value: unknown) {
  if (value == null || value === "") return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[^0-9.-]/g, ""))
        : Number.NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function hasSpendLimitField(payload: Record<string, unknown>) {
  return (
    payload.max_charge_cents != null ||
    payload.maxChargeCents != null ||
    payload.max_spend_cents != null ||
    payload.maxSpendCents != null
  );
}

function normalizeCurrency(value: unknown) {
  const raw = optionalString(value, 8)?.toLowerCase() || "usd";
  return /^[a-z]{3}$/.test(raw) ? raw : "usd";
}

function parseJsonObject(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function asStringArray(values: unknown[]) {
  return values
    .map((value) => optionalString(value, 1000))
    .filter((value): value is string => Boolean(value));
}

function normalizeFiles(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): Record<string, unknown> | null => {
      const record = optionalRecord(entry);
      if (!record) return null;
      const fileId = optionalString(record.file_id ?? record.fileId ?? record.id, 120);
      const name = optionalString(record.name ?? record.filename ?? record.file_name ?? record.fileName, 500);
      const url = optionalString(record.url ?? record.download_url ?? record.downloadUrl, 2000);
      const contentType = optionalString(record.content_type ?? record.contentType ?? record.mime_type, 200);
      const sizeBytes =
        typeof record.size_bytes === "number"
          ? record.size_bytes
          : typeof record.sizeBytes === "number"
            ? record.sizeBytes
            : typeof record.size === "number"
              ? record.size
              : null;
      const purpose = optionalString(record.purpose ?? record.role, 120);
      const notes = optionalString(record.notes ?? record.description, 1000);
      if (!fileId && !name && !url) return null;
      return {
        file_id: fileId,
        name,
        url,
        download_url: url,
        content_type: contentType,
        size_bytes: sizeBytes,
        purpose,
        notes,
        source: optionalString(record.source, 120) || (fileId ? "ottoauth_upload" : "external_url"),
      };
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .slice(0, 80);
}

function normalizeItems(payload: Record<string, unknown>) {
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.products)
      ? payload.products
      : [];
  const items = rawItems
    .map((entry): NormalizedOrderItem | null => {
      const record = optionalRecord(entry);
      if (!record) return null;
      const name = optionalString(
        record.name ?? record.title ?? record.item_name ?? record.itemName,
        500,
      );
      if (!name) return null;
      return {
        name,
        quantity: optionalString(record.quantity ?? record.qty, 80),
        details: optionalString(record.details ?? record.notes ?? record.description, 1000),
        url: optionalString(record.url ?? record.product_url ?? record.productUrl, 2000),
      };
    })
    .filter((entry): entry is NormalizedOrderItem => Boolean(entry));

  const itemName = optionalString(
    payload.item_name ?? payload.itemName ?? payload.product_name ?? payload.productName,
    500,
  );
  if (itemName && items.length === 0) {
    items.push({
      name: itemName,
      quantity: optionalString(payload.quantity ?? payload.qty, 80),
      details: optionalString(
        payload.order_details ?? payload.orderDetails ?? payload.details ?? payload.notes,
        1000,
      ),
      url: optionalString(payload.product_url ?? payload.productUrl ?? payload.url, 2000),
    });
  }

  return items.slice(0, 100);
}

function inferKind(payload: Record<string, unknown>, provider: ProviderDefinition | null): OrderKind {
  const candidates = asStringArray([
    payload.kind,
    payload.order_kind,
    payload.orderKind,
    payload.order_type,
    payload.orderType,
    payload.fulfillment,
    payload.store,
    payload.platform,
    payload.service,
    payload.order_details,
    payload.orderDetails,
    payload.instructions,
    payload.task,
    payload.task_prompt,
  ])
    .join(" ")
    .replace(/_/g, " ")
    .toLowerCase();

  if (/\b(ride|rideshare|uber|taxi|driver)\b/.test(candidates)) return "ride";
  if (/\b(pcb|pcba|gerber|cpl|bom|circuit board|jlc)\b/.test(candidates)) {
    return "manufacturing_pcb";
  }
  if (/\b(3d|print|printing|stl|3mf|step|cad|treatstock)\b/.test(candidates)) {
    return "manufacturing_3d_print";
  }
  if (/\b(grocery|groceries|instacart|safeway|whole foods)\b/.test(candidates)) {
    return "grocery_delivery";
  }
  if (/\b(restaurant|food|snackpass|ubereats|uber eats|doordash|grubhub|pickup)\b/.test(candidates)) {
    return "restaurant_delivery";
  }
  return provider?.defaultKind ?? "custom_human_task";
}

function normalizeProviderKey(value: string | null) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectProvider(payload: Record<string, unknown>) {
  const haystack = normalizeProviderKey(
    asStringArray([
      payload.provider_id,
      payload.providerId,
      payload.store,
      payload.platform,
      payload.service,
      payload.merchant,
      payload.merchant_name,
      payload.merchantName,
      payload.task,
      payload.task_prompt,
      payload.order_details,
    ]).join(" "),
  );
  for (const provider of PROVIDERS) {
    if (provider.aliases.some((alias) => haystack.includes(normalizeProviderKey(alias)))) {
      return provider;
    }
  }
  return PROVIDERS.find((provider) => provider.id === "manual")!;
}

function buildTaskFromFields(params: {
  store: string | null;
  merchant: string | null;
  orderType: string | null;
  pickupLocation: string | null;
  shippingAddress: string | null;
  items: NormalizedOrderItem[];
  files: Array<Record<string, unknown>>;
  notes: string | null;
}) {
  const target = [params.merchant, params.store].filter(Boolean).join(" on ");
  const itemLines = params.items.map((item) => {
    const parts = [
      item.quantity ? `qty ${item.quantity}` : null,
      item.name,
      item.details,
      item.url,
    ].filter(Boolean);
    return `- ${parts.join(" - ")}`;
  });
  const lines = [
    params.orderType ? `Order type: ${params.orderType}` : null,
    target ? `Store or provider: ${target}` : null,
    itemLines.length ? `Items:\n${itemLines.join("\n")}` : null,
    params.files.length
      ? `Files:\n${params.files
          .map((file) => {
            const name = typeof file.name === "string" ? file.name : "uploaded file";
            const url = typeof file.download_url === "string" ? file.download_url : typeof file.url === "string" ? file.url : null;
            const purpose = typeof file.purpose === "string" ? file.purpose : null;
            return `- ${[name, purpose, url].filter(Boolean).join(" - ")}`;
          })
          .join("\n")}`
      : null,
    params.pickupLocation ? `Pickup/search/destination location: ${params.pickupLocation}` : null,
    params.shippingAddress
      ? `Delivery/shipping address:\n${params.shippingAddress}`
      : null,
    params.notes ? `Instructions: ${params.notes}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n\n") : "";
}

export function normalizeOrderRequest(payload: Record<string, unknown>): NormalizedOrderRequest {
  const provider = selectProvider(payload);
  const store = optionalString(payload.store ?? payload.platform ?? payload.service, 120);
  const merchant = optionalString(
    payload.merchant ??
      payload.merchant_name ??
      payload.merchantName ??
      payload.store_name ??
      payload.storeName,
    200,
  );
  const orderType = optionalString(
    payload.order_type ?? payload.orderType ?? payload.fulfillment ?? payload.fulfillment_type,
    120,
  );
  const storeUrl = optionalString(
    payload.store_url ??
      payload.storeUrl ??
      payload.website_url ??
      payload.websiteUrl ??
      payload.url ??
      payload.product_url ??
      payload.productUrl,
    2000,
  );
  const pickupLocation = optionalString(
    payload.pickup_location ??
      payload.pickupLocation ??
      payload.location ??
      payload.destination,
    500,
  );
  const shippingAddress = multilineString(
    payload.shipping_address ??
      payload.shippingAddress ??
      payload.delivery_address ??
      payload.deliveryAddress,
    2000,
  );
  const notes = multilineString(
    payload.order_details ??
      payload.orderDetails ??
      payload.details ??
      payload.notes ??
      payload.instructions,
    3000,
  );
  const items = normalizeItems(payload);
  const files = normalizeFiles(
    payload.files ?? payload.ottoauth_files ?? payload.cad_files ?? payload.cadFiles,
  );
  const explicitTask = multilineString(
    payload.task ?? payload.task_prompt ?? payload.taskPrompt ?? payload.request ?? payload.prompt,
    5000,
  );
  const task =
    explicitTask ||
    buildTaskFromFields({
      store,
      merchant,
      orderType,
      pickupLocation,
      shippingAddress,
      items,
      files,
      notes,
    });
  if (!task) {
    throw new Error("Order needs a task, item, file, or enough structured fields to fulfill.");
  }
  if (!explicitTask && !notes && items.length === 0 && files.length === 0) {
    throw new Error(
      "Order needs actionable instructions, at least one item, or at least one file. Store/provider alone is not enough to fulfill.",
    );
  }
  const kind = inferKind(payload, provider);
  const title =
    optionalString(payload.task_title ?? payload.taskTitle ?? payload.title, 160) ||
    (items[0]
      ? `${merchant || store || provider.label}: ${items[0].name}`.slice(0, 160)
      : task.replace(/\s+/g, " ").slice(0, 120));

  return {
    kind,
    store,
    merchant,
    task,
    title,
    orderType,
    storeUrl,
    pickupLocation,
    shippingAddress,
    items,
    files,
    notes,
    raw: payload,
  };
}

function chooseFulfillmentMode(provider: ProviderDefinition): FulfillmentMode {
  if (provider.nativeAvailable && provider.preferredMode !== "legacy_browser") {
    return provider.preferredMode;
  }
  return "human_admin";
}

function initialStatusFor(provider: ProviderDefinition, fulfillmentMode: FulfillmentMode): OrderStatus {
  return fulfillmentMode === "native_api"
    ? "api_ordering"
    : fulfillmentMode === "quote_first_api" && provider.nativeAvailable
      ? "quote_requested"
      : "human_required";
}

function checklistForKind(kind: OrderKind, provider: ProviderDefinition) {
  const common = [
    "Confirm the requested merchant, exact item/service, quantity, and location/address.",
    "Verify final price is within the spend cap before placing the order.",
    "Record the final charge breakdown: goods, shipping/delivery, tax, tips, and fees.",
    "Save receipt, order number, confirmation code, pickup code, tracking, or provider status.",
  ];
  if (kind === "manufacturing_3d_print") {
    return [
      "Download and inspect every CAD file attached to the order.",
      "Request or enter material, color, finish, infill, quantity, and tolerance if missing.",
      "Get a quote from the manufacturing provider before committing spend.",
      "Place the job only after the quote fits the cap or the requester approves the change.",
      "Record manufacturing order id, estimated ship date, tracking, and any DFM warnings.",
    ];
  }
  if (kind === "manufacturing_pcb") {
    return [
      "Download Gerber, BOM, CPL, drawings, or fabrication notes.",
      "Confirm board quantity, layers, dimensions, surface finish, solder mask, stencil, assembly, and shipping speed.",
      "Get and record the fabrication/assembly quote before committing spend.",
      "Do not silently substitute parts; create a clarification if components are unavailable.",
      "Record vendor order id, production status, tracking, and any DFM/DFT warnings.",
    ];
  }
  if (kind === "grocery_delivery" || kind === "restaurant_delivery") {
    return [
      "Confirm delivery versus pickup and the exact store/restaurant location.",
      "Handle substitutions according to the request; ask for clarification when substitution policy is missing and material.",
      "Message shopper/driver through provider UI when necessary and record important replies.",
      "Record ETA, pickup name/code, delivery proof, receipt, tips, and unavailable items.",
    ];
  }
  if (kind === "ride") {
    return [
      "Confirm pickup, destination, passenger details, requested time, and ride class.",
      "Quote the ride before booking and verify it fits the cap.",
      "After booking, record driver/car details, ETA, live status notes, and receipt.",
      "Use provider messaging only for operational pickup coordination.",
    ];
  }
  return provider.id === "manual"
    ? common
    : [`Use ${provider.label}'s native/admin tools when available.`, ...common];
}

function buildHumanPacket(params: {
  provider: ProviderDefinition;
  request: NormalizedOrderRequest;
  maxChargeCents: number | null;
}): HumanFulfillmentPacket {
  return {
    title: params.request.title,
    priority: params.request.kind === "ride" ? "high" : "normal",
    provider_label: params.provider.label,
    kind: params.request.kind,
    fulfillment_goal: params.request.task,
    spend_cap_cents: params.maxChargeCents,
    merchant: params.request.merchant || params.request.store,
    store_url: params.request.storeUrl,
    pickup_location: params.request.pickupLocation,
    shipping_address: params.request.shippingAddress,
    items: params.request.items,
    files: params.request.files,
    checklist: checklistForKind(params.request.kind, params.provider),
    customer_visible_fields: [
      "summary",
      "merchant",
      "receipt_url",
      "receipt_text",
      "order_number",
      "confirmation_code",
      "pickup_code",
      "tracking_number",
      "tracking_url",
      "provider_status",
      "delivery_eta",
    ],
    risk_notes: [
      "Do not exceed the spend cap without approval.",
      "Do not ask chat or the model for raw card numbers or CVV.",
      "If a provider blocks checkout, needs identity verification, or requires unavailable credentials, request clarification instead of guessing.",
    ],
  };
}

export function previewOrderRequest(payload: Record<string, unknown>) {
  const normalized = normalizeOrderRequest(payload);
  const provider = selectProvider(payload);
  const fulfillmentMode = chooseFulfillmentMode(provider);
  const maxChargeCents = normalizeCents(
    payload.max_charge_cents ??
      payload.maxChargeCents ??
      payload.max_spend_cents ??
      payload.maxSpendCents,
  );
  if (hasSpendLimitField(payload) && (maxChargeCents == null || maxChargeCents <= 0)) {
    throw new Error("max_charge_cents must be a positive integer when provided.");
  }
  const pricing = estimateOrderPricing({
    request: normalized,
    provider,
    maxChargeCents,
    currency: normalizeCurrency(payload.currency),
  });
  const humanPacket = buildHumanPacket({
    provider,
    request: normalized,
    maxChargeCents,
  });
  const status = initialStatusFor(provider, fulfillmentMode);
  const requestJson = {
    ...normalized.raw,
    normalized: {
      kind: normalized.kind,
      store: normalized.store,
      merchant: normalized.merchant,
      title: normalized.title,
      task: normalized.task,
      order_type: normalized.orderType,
      store_url: normalized.storeUrl,
      pickup_location: normalized.pickupLocation,
      shipping_address_present: Boolean(normalized.shippingAddress),
    },
    provider_capabilities: provider.capabilities,
    pricing,
  };

  return {
    id: null,
    dry_run: true,
    creates_db_rows: false,
    charges_credits: false,
    queues_human_fulfillment: false,
    would_create_order: true,
    would_queue_human_fulfillment: fulfillmentMode === "human_admin",
    would_route_native_adapter: fulfillmentMode !== "human_admin",
    status,
    kind: normalized.kind,
    fulfillment_mode: fulfillmentMode,
    provider: {
      id: provider.id,
      label: provider.label,
      native_available: provider.nativeAvailable,
      capabilities: provider.capabilities,
    },
    request: requestJson,
    items: normalized.items,
    files: normalized.files,
    pricing,
    human_fulfillment_packet: humanPacket,
    payment: {
      status: "not_charged",
      max_charge_cents: maxChargeCents,
      quoted_total_cents: null,
      authorized_cents: 0,
      captured_cents: 0,
      currency: normalizeCurrency(payload.currency),
    },
  };
}

function mapOrderRow(row: Record<string, unknown>): OttoAuthOrderRecord {
  return {
    id: Number(row.id),
    public_id: String(row.public_id),
    agent_id: Number(row.agent_id ?? 0),
    agent_username_lower: String(row.agent_username_lower || ""),
    human_user_id: Number(row.human_user_id),
    submission_source: String(row.submission_source || "agent") as OttoAuthOrderRecord["submission_source"],
    external_id: row.external_id == null ? null : String(row.external_id),
    idempotency_key: row.idempotency_key == null ? null : String(row.idempotency_key),
    status: String(row.status || "submitted") as OrderStatus,
    fulfillment_mode: String(row.fulfillment_mode || "human_admin") as FulfillmentMode,
    provider_id: String(row.provider_id || "manual"),
    provider_label: String(row.provider_label || "Manual Human Fulfillment"),
    provider_order_id: row.provider_order_id == null ? null : String(row.provider_order_id),
    kind: String(row.kind || "custom_human_task") as OrderKind,
    request_json: String(row.request_json || "{}"),
    normalized_items_json:
      row.normalized_items_json == null ? null : String(row.normalized_items_json),
    quote_json: row.quote_json == null ? null : String(row.quote_json),
    human_packet_json: row.human_packet_json == null ? null : String(row.human_packet_json),
    result_json: row.result_json == null ? null : String(row.result_json),
    payment_status: String(row.payment_status || "unpaid"),
    max_charge_cents:
      row.max_charge_cents == null || row.max_charge_cents === ""
        ? null
        : Number(row.max_charge_cents),
    quoted_total_cents:
      row.quoted_total_cents == null || row.quoted_total_cents === ""
        ? null
        : Number(row.quoted_total_cents),
    authorized_cents: Number(row.authorized_cents ?? 0),
    captured_cents: Number(row.captured_cents ?? 0),
    currency: String(row.currency || "usd"),
    agent_mandate_policy_id:
      row.agent_mandate_policy_id == null || row.agent_mandate_policy_id === ""
        ? null
        : Number(row.agent_mandate_policy_id),
    agent_mandate_revision:
      row.agent_mandate_revision == null || row.agent_mandate_revision === ""
        ? null
        : Number(row.agent_mandate_revision),
    callback_url: row.callback_url == null ? null : String(row.callback_url),
    admin_notes: row.admin_notes == null ? null : String(row.admin_notes),
    claimed_by_admin_email:
      row.claimed_by_admin_email == null ? null : String(row.claimed_by_admin_email),
    claimed_at: row.claimed_at == null ? null : String(row.claimed_at),
    completed_at: row.completed_at == null ? null : String(row.completed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapEventRow(row: Record<string, unknown>): OttoAuthOrderEventRecord {
  return {
    id: Number(row.id),
    order_id: Number(row.order_id),
    type: String(row.type),
    payload_json: row.payload_json == null ? null : String(row.payload_json),
    created_at: String(row.created_at),
  };
}

function publicIdFor(orderId: number) {
  return `ord_${orderId}`;
}

export async function ensureOrderOrchestrationSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = ensureOrderOrchestrationSchemaOnce().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function ensureOrderOrchestrationSchemaOnce() {
  if (schemaReady) return;
  await runSerializedSchemaMigration(ensureOrderOrchestrationSchemaMigration);
}

async function ensureOrderOrchestrationSchemaMigration() {
  if (schemaReady) return;
  const client = getTursoClient();
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ottoauth_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT UNIQUE,
      agent_id INTEGER NOT NULL DEFAULT 0,
      agent_username_lower TEXT NOT NULL DEFAULT '',
      human_user_id INTEGER NOT NULL,
      submission_source TEXT NOT NULL DEFAULT 'agent',
      external_id TEXT,
      idempotency_key TEXT,
      status TEXT NOT NULL,
      fulfillment_mode TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      provider_label TEXT NOT NULL,
      provider_order_id TEXT,
      kind TEXT NOT NULL,
      request_json TEXT NOT NULL,
      normalized_items_json TEXT,
      quote_json TEXT,
      human_packet_json TEXT,
      result_json TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      max_charge_cents INTEGER,
      quoted_total_cents INTEGER,
      authorized_cents INTEGER NOT NULL DEFAULT 0,
      captured_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      agent_mandate_policy_id INTEGER,
      agent_mandate_revision INTEGER,
      callback_url TEXT,
      admin_notes TEXT,
      claimed_by_admin_email TEXT,
      claimed_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  const orderTableInfo = await client.execute({
    sql: "PRAGMA table_info(ottoauth_orders)",
    args: [],
  });
  const orderColumns = (orderTableInfo.rows ?? []) as unknown as { name: string }[];
  if (!orderColumns.some((column) => column.name === "agent_mandate_policy_id")) {
    await client.execute("ALTER TABLE ottoauth_orders ADD COLUMN agent_mandate_policy_id INTEGER");
  }
  if (!orderColumns.some((column) => column.name === "agent_mandate_revision")) {
    await client.execute("ALTER TABLE ottoauth_orders ADD COLUMN agent_mandate_revision INTEGER");
  }
  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ottoauth_orders_agent_idempotency
      ON ottoauth_orders(agent_username_lower, idempotency_key)
      WHERE idempotency_key IS NOT NULL`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_ottoauth_orders_status ON ottoauth_orders(status, updated_at)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_ottoauth_orders_human ON ottoauth_orders(human_user_id, created_at)",
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ottoauth_order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_ottoauth_order_events_order ON ottoauth_order_events(order_id, created_at)",
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ottoauth_order_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      channel TEXT NOT NULL,
      author_type TEXT NOT NULL,
      author_label TEXT,
      body TEXT NOT NULL,
      delivery_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_ottoauth_order_messages_order ON ottoauth_order_messages(order_id, created_at)",
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ottoauth_order_clarifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL,
      response TEXT,
      requested_by TEXT,
      responded_by TEXT,
      created_at TEXT NOT NULL,
      responded_at TEXT
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_ottoauth_order_clarifications_order ON ottoauth_order_clarifications(order_id, created_at)",
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ottoauth_order_disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_resolution TEXT,
      evidence_json TEXT,
      provider_case_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_ottoauth_order_disputes_order ON ottoauth_order_disputes(order_id, created_at)",
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ottoauth_order_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT NOT NULL UNIQUE,
      agent_id INTEGER NOT NULL DEFAULT 0,
      agent_username_lower TEXT NOT NULL DEFAULT '',
      human_user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'order_attachment',
      storage_kind TEXT NOT NULL DEFAULT 'db_blob',
      blob_data BLOB NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_ottoauth_order_files_agent ON ottoauth_order_files(agent_username_lower, created_at)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_ottoauth_order_files_human ON ottoauth_order_files(human_user_id, created_at)",
  );
  schemaReady = true;
}

export async function appendOrderEvent(params: {
  orderId: number;
  type: string;
  payload?: Record<string, unknown> | null;
}) {
  await ensureOrderOrchestrationSchema();
  await getTursoClient().execute({
    sql: `INSERT INTO ottoauth_order_events (order_id, type, payload_json, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [
      params.orderId,
      params.type,
      params.payload ? JSON.stringify(params.payload) : null,
      new Date().toISOString(),
    ],
  });
}

async function loadExistingByIdempotency(params: {
  agentUsernameLower: string;
  idempotencyKey: string | null;
}) {
  if (!params.idempotencyKey) return null;
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT * FROM ottoauth_orders
          WHERE agent_username_lower = ?
            AND idempotency_key = ?
          LIMIT 1`,
    args: [params.agentUsernameLower.trim().toLowerCase(), params.idempotencyKey],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapOrderRow(row) : null;
}

export async function createOrchestratedOrder(params: {
  agentId: number;
  agentUsernameLower: string;
  humanUserId: number;
  submissionSource: "agent" | "human" | "admin";
  payload: Record<string, unknown>;
  maxChargeCents?: number | null;
  priceQuote?: NonBrowserPriceQuote | null;
  callbackUrl?: string | null;
  externalId?: string | null;
  idempotencyKey?: string | null;
  agentMandatePolicyId?: number | null;
  agentMandateRevision?: number | null;
  agentMandateMetadata?: Record<string, unknown> | null;
}) {
  const normalized = normalizeOrderRequest(params.payload);
  const provider = selectProvider(params.payload);
  const fulfillmentMode = chooseFulfillmentMode(provider);
  const maxChargeCents =
    params.maxChargeCents ??
    normalizeCents(
      params.payload.max_charge_cents ??
        params.payload.maxChargeCents ??
        params.payload.max_spend_cents ??
        params.payload.maxSpendCents,
    );
  const existing = await loadExistingByIdempotency({
    agentUsernameLower: params.agentUsernameLower,
    idempotencyKey: params.idempotencyKey ?? null,
  });
  if (existing) {
    return { order: existing, reused: true };
  }

  const humanPacket = buildHumanPacket({
    provider,
    request: normalized,
    maxChargeCents,
  });
  const status = initialStatusFor(provider, fulfillmentMode);
  const now = new Date().toISOString();
  const priceQuote = params.priceQuote ?? null;
  const pricing = estimateOrderPricing({
    request: normalized,
    provider,
    maxChargeCents,
    priceQuote,
    quotedTotalCents: priceQuote?.total_cents ?? null,
    currency: normalizeCurrency(params.payload.currency),
  });
  const requestJson = {
    ...normalized.raw,
    normalized: {
      kind: normalized.kind,
      store: normalized.store,
      merchant: normalized.merchant,
      title: normalized.title,
      task: normalized.task,
      order_type: normalized.orderType,
      store_url: normalized.storeUrl,
      pickup_location: normalized.pickupLocation,
      shipping_address_present: Boolean(normalized.shippingAddress),
    },
    provider_capabilities: provider.capabilities,
    agent_mandate: params.agentMandateMetadata ?? null,
    price_quote: priceQuote,
    pricing,
  };

  await ensureOrderOrchestrationSchema();
  const insertResult = await getTursoClient().execute({
    sql: `INSERT INTO ottoauth_orders
          (public_id, agent_id, agent_username_lower, human_user_id, submission_source,
           external_id, idempotency_key, status, fulfillment_mode, provider_id, provider_label,
           kind, request_json, normalized_items_json, quote_json, human_packet_json, payment_status,
           max_charge_cents, quoted_total_cents, authorized_cents, captured_cents, currency,
           agent_mandate_policy_id, agent_mandate_revision, callback_url,
           created_at, updated_at)
          VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
    args: [
      params.agentId,
      params.agentUsernameLower.trim().toLowerCase(),
      params.humanUserId,
      params.submissionSource,
      params.externalId?.trim() || optionalString(params.payload.external_id ?? params.payload.externalId, 200),
      params.idempotencyKey?.trim() || null,
      status,
      fulfillmentMode,
      provider.id,
      provider.label,
      normalized.kind,
      JSON.stringify(requestJson),
      normalized.items.length ? JSON.stringify(normalized.items) : null,
      priceQuote ? JSON.stringify(priceQuote) : null,
      JSON.stringify(humanPacket),
      maxChargeCents ?? null,
      priceQuote?.total_cents ?? null,
      normalizeCurrency(params.payload.currency),
      params.agentMandatePolicyId ?? null,
      params.agentMandateRevision ?? null,
      params.callbackUrl?.trim() || optionalString(params.payload.callback_url ?? params.payload.callbackUrl, 2000),
      now,
      now,
    ],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  const orderId = rawId != null ? Number(rawId) : 0;
  if (!orderId) throw new Error("Failed to create order.");
  await getTursoClient().execute({
    sql: "UPDATE ottoauth_orders SET public_id = ? WHERE id = ?",
    args: [publicIdFor(orderId), orderId],
  });
  const order = await getOrderById(orderId);
  if (!order) throw new Error("Failed to load created order.");
  await appendOrderEvent({
    orderId,
    type: "order.created",
    payload: {
      status,
      fulfillment_mode: fulfillmentMode,
      provider_id: provider.id,
      native_available: provider.nativeAvailable,
      submission_source: params.submissionSource,
      price_quote: priceQuote
        ? {
            source: priceQuote.source,
            status: priceQuote.status,
            billing_mode: priceQuote.billing_mode,
            total_cents: priceQuote.total_cents,
          }
        : null,
    },
  });
  await appendOrderEvent({
    orderId,
    type: status === "human_required" ? "order.human_required" : "order.routed",
    payload: {
      reason:
        status === "human_required"
          ? "No enabled native API adapter matched this order, so OttoAuth routed it to the human fulfillment queue."
          : "Order routed to provider adapter.",
      provider_capabilities: provider.capabilities,
      pricing,
    },
  });
  void sendAdminOrderSms(order)
    .then((result) => {
      if (result.ok || result.skipped === "status_not_configured" || result.skipped === "missing_recipients") {
        return;
      }
      console.warn(
        `[admin-sms] Order ${order.public_id} SMS notification was not sent: ${
          result.error || result.skipped || "unknown_error"
        }`,
      );
    })
    .catch((error) => {
      console.error(`[admin-sms] Order ${order.public_id} SMS notification failed:`, error);
    });
  return { order, reused: false };
}

export async function getOrderById(id: number) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: "SELECT * FROM ottoauth_orders WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapOrderRow(row) : null;
}

export async function getOrderByPublicIdOrId(value: string) {
  const trimmed = value.trim();
  const numeric = trimmed.startsWith("ord_") ? Number(trimmed.slice(4)) : Number(trimmed);
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: Number.isInteger(numeric) && numeric > 0
      ? "SELECT * FROM ottoauth_orders WHERE id = ? OR public_id = ? LIMIT 1"
      : "SELECT * FROM ottoauth_orders WHERE public_id = ? LIMIT 1",
    args:
      Number.isInteger(numeric) && numeric > 0
        ? [numeric, trimmed]
        : [trimmed],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapOrderRow(row) : null;
}

export async function listOrderEvents(orderId: number, limit = 100) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT * FROM ottoauth_order_events
          WHERE order_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
    args: [orderId, Math.max(1, Math.min(limit, 500))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapEventRow).reverse();
}

export async function listOrdersForAgent(agentUsernameLower: string, limit = 50) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT * FROM ottoauth_orders
          WHERE agent_username_lower = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [agentUsernameLower.trim().toLowerCase(), Math.max(1, Math.min(limit, 200))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapOrderRow);
}

export async function listOrdersForHuman(humanUserId: number, limit = 100) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT * FROM ottoauth_orders
          WHERE human_user_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [humanUserId, Math.max(1, Math.min(limit, 300))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapOrderRow);
}

export async function listOrderSpendTotalsForHuman(humanUserId: number) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT agent_id, COALESCE(SUM(captured_cents), 0) AS total_spent_cents
          FROM ottoauth_orders
          WHERE human_user_id = ?
            AND payment_status = 'captured'
            AND captured_cents > 0
          GROUP BY agent_id`,
    args: [humanUserId],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map((row) => ({
    agent_id: Number(row.agent_id),
    total_spent_cents: Number(row.total_spent_cents ?? 0),
  }));
}

export async function listOrdersForAdmin(limit = 200) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT * FROM ottoauth_orders
          ORDER BY
            CASE status
              WHEN 'human_required' THEN 0
              WHEN 'blocked' THEN 1
              WHEN 'human_claimed' THEN 2
              WHEN 'quote_requested' THEN 3
              ELSE 4
            END,
            updated_at DESC
          LIMIT ?`,
    args: [Math.max(1, Math.min(limit, 500))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapOrderRow);
}

export async function claimOrderForAdmin(params: {
  orderId: number;
  adminEmail: string;
}) {
  const existing = await getOrderById(params.orderId);
  if (!existing) throw new Error("Order not found.");
  if (["completed", "failed", "canceled"].includes(existing.status)) {
    throw new Error("Final orders cannot be claimed.");
  }
  const now = new Date().toISOString();
  await getTursoClient().execute({
    sql: `UPDATE ottoauth_orders
          SET status = 'human_claimed',
              claimed_by_admin_email = ?,
              claimed_at = COALESCE(claimed_at, ?),
              updated_at = ?
          WHERE id = ?`,
    args: [params.adminEmail.trim().toLowerCase(), now, now, existing.id],
  });
  await appendOrderEvent({
    orderId: existing.id,
    type: "order.human_claimed",
    payload: { admin_email: params.adminEmail.trim().toLowerCase() },
  });
  return getOrderById(existing.id);
}

function buildManualResult(params: {
  merchant?: string | null;
  summary?: string | null;
  receiptUrl?: string | null;
  receiptText?: string | null;
  orderNumber?: string | null;
  confirmationCode?: string | null;
  pickupCode?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  providerStatus?: string | null;
  deliveryEta?: string | null;
  note?: string | null;
  totals: {
    currency: string;
    goods_cents: number;
    shipping_cents: number;
    tax_cents: number;
    other_cents: number;
    total_cents: number;
  };
}) {
  return {
    manual_admin_fulfillment: true,
    merchant: params.merchant || null,
    summary: params.summary || null,
    receipt: {
      url: params.receiptUrl || null,
      text: params.receiptText || null,
    },
    pickup: {
      order_number: params.orderNumber || null,
      confirmation_code: params.confirmationCode || null,
      pickup_code: params.pickupCode || null,
    },
    tracking: {
      tracking_number: params.trackingNumber || null,
      tracking_url: params.trackingUrl || null,
      provider_status: params.providerStatus || null,
      delivery_eta: params.deliveryEta || null,
    },
    charges: params.totals,
    admin_note: params.note || null,
  };
}

export async function completeOrderManually(params: {
  orderId: number;
  adminEmail: string;
  status: "completed" | "failed";
  merchant?: string | null;
  summary?: string | null;
  error?: string | null;
  currency?: string | null;
  goodsCents?: number | null;
  shippingCents?: number | null;
  taxCents?: number | null;
  otherCents?: number | null;
  receiptUrl?: string | null;
  receiptText?: string | null;
  orderNumber?: string | null;
  confirmationCode?: string | null;
  pickupCode?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  providerStatus?: string | null;
  deliveryEta?: string | null;
  note?: string | null;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Order not found.");
  if (order.status === "completed" || order.status === "canceled") {
    throw new Error("This order is already final.");
  }
  const currency = normalizeCurrency(params.currency || order.currency);
  const goodsCents = Math.max(0, Math.trunc(params.goodsCents ?? 0));
  const shippingCents = Math.max(0, Math.trunc(params.shippingCents ?? 0));
  const taxCents = Math.max(0, Math.trunc(params.taxCents ?? 0));
  const otherCents = Math.max(0, Math.trunc(params.otherCents ?? 0));
  const totalCents = goodsCents + shippingCents + taxCents + otherCents;

  if (params.status === "completed") {
    if (!params.summary && !params.orderNumber && !params.confirmationCode && !params.pickupCode && !params.trackingNumber && !params.receiptUrl && !params.receiptText) {
      throw new Error("Completed manual orders need a summary, order number, pickup code, tracking, or receipt detail.");
    }
    if (order.max_charge_cents != null && totalCents > order.max_charge_cents) {
      throw new Error(`Final total exceeds the spend cap (${order.max_charge_cents} cents). Request approval before completing.`);
    }
    if (order.captured_cents <= 0 && totalCents > 0) {
      const balance = await getHumanCreditBalance(order.human_user_id);
      if (balance < totalCents) {
        throw new Error(`Requester has ${balance} credits, but this completion needs ${totalCents}.`);
      }
      await addCreditLedgerEntry({
        humanUserId: order.human_user_id,
        amountCents: -totalCents,
        entryType: "order_debit",
        description: params.summary || `Order ${order.public_id} manually fulfilled`,
        referenceType: "ottoauth_order",
        referenceId: order.public_id,
        metadata: {
          admin_email: params.adminEmail.trim().toLowerCase(),
          provider_id: order.provider_id,
          merchant: params.merchant || null,
          goods_cents: goodsCents,
          shipping_cents: shippingCents,
          tax_cents: taxCents,
          other_cents: otherCents,
        },
      });
    }
  }

  const now = new Date().toISOString();
  const result = buildManualResult({
    merchant: params.merchant,
    summary: params.summary,
    receiptUrl: params.receiptUrl,
    receiptText: params.receiptText,
    orderNumber: params.orderNumber,
    confirmationCode: params.confirmationCode,
    pickupCode: params.pickupCode,
    trackingNumber: params.trackingNumber,
    trackingUrl: params.trackingUrl,
    providerStatus: params.providerStatus,
    deliveryEta: params.deliveryEta,
    note: params.note,
    totals: {
      currency,
      goods_cents: goodsCents,
      shipping_cents: shippingCents,
      tax_cents: taxCents,
      other_cents: otherCents,
      total_cents: totalCents,
    },
  });
  await getTursoClient().execute({
    sql: `UPDATE ottoauth_orders
          SET status = ?,
              result_json = ?,
              captured_cents = ?,
              currency = ?,
              payment_status = ?,
              admin_notes = ?,
              claimed_by_admin_email = COALESCE(claimed_by_admin_email, ?),
              claimed_at = COALESCE(claimed_at, ?),
              completed_at = ?,
              updated_at = ?
          WHERE id = ?`,
    args: [
      params.status,
      JSON.stringify({
        ...result,
        error: params.status === "failed" ? params.error || params.summary || "Manual fulfillment failed." : null,
      }),
      params.status === "completed" ? totalCents : order.captured_cents,
      currency,
      params.status === "completed" && totalCents > 0 ? "captured" : order.payment_status,
      params.note || order.admin_notes,
      params.adminEmail.trim().toLowerCase(),
      now,
      now,
      now,
      order.id,
    ],
  });
  await appendOrderEvent({
    orderId: order.id,
    type: params.status === "completed" ? "order.completed" : "order.failed",
    payload: {
      manual_admin_fulfillment: true,
      admin_email: params.adminEmail.trim().toLowerCase(),
      captured_cents: params.status === "completed" ? totalCents : 0,
    },
  });
  return getOrderById(order.id);
}

export async function cancelOrder(params: {
  orderId: number;
  reason: string;
  actor: string;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Order not found.");
  if (order.status === "completed") throw new Error("Completed orders cannot be canceled.");
  const now = new Date().toISOString();
  await getTursoClient().execute({
    sql: `UPDATE ottoauth_orders
          SET status = 'canceled',
              result_json = ?,
              completed_at = ?,
              updated_at = ?
          WHERE id = ?`,
    args: [
      JSON.stringify({ canceled: true, reason: params.reason, actor: params.actor }),
      now,
      now,
      order.id,
    ],
  });
  await appendOrderEvent({
    orderId: order.id,
    type: "order.canceled",
    payload: { reason: params.reason, actor: params.actor },
  });
  return getOrderById(order.id);
}

export async function createOrderMessage(params: {
  orderId: number;
  channel: string;
  authorType: string;
  authorLabel?: string | null;
  body: string;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Order not found.");
  const provider = PROVIDERS.find((entry) => entry.id === order.provider_id) ?? PROVIDERS[PROVIDERS.length - 1];
  const nativeMessaging = provider.nativeAvailable && provider.capabilities.messaging;
  const deliveryMode =
    params.channel === "requester" || params.channel === "human_operator"
      ? "internal"
      : nativeMessaging
        ? "native_api"
        : "human_admin";
  const status = nativeMessaging || deliveryMode === "internal"
    ? "recorded"
    : "needs_human_delivery";
  const now = new Date().toISOString();
  const result = await getTursoClient().execute({
    sql: `INSERT INTO ottoauth_order_messages
          (order_id, channel, author_type, author_label, body, delivery_mode, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      order.id,
      params.channel.trim(),
      params.authorType.trim(),
      params.authorLabel?.trim() || null,
      params.body.trim().slice(0, 4000),
      deliveryMode,
      status,
      now,
    ],
  });
  await appendOrderEvent({
    orderId: order.id,
    type: "order.message.created",
    payload: { channel: params.channel, delivery_mode: deliveryMode, status },
  });
  const rawId = (result as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  return { id: rawId != null ? Number(rawId) : null, deliveryMode, status };
}

export async function listOrderMessages(orderId: number) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT * FROM ottoauth_order_messages
          WHERE order_id = ?
          ORDER BY created_at ASC, id ASC`,
    args: [orderId],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    order_id: Number(row.order_id),
    channel: String(row.channel),
    author_type: String(row.author_type),
    author_label: row.author_label == null ? null : String(row.author_label),
    body: String(row.body),
    delivery_mode: String(row.delivery_mode) as OttoAuthOrderMessageRecord["delivery_mode"],
    status: String(row.status),
    created_at: String(row.created_at),
  }));
}

export async function listOrderClarifications(orderId: number) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT * FROM ottoauth_order_clarifications
          WHERE order_id = ?
          ORDER BY created_at ASC, id ASC`,
    args: [orderId],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    order_id: Number(row.order_id),
    question: String(row.question),
    status: String(row.status) as OttoAuthOrderClarificationRecord["status"],
    response: row.response == null ? null : String(row.response),
    requested_by: row.requested_by == null ? null : String(row.requested_by),
    responded_by: row.responded_by == null ? null : String(row.responded_by),
    created_at: String(row.created_at),
    responded_at: row.responded_at == null ? null : String(row.responded_at),
  }));
}

export async function createOrderClarification(params: {
  orderId: number;
  question: string;
  requestedBy?: string | null;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Order not found.");
  const now = new Date().toISOString();
  const insert = await getTursoClient().execute({
    sql: `INSERT INTO ottoauth_order_clarifications
          (order_id, question, status, response, requested_by, responded_by, created_at, responded_at)
          VALUES (?, ?, 'open', NULL, ?, NULL, ?, NULL)`,
    args: [order.id, params.question.trim().slice(0, 2000), params.requestedBy?.trim() || null, now],
  });
  await getTursoClient().execute({
    sql: "UPDATE ottoauth_orders SET status = 'blocked', updated_at = ? WHERE id = ?",
    args: [now, order.id],
  });
  await appendOrderEvent({
    orderId: order.id,
    type: "order.clarification.requested",
    payload: { requested_by: params.requestedBy || null, question: params.question },
  });
  const rawId = (insert as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  return { id: rawId != null ? Number(rawId) : null };
}

export async function respondToOrderClarification(params: {
  orderId: number;
  clarificationId?: number | null;
  response: string;
  respondedBy?: string | null;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Order not found.");
  const now = new Date().toISOString();
  const target = params.clarificationId
    ? await getTursoClient().execute({
        sql: `SELECT id FROM ottoauth_order_clarifications
              WHERE order_id = ? AND id = ? AND status = 'open'
              LIMIT 1`,
        args: [order.id, params.clarificationId],
      })
    : await getTursoClient().execute({
        sql: `SELECT id FROM ottoauth_order_clarifications
              WHERE order_id = ? AND status = 'open'
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
        args: [order.id],
      });
  const row = target.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Open clarification not found.");
  const clarificationId = Number(row.id);
  await getTursoClient().execute({
    sql: `UPDATE ottoauth_order_clarifications
          SET status = 'answered',
              response = ?,
              responded_by = ?,
              responded_at = ?
          WHERE id = ?`,
    args: [
      params.response.trim().slice(0, 4000),
      params.respondedBy?.trim() || null,
      now,
      clarificationId,
    ],
  });
  await getTursoClient().execute({
    sql: `UPDATE ottoauth_orders
          SET status = CASE WHEN status = 'blocked' THEN 'human_required' ELSE status END,
              updated_at = ?
          WHERE id = ?`,
    args: [now, order.id],
  });
  await appendOrderEvent({
    orderId: order.id,
    type: "order.clarification.answered",
    payload: { clarification_id: clarificationId, responded_by: params.respondedBy || null },
  });
  return getOrderById(order.id);
}

export async function createOrderDispute(params: {
  orderId: number;
  reason: string;
  requestedResolution?: string | null;
  evidence?: unknown;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Order not found.");
  const now = new Date().toISOString();
  const insert = await getTursoClient().execute({
    sql: `INSERT INTO ottoauth_order_disputes
          (order_id, reason, status, requested_resolution, evidence_json, provider_case_id, created_at, updated_at)
          VALUES (?, ?, 'open', ?, ?, NULL, ?, ?)`,
    args: [
      order.id,
      params.reason.trim().slice(0, 200),
      params.requestedResolution?.trim().slice(0, 1000) || null,
      params.evidence == null ? null : JSON.stringify(params.evidence),
      now,
      now,
    ],
  });
  await getTursoClient().execute({
    sql: "UPDATE ottoauth_orders SET status = 'disputed', updated_at = ? WHERE id = ?",
    args: [now, order.id],
  });
  await appendOrderEvent({
    orderId: order.id,
    type: "order.dispute.opened",
    payload: { reason: params.reason, requested_resolution: params.requestedResolution || null },
  });
  const rawId = (insert as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  return { id: rawId != null ? Number(rawId) : null };
}

export async function approveOrder(params: {
  orderId: number;
  actor: string;
}) {
  const order = await getOrderById(params.orderId);
  if (!order) throw new Error("Order not found.");
  const nextStatus: OrderStatus =
    order.fulfillment_mode === "human_admin" ? "human_required" : "ready_to_fulfill";
  const now = new Date().toISOString();
  await getTursoClient().execute({
    sql: "UPDATE ottoauth_orders SET status = ?, updated_at = ? WHERE id = ?",
    args: [nextStatus, now, order.id],
  });
  await appendOrderEvent({
    orderId: order.id,
    type: "order.approved",
    payload: { actor: params.actor, next_status: nextStatus },
  });
  return getOrderById(order.id);
}

function binaryFromDb(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new Uint8Array();
}

function mapFileRow(row: Record<string, unknown>): OttoAuthOrderFileRecord {
  return {
    id: Number(row.id),
    file_id: String(row.file_id),
    agent_id: Number(row.agent_id ?? 0),
    agent_username_lower: String(row.agent_username_lower || ""),
    human_user_id: Number(row.human_user_id),
    filename: String(row.filename || "attachment"),
    content_type: String(row.content_type || "application/octet-stream"),
    size_bytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256 || ""),
    purpose: String(row.purpose || "order_attachment"),
    storage_kind: "db_blob",
    blob_data: binaryFromDb(row.blob_data),
    metadata_json: row.metadata_json == null ? null : String(row.metadata_json),
    created_at: String(row.created_at),
  };
}

export async function createOrderFileUpload(params: {
  agentId: number;
  agentUsernameLower: string;
  humanUserId: number;
  filename: string;
  contentType?: string | null;
  bytes: Uint8Array;
  purpose?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await ensureOrderOrchestrationSchema();
  if (params.bytes.byteLength <= 0) throw new Error("Uploaded file is empty.");
  const maxBytes = 20 * 1024 * 1024;
  if (params.bytes.byteLength > maxBytes) {
    throw new Error("Uploaded files are limited to 20 MB each. Use an external file URL for larger CAD packages.");
  }
  const safeName =
    optionalString(params.filename, 240)?.replace(/[^\w.\-()[\] ]+/g, "_") || "attachment";
  const contentType = optionalString(params.contentType, 200) || "application/octet-stream";
  const fileId = `file_${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  const sha256 = createHash("sha256").update(params.bytes).digest("hex");
  await getTursoClient().execute({
    sql: `INSERT INTO ottoauth_order_files
          (file_id, agent_id, agent_username_lower, human_user_id, filename, content_type,
           size_bytes, sha256, purpose, storage_kind, blob_data, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'db_blob', ?, ?, ?)`,
    args: [
      fileId,
      params.agentId,
      params.agentUsernameLower.trim().toLowerCase(),
      params.humanUserId,
      safeName,
      contentType,
      params.bytes.byteLength,
      sha256,
      optionalString(params.purpose, 120) || "order_attachment",
      params.bytes,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now,
    ],
  });
  return getOrderFileByPublicId(fileId);
}

export async function getOrderFileByPublicId(fileId: string) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: "SELECT * FROM ottoauth_order_files WHERE file_id = ? LIMIT 1",
    args: [fileId.trim()],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapFileRow(row) : null;
}

export function parseOrderFileForApi(file: OttoAuthOrderFileRecord, baseUrl?: string) {
  const path = `/api/services/order/files/${file.file_id}`;
  return {
    file_id: file.file_id,
    name: file.filename,
    filename: file.filename,
    content_type: file.content_type,
    size_bytes: file.size_bytes,
    sha256: file.sha256,
    purpose: file.purpose,
    source: "ottoauth_upload",
    download_url: baseUrl ? `${baseUrl}${path}` : path,
    url: baseUrl ? `${baseUrl}${path}` : path,
    metadata: parseJsonObject(file.metadata_json),
    created_at: file.created_at,
  };
}

export function parseOrderForApi(order: OttoAuthOrderRecord) {
  const provider =
    PROVIDERS.find((entry) => entry.id === order.provider_id) ||
    PROVIDERS.find((entry) => entry.id === "manual")!;
  const request = optionalRecord(parseJsonObject(order.request_json)) ?? {};
  let normalizedForPricing: NormalizedOrderRequest;
  try {
    normalizedForPricing = normalizeOrderRequest(request);
  } catch {
    normalizedForPricing = {
      kind: order.kind,
      store: order.provider_id,
      merchant: order.provider_label,
      task: order.public_id,
      title: order.public_id,
      orderType: null,
      storeUrl: null,
      pickupLocation: null,
      shippingAddress: null,
      items: [],
      files: [],
      notes: null,
      raw: request,
    };
  }
  const pricing = estimateOrderPricing({
    request: normalizedForPricing,
    provider,
    maxChargeCents: order.max_charge_cents,
    priceQuote: optionalRecord(parseJsonObject(order.quote_json)) as NonBrowserPriceQuote | null,
    quotedTotalCents: order.quoted_total_cents,
    capturedCents: order.captured_cents,
    currency: order.currency,
  });
  return {
    id: order.public_id,
    numeric_id: order.id,
    status: order.status,
    kind: order.kind,
    fulfillment_mode: order.fulfillment_mode,
    provider: {
      id: order.provider_id,
      label: order.provider_label,
      native_available: provider?.nativeAvailable ?? order.fulfillment_mode !== "human_admin",
      capabilities: provider?.capabilities ?? DEFAULT_CAPABILITIES,
    },
    request,
    items: order.normalized_items_json ? parseJsonObject(order.normalized_items_json) : [],
    quote: order.quote_json ? parseJsonObject(order.quote_json) : null,
    pricing,
    human_fulfillment_packet: order.human_packet_json ? parseJsonObject(order.human_packet_json) : null,
    result: order.result_json ? parseJsonObject(order.result_json) : null,
    payment: {
      status: order.payment_status,
      max_charge_cents: order.max_charge_cents,
      quoted_total_cents: order.quoted_total_cents,
      authorized_cents: order.authorized_cents,
      captured_cents: order.captured_cents,
      currency: order.currency,
    },
    agent_mandate: {
      policy_id: order.agent_mandate_policy_id,
      revision: order.agent_mandate_revision,
      evaluation:
        request.agent_mandate && typeof request.agent_mandate === "object"
          ? request.agent_mandate
          : null,
    },
    external_id: order.external_id,
    idempotency_key: order.idempotency_key,
    callback_url: order.callback_url,
    claimed_by_admin_email: order.claimed_by_admin_email,
    claimed_at: order.claimed_at,
    created_at: order.created_at,
    updated_at: order.updated_at,
    completed_at: order.completed_at,
  };
}

export async function getProviderCatalog() {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    default_kind: provider.defaultKind,
    preferred_mode: provider.preferredMode,
    native_available: provider.nativeAvailable,
    aliases: provider.aliases,
    capabilities: provider.capabilities,
  }));
}

export function randomOrderExternalId() {
  return `req_${randomUUID()}`;
}
