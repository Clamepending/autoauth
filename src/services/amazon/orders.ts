import { getTursoClient } from "@/lib/turso";
import { ensureAmazonSchema } from "./schema";

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
  created_at: string;
  updated_at: string;
};

export async function createOrder(params: {
  usernameLower: string;
  itemUrl: string;
  shippingLocation: string;
  estimatedPriceCents?: number | null;
  estimatedTaxCents?: number | null;
  processingFeeCents?: number | null;
  taxState?: string | null;
  productTitle?: string | null;
}): Promise<AmazonOrderRecord> {
  await ensureAmazonSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const insertResult = await client.execute({
    sql: `INSERT INTO amazon_orders
            (username_lower, item_url, shipping_location, status,
             estimated_price_cents, estimated_tax_cents, processing_fee_cents,
             tax_state, product_title, stripe_session_id,
             created_at, updated_at)
          VALUES (?, ?, ?, 'Submitted', ?, ?, ?, ?, ?, NULL, ?, ?)`,
    args: [
      params.usernameLower,
      params.itemUrl,
      params.shippingLocation,
      params.estimatedPriceCents ?? null,
      params.estimatedTaxCents ?? null,
      params.processingFeeCents ?? null,
      params.taxState ?? null,
      params.productTitle ?? null,
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
