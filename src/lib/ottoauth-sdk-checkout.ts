import { normalizeSdkAppId } from "@/lib/ottoauth-sdk";

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeText(value: unknown, limit = 1000) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function parseOptionalCents(value: unknown) {
  if (value == null || value === "") return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[^0-9.]/g, ""))
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function fileLabel(file: unknown, index: number) {
  const record = getRecord(file);
  if (!record) return "";
  const name = firstString([record.name, record.label, record.filename, record.safe_name]);
  const url = firstString([record.url, record.download_url, record.downloadUrl]);
  const format = firstString([record.format, record.content_type, record.contentType]);
  return `${index + 1}. ${name || "file"}${format ? ` (${format})` : ""}${url ? ` - ${url}` : ""}`;
}

function packageFiles(order: Record<string, unknown>) {
  const cadPackage = getRecord(order.cad_package) ?? getRecord(order.cadPackage);
  return normalizeArray(cadPackage?.files ?? cadPackage?.cadFiles ?? cadPackage?.cad_files);
}

function packageParts(order: Record<string, unknown>) {
  const cadPackage = getRecord(order.cad_package) ?? getRecord(order.cadPackage);
  return normalizeArray(cadPackage?.parts ?? cadPackage?.cadParts ?? cadPackage?.cad_parts);
}

function partLabel(part: unknown, index: number) {
  const record = getRecord(part);
  if (!record) return "";
  const name = firstString([record.name, record.label, record.part_number, record.partNumber]);
  const source = firstString([record.source_path, record.sourcePath, record.url]);
  return `${index + 1}. ${name || "part"}${source ? ` - ${source}` : ""}`;
}

function partOrderLabel(partOrder: unknown, index: number) {
  const record = getRecord(partOrder);
  if (!record) return "";
  const supplier = getRecord(record.supplier);
  const file = getRecord(record.file);
  const name = firstString([record.part_name, record.partName, record.name]);
  const partFile = firstString([
    record.part_file,
    record.partFile,
    record.file_key,
    record.fileKey,
    file?.name,
  ]);
  const fileUrl = firstString([record.file_url, record.fileUrl, file?.url]);
  const supplierName = firstString([
    record.supplier_name,
    record.supplierName,
    supplier?.name,
  ]);
  const supplierUrl = firstString([
    record.supplier_url,
    record.supplierUrl,
    supplier?.url,
  ]);
  const quantity = firstString([record.quantity]) || "1";
  const material = firstString([record.material, record.finish]);
  return [
    `${index + 1}. ${name || "part"}`,
    partFile ? `file ${partFile}` : "",
    `qty ${quantity}`,
    material ? `material ${material}` : "",
    supplierName || supplierUrl
      ? `supplier ${[supplierName, supplierUrl].filter(Boolean).join(" ")}`
      : "",
    fileUrl ? `OttoAuth file ${fileUrl}` : "",
  ].filter(Boolean).join(" - ");
}

