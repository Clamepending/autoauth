import { commerceEnv } from "@/lib/commerce-adapter-config";
import type { CommerceRoutePlan } from "@/lib/commerce-router";
import type { NormalizedPurchaseRequest } from "@/lib/purchase-request";

export type CommerceApiCheckoutResult = {
  status: "completed" | "failed";
  result: Record<string, unknown>;
  error: string | null;
};

type CommerceApiCheckoutInput = {
  payload: Record<string, unknown>;
  purchaseRequest: NormalizedPurchaseRequest;
  routePlan: CommerceRoutePlan;
  maxChargeCents: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(source: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function booleanField(
  source: Record<string, unknown> | null | undefined,
  fallback: boolean,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return fallback;
}

function numberField(source: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function listOfRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(record(item)))
    : [];
}

function apiCheckout(payload: Record<string, unknown>) {
  return (
    record(payload.api_checkout) ||
    record(payload.apiCheckout) ||
    record(payload.vendor_api) ||
    record(payload.vendorApi) ||
    {}
  );
}

function apiItems(payload: Record<string, unknown>, checkout: Record<string, unknown>) {
  return [
    ...listOfRecords(checkout.items),
    ...listOfRecords(checkout.parts),
    ...listOfRecords(checkout.line_items),
    ...listOfRecords(payload.items),
    ...listOfRecords(payload.parts),
    ...listOfRecords(payload.line_items),
  ];
}

function centsFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  return 0;
}

function readNested(source: Record<string, unknown>, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    const currentRecord = record(current);
    if (!currentRecord) return null;
    current = currentRecord[key];
  }
  return current;
}

function extractFirstCents(source: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    const cents = centsFromUnknown(readNested(source, path));
    if (cents > 0) return cents;
  }
  return 0;
}

function fail(adapterId: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    status: "failed" as const,
    result: {
      merchant: adapterId,
      summary: message,
      commerce_api: {
        adapter_id: adapterId,
        ok: false,
        ...extra,
      },
    },
    error: message,
  };
}

function completed(params: {
  adapterId: string;
  summary: string;
  merchant: string;
  currency?: string;
  goodsCents?: number;
  shippingCents?: number;
  taxCents?: number;
  otherCents?: number;
  raw: unknown;
  extra?: Record<string, unknown>;
}) {
  return {
    status: "completed" as const,
    result: {
      merchant: params.merchant,
      summary: params.summary,
      charges: {
        merchant: params.merchant,
        currency: params.currency || "usd",
        goods_cents: params.goodsCents ?? 0,
        shipping_cents: params.shippingCents ?? 0,
        tax_cents: params.taxCents ?? 0,
        other_cents: params.otherCents ?? 0,
      },
      commerce_api: {
        adapter_id: params.adapterId,
        ok: true,
        raw: params.raw,
        ...params.extra,
      },
    },
    error: null,
  };
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw_text: text };
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const data = await parseResponse(response);
  return { response, data };
}

function withApiKey(url: string, apiKey: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("apiKey", apiKey);
  return parsed.toString();
}

