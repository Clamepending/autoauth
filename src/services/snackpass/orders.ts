import { getTursoClient } from "@/lib/turso";
import { ensureSnackpassSchema } from "@/services/snackpass/schema";

export type SnackpassOrderRecord = {
  id: number;
  username_lower: string;
  menu_item_id: number;
  dish_name: string;
  restaurant_name: string;
  shipping_location: string;
  order_type: string;
  delivery_instructions: string | null;
  tip_cents: number | null;
  service_fee_cents: number | null;
  delivery_fee_cents: number | null;
  status: string;
  estimated_price_cents: number;
  estimated_tax_cents: number | null;
  processing_fee_cents: number | null;
  tax_state: string | null;
  stripe_session_id: string | null;
  fulfillment_note: string | null;
  created_at: string;
  updated_at: string;
};

export async function createSnackpassOrder(params: {
  usernameLower: string;
  menuItemId: number;
  dishName: string;
  restaurantName: string;
  shippingLocation: string;
  orderType?: string;
  deliveryInstructions?: string | null;
  tipCents?: number | null;
  serviceFeeCents?: number | null;
  deliveryFeeCents?: number | null;
  estimatedPriceCents: number;
  estimatedTaxCents?: number | null;
  processingFeeCents?: number | null;
  taxState?: string | null;
}): Promise<SnackpassOrderRecord> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const orderType = params.orderType?.trim().toLowerCase() || "pickup";

  const insertResult = await client.execute({
    sql: `INSERT INTO snackpass_orders
          (username_lower, menu_item_id, dish_name, restaurant_name, shipping_location,
           order_type, delivery_instructions, tip_cents, service_fee_cents, delivery_fee_cents,
           status, estimated_price_cents, estimated_tax_cents, processing_fee_cents, tax_state,
           stripe_session_id, fulfillment_note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    args: [
      params.usernameLower,
      params.menuItemId,
      params.dishName,
      params.restaurantName,
      params.shippingLocation,
      orderType,
      params.deliveryInstructions?.trim() || null,
      params.tipCents ?? null,
      params.serviceFeeCents ?? null,
      params.deliveryFeeCents ?? null,
      params.estimatedPriceCents,
      params.estimatedTaxCents ?? null,
      params.processingFeeCents ?? null,
      params.taxState ?? null,
      now,
      now,
    ],
  });

  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  let id = rawId != null ? Number(rawId) : 0;
  if (id === 0) {
    const fallback = await client.execute({
      sql: "SELECT last_insert_rowid() AS id",
      args: [],
    });
    id = (fallback.rows?.[0] as unknown as { id: number } | undefined)?.id ?? 0;
  }

  const row = await getSnackpassOrderById(id);
  if (!row) throw new Error("Snackpass order creation failed.");
  return row;
}

export async function getSnackpassOrderById(id: number): Promise<SnackpassOrderRecord | null> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM snackpass_orders WHERE id = ? LIMIT 1",
    args: [id],
  });
  return (result.rows?.[0] as unknown as SnackpassOrderRecord | undefined) ?? null;
}

export async function getSnackpassOrdersByUsername(usernameLower: string): Promise<SnackpassOrderRecord[]> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM snackpass_orders WHERE username_lower = ? ORDER BY created_at DESC",
    args: [usernameLower],
  });
  return (result.rows ?? []) as unknown as SnackpassOrderRecord[];
}

export async function listSnackpassOrders(): Promise<SnackpassOrderRecord[]> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM snackpass_orders ORDER BY created_at DESC",
    args: [],
  });
  return (result.rows ?? []) as unknown as SnackpassOrderRecord[];
}

export async function updateSnackpassOrderStripeSession(orderId: number, stripeSessionId: string | null): Promise<void> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE snackpass_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?",
    args: [stripeSessionId, now, orderId],
  });
}

export async function updateSnackpassOrderStatus(orderId: number, status: string): Promise<void> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE snackpass_orders SET status = ?, updated_at = ? WHERE id = ?",
    args: [status, now, orderId],
  });
}

export async function updateSnackpassOrderFulfillment(params: {
  orderId: number;
  status: "Fulfilled" | "Failed";
  fulfillmentNote: string | null;
}): Promise<void> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE snackpass_orders
          SET status = ?, fulfillment_note = ?, updated_at = ?
          WHERE id = ?`,
    args: [params.status, params.fulfillmentNote, now, params.orderId],
  });
}