function buildBuyPartsTask(order: Record<string, unknown>) {
  const supplier = getRecord(order.supplier);
  const supplierName = firstString([
    supplier?.name,
    order.supplier_name,
    order.supplierName,
    order.merchant_name,
    order.merchantName,
  ]);
  const supplierUrl = firstString([
    supplier?.url,
    order.supplier_url,
    order.supplierUrl,
    order.url,
  ]);
  const files = normalizeArray(
    order.files ?? order.ottoauth_files ?? order.cad_files ?? order.cadFiles,
  );
  const packageFileRows = packageFiles(order);
  const parts = normalizeArray(order.parts ?? order.cad_parts ?? order.cadParts);
  const packagePartRows = packageParts(order);
  const partOrders = normalizeArray(order.part_orders ?? order.partOrders ?? order.items);
  const quantity = firstString([order.quantity]) || "1";
  const material = normalizeText(order.material ?? order.finish, 300);
  const notes = normalizeText(order.notes ?? order.instructions ?? order.description, 2000);
  const effectiveFiles = files.length ? files : packageFileRows;
  const effectiveParts = parts.length ? parts : packagePartRows;
  const fileLines = effectiveFiles.map(fileLabel).filter(Boolean).slice(0, 40);
  const partLines = effectiveParts.map(partLabel).filter(Boolean).slice(0, 80);
  const partOrderLines = partOrders.map(partOrderLabel).filter(Boolean).slice(0, 80);
  const supplierLine =
    supplierName || supplierUrl
      ? `Preferred supplier: ${[supplierName, supplierUrl].filter(Boolean).join(" ")}`
      : "Supplier: auto-select a reasonable parts supplier or fabrication service.";

  return [
    `Buy or source ${quantity} physical part${quantity === "1" ? "" : "s"} for this CAD project.`,
    supplierLine,
    material ? `Material, process, or finish preference: ${material}` : "",
    fileLines.length ? `CAD files attached to OttoAuth:\n${fileLines.join("\n")}` : "",
    partOrderLines.length ? `Parts order:\n${partOrderLines.join("\n")}` : "",
    partLines.length ? `CAD parts:\n${partLines.join("\n")}` : "",
    "If this is custom geometry, upload the attached CAD file when the supplier asks for the model. If it is off-the-shelf hardware, find the closest matching purchasable part.",
    "Use the linked OttoAuth human account's saved shipping and payment context. Do not ask for or enter new card numbers or CVV from chat; if checkout requires new payment credentials or a missing address/phone/name, request clarification instead of guessing.",
    notes ? `Additional instructions: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeSdkCheckoutPayload(input: Record<string, unknown>) {
  const nestedOrder = getRecord(input.order) ?? getRecord(input.checkout);
  const order = nestedOrder ? { ...nestedOrder } : { ...input };
  const appId = normalizeSdkAppId(input.app_id ?? input.appId ?? order.app_id ?? order.appId);
  const supplier = getRecord(order.supplier);
  const packageFileRows = packageFiles(order);
  const files = normalizeArray(order.files ?? order.ottoauth_files ?? order.cad_files ?? order.cadFiles);
  const parts = normalizeArray(order.parts ?? order.cad_parts ?? order.cadParts);
  const packagePartRows = packageParts(order);
  const partOrders = normalizeArray(order.part_orders ?? order.partOrders ?? order.items);
  const effectiveFiles = files.length ? files : packageFileRows;
  const effectiveParts = parts.length ? parts : packagePartRows;
  const existingTask = firstString([
    order.task,
    order.task_prompt,
    order.taskPrompt,
    order.prompt,
    order.request,
  ]);
  const kind = firstString([order.kind, order.type, order.order_kind, order.orderKind]) || "checkout";
  const supplierName = firstString([
    supplier?.name,
    order.supplier_name,
    order.supplierName,
    order.merchant_name,
    order.merchantName,
  ]);
  const supplierUrl = firstString([
    supplier?.url,
    order.supplier_url,
    order.supplierUrl,
    order.url,
  ]);
  const maxChargeCents =
    parseOptionalCents(
      order.max_charge_cents ??
        order.maxChargeCents ??
        order.max_spend_cents ??
        order.maxSpendCents ??
        order.max_total_cents ??
        order.maxTotalCents ??
        input.max_charge_cents ??
        input.maxChargeCents,
    ) ?? undefined;

  const normalized: Record<string, unknown> = {
    ...order,
    app_id: appId,
    request_source: firstString([order.request_source, order.requestSource]) || appId,
    kind,
    task:
      existingTask ||
      (kind === "buy_parts" || effectiveFiles.length || effectiveParts.length || partOrders.length
        ? buildBuyPartsTask(order)
        : normalizeText(order.description ?? order.title, 2000)),
    task_title:
      firstString([order.task_title, order.taskTitle, order.title]) ||
      (kind === "buy_parts" ? "Buy parts" : "OttoAuth checkout"),
    platform_hint:
      firstString([order.platform_hint, order.platformHint, order.platform]) ||
      (kind === "buy_parts" ? "parts supplier or manufacturing service" : "browser checkout"),
    confirmation_mode:
      firstString([order.confirmation_mode, order.confirmationMode, order.mode]) ||
      "auto_purchase_under_cap",
  };

  if (supplierName) normalized.merchant_name = supplierName;
  if (supplierUrl) {
    normalized.url = supplierUrl;
    normalized.url_policy = firstString([order.url_policy, order.urlPolicy]) || "preferred";
  } else if (!normalized.url_policy) {
    normalized.url_policy = "discover";
  }
  if (maxChargeCents != null) normalized.max_charge_cents = maxChargeCents;
  if (effectiveFiles.length) {
    normalized.files = effectiveFiles;
    normalized.ottoauth_files = effectiveFiles;
    normalized.cad_files = normalizeArray(order.cad_files ?? order.cadFiles).length
      ? normalizeArray(order.cad_files ?? order.cadFiles)
      : effectiveFiles;
  }
  if (effectiveParts.length) normalized.cad_parts = effectiveParts;
  if (partOrders.length) normalized.part_orders = partOrders;
  if (input.username && !normalized.username) normalized.username = input.username;
  if (input.private_key && !normalized.private_key) normalized.private_key = input.private_key;
  if (input.privateKey && !normalized.private_key) normalized.private_key = input.privateKey;

  return normalized;
}
