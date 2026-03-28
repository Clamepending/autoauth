import { getTursoClient } from "@/lib/turso";
import { ensureAmazonSchema } from "./schema";

export type AmazonOrderStatus =
  | "Submitted"
  | "pending_price"
  | "pending_payment"
  | "Paid"
  | "fulfilling"
  | "Fulfilled"
  | "price_changed"
  | "Failed";

export type AmazonOrderRecord = {
  id: number;
  username_lower: string;
  item_url: string;
  shipping_location: string;
  status: string;
  estimated_price_cents: number | null;
  estimated_tax_cents: number | null;
  processing_fee_cents: number | null;
  tax_state: string | null;
  product_title: string | null;
  stripe_session_id: string | null;
  tracking_number: string | null;
  fulfillment_note: string | null;
  shipping_address: string | null;
  amazon_total_cents: number | null;
  confirmation_number: string | null;
  est_delivery: string | null;
  phase1_task_id: string | null;
  phase2_task_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function createOrder(params: {
  usernameLower: string;
  itemUrl: string;
  shippingLocation: string;
  shippingAddress?: string | null;
  status?: AmazonOrderStatus;
  estimatedPriceCents?: number | null;
  estimatedTaxCents?: number | null;
  processingFeeCents?: number | null;
  taxState?: string | null;
  productTitle?: string | null;
  phase1TaskId?: string | null;
}): Promise<AmazonOrderRecord> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const status = params.status ?? "Submitted";
  const insertResult = await client.execute({
    sql: `INSERT INTO amazon_orders
            (username_lower, item_url, shipping_location, shipping_address, status,
             estimated_price_cents, estimated_tax_cents, processing_fee_cents,
             tax_state, product_title, stripe_session_id, phase1_task_id,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    args: [
      params.usernameLower,
      params.itemUrl,
      params.shippingLocation,
      params.shippingAddress ?? null,
      status,
      params.estimatedPriceCents ?? null,
      params.estimatedTaxCents ?? null,
      params.processingFeeCents ?? null,
      params.taxState ?? null,
      params.productTitle ?? null,
      params.phase1TaskId ?? null,
      now,
      now,
    ],
  });

  const rawId = (insertResult as { lastInsertRowid?: bigint | number })
    .lastInsertRowid;
  let id = rawId != null ? Number(rawId) : 0;
  if (id === 0) {
    const fallback = await client.execute({
      sql: "SELECT last_insert_rowid() AS id",
      args: [],
    });
    id =
      (fallback.rows?.[0] as unknown as { id: number } | undefined)?.id ?? 0;
  }

  const row = await getOrderById(id);
  if (!row) throw new Error("Amazon order creation failed.");
  return row;
}

export async function getOrdersByUsername(
  usernameLower: string,
): Promise<AmazonOrderRecord[]> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM amazon_orders WHERE username_lower = ? ORDER BY created_at DESC",
    args: [usernameLower],
  });
  return (result.rows ?? []) as unknown as AmazonOrderRecord[];
}

export async function getOrderById(
  id: number,
): Promise<AmazonOrderRecord | null> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM amazon_orders WHERE id = ? LIMIT 1",
    args: [id],
  });
  return (
    (result.rows?.[0] as unknown as AmazonOrderRecord | undefined) ?? null
  );
}

export async function updateOrderStripeSession(
  orderId: number,
  stripeSessionId: string | null,
): Promise<void> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE amazon_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?",
    args: [stripeSessionId, now, orderId],
  });
}

export async function updateOrderStatus(
  orderId: number,
  status: string,
): Promise<void> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE amazon_orders SET status = ?, updated_at = ? WHERE id = ?",
    args: [status, now, orderId],
  });
}

export async function updateOrderFulfillment(params: {
  orderId: number;
  status: "Fulfilled" | "Failed";
  trackingNumber: string | null;
  fulfillmentNote: string | null;
}): Promise<void> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE amazon_orders
          SET status = ?, tracking_number = ?, fulfillment_note = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      params.status,
      params.trackingNumber,
      params.fulfillmentNote,
      now,
      params.orderId,
    ],
  });
}

export async function getOrderByPhase1TaskId(
  taskId: string,
): Promise<AmazonOrderRecord | null> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM amazon_orders WHERE phase1_task_id = ? LIMIT 1",
    args: [taskId],
  });
  return (
    (result.rows?.[0] as unknown as AmazonOrderRecord | undefined) ?? null
  );
}

export async function getOrderByPhase2TaskId(
  taskId: string,
): Promise<AmazonOrderRecord | null> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM amazon_orders WHERE phase2_task_id = ? LIMIT 1",
    args: [taskId],
  });
  return (
    (result.rows?.[0] as unknown as AmazonOrderRecord | undefined) ?? null
  );
}

export async function updateOrderPriceFromAgent(params: {
  orderId: number;
  itemPriceCents: number;
  shippingCents: number;
  taxCents: number;
  amazonTotalCents: number;
  productTitle?: string | null;
  processingFeeCents?: number;
}): Promise<void> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE amazon_orders
          SET status = 'pending_payment',
              estimated_price_cents = ?,
              estimated_tax_cents = ?,
              processing_fee_cents = ?,
              amazon_total_cents = ?,
              product_title = COALESCE(?, product_title),
              updated_at = ?
          WHERE id = ?`,
    args: [
      params.itemPriceCents + params.shippingCents,
      params.taxCents,
      params.processingFeeCents ?? 0,
      params.amazonTotalCents,
      params.productTitle ?? null,
      now,
      params.orderId,
    ],
  });
}

export async function updateOrderPhase2TaskId(
  orderId: number,
  taskId: string,
): Promise<void> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE amazon_orders SET phase2_task_id = ?, status = 'fulfilling', updated_at = ? WHERE id = ?",
    args: [taskId, now, orderId],
  });
}

export async function updateOrderConfirmation(params: {
  orderId: number;
  confirmationNumber: string;
  estDelivery: string | null;
  finalTotalCents: number | null;
}): Promise<void> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE amazon_orders
          SET status = 'Fulfilled',
              confirmation_number = ?,
              est_delivery = ?,
              amazon_total_cents = COALESCE(?, amazon_total_cents),
              updated_at = ?
          WHERE id = ?`,
    args: [
      params.confirmationNumber,
      params.estDelivery,
      params.finalTotalCents,
      now,
      params.orderId,
    ],
  });
}