function mouserEndpoint(path: string) {
  const base = commerceEnv("OTTOAUTH_MOUSER_API_BASE_URL", "https://api.mouser.com/api/v1.0");
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function extractMouserCartKey(data: unknown) {
  const source = record(data);
  if (!source) return null;
  return (
    stringField(source, "CartKey", "cartKey") ||
    (record(source.Cart) ? stringField(record(source.Cart), "CartKey", "cartKey") : null)
  );
}

async function executeMouser(params: CommerceApiCheckoutInput) {
  const adapterId = "api.mouser";
  const apiKey = commerceEnv("OTTOAUTH_MOUSER_API_KEY") || commerceEnv("MOUSER_API_KEY");
  if (!apiKey) return fail(adapterId, "Mouser API key is not configured.");

  const checkout = apiCheckout(params.payload);
  const submitOrder = booleanField(checkout, true, "submit_order", "submitOrder");
  const nativeOrderRequest =
    record(checkout.native_order_request) ||
    record(checkout.order_request) ||
    record(checkout.orderRequest);
  const items = apiItems(params.payload, checkout);
  let cartKey = stringField(checkout, "cart_key", "cartKey");
  let cartResponse: unknown = null;

  if (!nativeOrderRequest && !cartKey) {
    if (items.length === 0) {
      return fail(
        adapterId,
        "Mouser API checkout needs api_checkout.order_request, api_checkout.cart_key, or Mouser part-number items.",
      );
    }
    const cartBody =
      record(checkout.native_cart_request) ||
      record(checkout.cart_request) ||
      {
        CartKey: "",
        CountryCode: stringField(checkout, "country_code", "countryCode") || "US",
        CurrencyCode: stringField(checkout, "currency_code", "currencyCode") || "USD",
        CartItems: items.map((item) => ({
          MouserPartNumber:
            stringField(item, "mouser_part_number", "mouserPartNumber", "part_number", "partNumber") ||
            "",
          Quantity: numberField(item, "quantity", "qty") ?? 1,
        })),
      };
    const { response, data } = await postJson(
      withApiKey(mouserEndpoint("/cart/items/insert"), apiKey),
      cartBody,
    );
    cartResponse = data;
    if (!response.ok) {
      return fail(adapterId, "Mouser cart creation failed.", {
        http_status: response.status,
        raw: data,
      });
    }
    cartKey = extractMouserCartKey(data);
  }

  const orderBody =
    nativeOrderRequest ||
    {
      CartKey: cartKey,
      CurrencyCode: stringField(checkout, "currency_code", "currencyCode") || "USD",
      OrderType: stringField(checkout, "order_type", "orderType") || "Rush",
      ShippingMethod: numberField(checkout, "shipping_method_code", "shippingMethodCode"),
      PaymentMethod: numberField(checkout, "payment_method_code", "paymentMethodCode"),
      CardLastFour: stringField(checkout, "card_last_four", "cardLastFour"),
      SubmitOrder: submitOrder,
    };
  const mergedOrderBody = {
    ...orderBody,
    SubmitOrder: booleanField(orderBody, submitOrder, "SubmitOrder", "submitOrder", "submit_order"),
  };
  const { response, data } = await postJson(
    withApiKey(mouserEndpoint("/order"), apiKey),
    mergedOrderBody,
  );
  if (!response.ok) {
    return fail(adapterId, "Mouser order submission failed.", {
      http_status: response.status,
      cart_key: cartKey,
      cart_response: cartResponse,
      raw: data,
    });
  }

  const raw = record(data) ?? { raw: data };
  const goodsCents = extractFirstCents(raw, [
    ["OrderTotal"],
    ["orderTotal"],
    ["Total"],
    ["total"],
    ["Summary", "OrderTotal"],
    ["OrderSummary", "Total"],
  ]);
  return completed({
    adapterId,
    merchant: "mouser",
    summary: submitOrder ? "Mouser API order submitted." : "Mouser API order preview returned.",
    currency: stringField(checkout, "currency_code", "currencyCode") || "usd",
    goodsCents: submitOrder ? goodsCents : 0,
    raw: data,
    extra: {
      submit_order: submitOrder,
      cart_key: cartKey,
      cart_response: cartResponse,
    },
  });
}

function digikeyEndpoint(path: string) {
  const base = commerceEnv("OTTOAUTH_DIGIKEY_API_BASE_URL", "https://api.digikey.com");
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

async function executeDigiKey(params: CommerceApiCheckoutInput) {
  const adapterId = "api.digikey";
  const accessToken =
    commerceEnv("OTTOAUTH_DIGIKEY_ACCESS_TOKEN") || commerceEnv("DIGIKEY_ACCESS_TOKEN");
  const clientId = commerceEnv("OTTOAUTH_DIGIKEY_CLIENT_ID") || commerceEnv("DIGIKEY_CLIENT_ID");
  if (!accessToken || !clientId) {
    return fail(adapterId, "DigiKey API checkout needs OTTOAUTH_DIGIKEY_ACCESS_TOKEN and OTTOAUTH_DIGIKEY_CLIENT_ID.");
  }

  const checkout = apiCheckout(params.payload);
  const nativeOrderRequest =
    record(checkout.native_order_request) ||
    record(checkout.order_request) ||
    record(checkout.orderRequest);
  const endpointPath = stringField(
    checkout,
    "native_endpoint_path",
    "endpoint_path",
    "endpointPath",
  );
  if (!nativeOrderRequest || !endpointPath) {
    return fail(
      adapterId,
      "DigiKey ordering is OAuth-gated; provide api_checkout.native_endpoint_path and api_checkout.native_order_request.",
    );
  }

  const { response, data } = await postJson(digikeyEndpoint(endpointPath), nativeOrderRequest, {
    authorization: `Bearer ${accessToken}`,
    "X-DIGIKEY-Client-Id": clientId,
    "X-DIGIKEY-Locale-Site": stringField(checkout, "locale_site", "localeSite") || "US",
    "X-DIGIKEY-Locale-Language": stringField(checkout, "locale_language", "localeLanguage") || "en",
    "X-DIGIKEY-Locale-Currency": stringField(checkout, "locale_currency", "localeCurrency") || "USD",
  });
  if (!response.ok) {
    return fail(adapterId, "DigiKey API order submission failed.", {
      http_status: response.status,
      raw: data,
    });
  }
  const raw = record(data) ?? { raw: data };
  const goodsCents = extractFirstCents(raw, [
    ["OrderTotal"],
    ["Total"],
    ["total"],
    ["SalesOrder", "Total"],
  ]);
  return completed({
    adapterId,
    merchant: "digikey",
    summary: "DigiKey API order submitted.",
    currency: stringField(checkout, "locale_currency", "localeCurrency") || "usd",
    goodsCents,
    raw: data,
    extra: { endpoint_path: endpointPath },
  });
}

function treatstockEndpoint(path: string) {
  const base = commerceEnv("OTTOAUTH_TREATSTOCK_API_BASE_URL", "https://www.treatstock.com/api/v2");
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function appendPrivateKey(url: string, privateKey: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("private-key", privateKey);
  return parsed.toString();
}

function modelUrls(payload: Record<string, unknown>, checkout: Record<string, unknown>) {
  const raw =
    checkout.model_urls ||
    checkout.modelUrls ||
    checkout.file_urls ||
    checkout.fileUrls ||
    payload.model_urls ||
    payload.modelUrls ||
    payload.file_urls ||
    payload.fileUrls;
  return Array.isArray(raw)
    ? raw
        .filter((url): url is string => typeof url === "string" && Boolean(url.trim()))
        .map((url) => url.trim())
    : [];
}

async function readTreatstockCosts(printablePackId: string, privateKey: string, checkout: Record<string, unknown>) {
  const parsed = new URL(appendPrivateKey(treatstockEndpoint("/printable-pack-costs/"), privateKey));
  parsed.searchParams.set("printablePackId", printablePackId);
  const country = stringField(checkout, "country", "shipping_country", "shippingCountry");
  if (country) parsed.searchParams.set("location[country]", country);
  const material = stringField(checkout, "material_group", "materialGroup", "printerMaterialGroup");
  if (material) parsed.searchParams.set("printerMaterialGroup", material);
  const color = stringField(checkout, "color", "printerColor");
  if (color) parsed.searchParams.set("printerColor", color);

  let lastData: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(parsed.toString(), { headers: { accept: "application/json" } });
    const data = await parseResponse(response);
    lastData = data;
    if (response.ok && !(record(data)?.reason === "not_calculated_yet")) return data;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return lastData;
}

function chooseTreatstockProvider(costs: unknown, checkout: Record<string, unknown>) {
  const explicit = stringField(checkout, "provider_id", "providerId");
  if (explicit) return { providerId: explicit, priceCents: 0, selected: null as unknown };
  const candidates = Array.isArray(costs) ? costs.filter(record) : [];
  const selected = candidates
    .map((candidate) => ({
      candidate,
      priceCents: centsFromUnknown(candidate.price),
      providerId:
        stringField(candidate, "providerId", "provider_id", "printerId", "printer_id", "id") ||
        null,
    }))
    .filter((candidate) => candidate.providerId && candidate.priceCents > 0)
    .sort((a, b) => a.priceCents - b.priceCents)[0];
  return {
    providerId: selected?.providerId ?? null,
    priceCents: selected?.priceCents ?? 0,
    selected: selected?.candidate ?? null,
  };
}

async function executeTreatstock(params: CommerceApiCheckoutInput) {
  const adapterId = "api.treatstock";
  const privateKey =
    commerceEnv("OTTOAUTH_TREATSTOCK_PRIVATE_KEY") || commerceEnv("TREATSTOCK_PRIVATE_KEY");
  if (!privateKey) return fail(adapterId, "Treatstock private API key is not configured.");

  const checkout = apiCheckout(params.payload);
  let printablePackId = stringField(checkout, "printable_pack_id", "printablePackId");
  let uploadResponse: unknown = null;
  if (!printablePackId) {
    const urls = modelUrls(params.payload, checkout);
    if (urls.length === 0) {
      return fail(adapterId, "Treatstock API checkout needs model_urls or printable_pack_id.");
    }
    const form = new FormData();
    for (const url of urls) form.append("files-urls[]", url);
    const country = stringField(checkout, "country", "shipping_country", "shippingCountry") || "US";
    form.append("location[country]", country);
    const description = stringField(checkout, "description", "comment") || params.purchaseRequest.taskTitle;
    if (description) form.append("description", description);
    const response = await fetch(appendPrivateKey(treatstockEndpoint("/printable-packs/"), privateKey), {
      method: "POST",
      body: form,
      headers: { accept: "application/json" },
    });
    uploadResponse = await parseResponse(response);
    if (!response.ok || record(uploadResponse)?.success === false) {
      return fail(adapterId, "Treatstock printable-pack upload failed.", {
        http_status: response.status,
        raw: uploadResponse,
      });
    }
    printablePackId = String(record(uploadResponse)?.id || "");
  }
  if (!printablePackId) return fail(adapterId, "Treatstock did not return printablePackId.");

  const costs = await readTreatstockCosts(printablePackId, privateKey, checkout);
  const provider = chooseTreatstockProvider(costs, checkout);
  if (!provider.providerId) {
    return fail(adapterId, "Treatstock did not return a selectable provider.", {
      printable_pack_id: printablePackId,
      costs,
      upload_response: uploadResponse,
    });
  }
  if (provider.priceCents > params.maxChargeCents) {
    return fail(adapterId, "Treatstock quote exceeds the OttoAuth spend cap.", {
      printable_pack_id: printablePackId,
      provider,
      max_charge_cents: params.maxChargeCents,
    });
  }

  const submitOrder = booleanField(checkout, true, "submit_order", "submitOrder");
  if (!submitOrder) {
    return completed({
      adapterId,
      merchant: "treatstock",
      summary: "Treatstock API quote prepared; order submission disabled.",
      raw: { upload_response: uploadResponse, costs, provider },
      extra: { printable_pack_id: printablePackId, submit_order: false },
    });
  }

  const shippingAddress =
    record(checkout.shipping_address) ||
    record(checkout.shippingAddress) ||
    record(params.payload.shipping_address) ||
    record(params.payload.shippingAddress);
  if (!shippingAddress) {
    return fail(adapterId, "Treatstock place-order needs api_checkout.shipping_address as an object.");
  }
  const orderRequest = {
    printablePackId,
    providerId: provider.providerId,
    comment: stringField(checkout, "comment", "instructions") || params.purchaseRequest.taskTitle,
    location: record(checkout.location) || {},
    shippingAddress,
    modelTextureInfo:
      record(checkout.model_texture_info) ||
      record(checkout.modelTextureInfo) ||
      {
        isOneMaterialForKit: "1",
        modelTexture: {
          color: stringField(checkout, "color", "printerColor") || "White",
          materialGroup:
            stringField(checkout, "material_group", "materialGroup", "printerMaterialGroup") ||
            "PLA",
        },
      },
  };
  const { response, data } = await postJson(
    appendPrivateKey(treatstockEndpoint("/place-order/create"), privateKey),
    orderRequest,
  );
  if (!response.ok || record(data)?.success === false) {
    return fail(adapterId, "Treatstock place-order failed.", {
      http_status: response.status,
      printable_pack_id: printablePackId,
      provider,
      raw: data,
    });
  }
  const raw = record(data) ?? { raw: data };
  const goodsCents = extractFirstCents(raw, [["total"], ["Total"]]) || provider.priceCents;
  return completed({
    adapterId,
    merchant: "treatstock",
    summary: `Treatstock API order submitted${stringField(raw, "orderId", "order_id") ? ` (${stringField(raw, "orderId", "order_id")})` : ""}.`,
    goodsCents,
    raw: data,
    extra: {
      printable_pack_id: printablePackId,
      provider,
      upload_response: uploadResponse,
      order_url: stringField(raw, "url"),
    },
  });
}

async function executePrivateManufacturingApi(
  params: CommerceApiCheckoutInput,
  adapterId: "api.xometry" | "api.protolabs" | "api.fictiv",
) {
  const checkout = apiCheckout(params.payload);
  const prefix =
    adapterId === "api.xometry"
      ? "OTTOAUTH_XOMETRY"
      : adapterId === "api.protolabs"
        ? "OTTOAUTH_PROTOLABS"
        : "OTTOAUTH_FICTIV";
  const baseUrl = commerceEnv(`${prefix}_API_BASE_URL`);
  const apiKey = commerceEnv(`${prefix}_API_KEY`);
  if (!baseUrl || !apiKey) {
    return fail(adapterId, `${adapterId} private API base URL and key are not configured.`);
  }
  const endpointPath = stringField(checkout, "native_endpoint_path", "endpoint_path", "endpointPath");
  const nativeRequest =
    record(checkout.native_order_request) ||
    record(checkout.order_request) ||
    record(checkout.quote_request) ||
    record(checkout.orderRequest);
  if (!endpointPath || !nativeRequest) {
    return fail(
      adapterId,
      `${adapterId} needs api_checkout.native_endpoint_path and a native order or quote request.`,
    );
  }
  const url = `${baseUrl.replace(/\/$/, "")}/${endpointPath.replace(/^\//, "")}`;
  const { response, data } = await postJson(url, nativeRequest, {
    authorization: `Bearer ${apiKey}`,
  });
  if (!response.ok) {
    return fail(adapterId, `${adapterId} private API request failed.`, {
      http_status: response.status,
      raw: data,
    });
  }
  const merchant = adapterId.replace("api.", "");
  return completed({
    adapterId,
    merchant,
    summary: `${merchant} private API request completed.`,
    goodsCents: extractFirstCents(record(data) ?? {}, [["total"], ["price"], ["amount"]]),
    raw: data,
    extra: { endpoint_path: endpointPath },
  });
}

export async function executeCommerceApiCheckout(
  params: CommerceApiCheckoutInput,
): Promise<CommerceApiCheckoutResult> {
  switch (params.routePlan.adapterId) {
    case "api.mouser":
      return executeMouser(params);
    case "api.digikey":
      return executeDigiKey(params);
    case "api.treatstock":
      return executeTreatstock(params);
    case "api.xometry":
      return executePrivateManufacturingApi(params, "api.xometry");
    case "api.protolabs":
      return executePrivateManufacturingApi(params, "api.protolabs");
    case "api.fictiv":
      return executePrivateManufacturingApi(params, "api.fictiv");
    default:
      return fail(params.routePlan.adapterId, "No direct API adapter is registered for this route.");
  }
}
