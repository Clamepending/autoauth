import { getTursoClient } from "@/lib/turso";

let schemaReady = false;

export async function ensureAmazonSchema() {
  if (schemaReady) return;
  const client = getTursoClient();

  await client.execute(
    `CREATE TABLE IF NOT EXISTS amazon_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_lower TEXT NOT NULL,
      item_url TEXT NOT NULL,
      shipping_location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Submitted',
      estimated_price_cents INTEGER,
      estimated_tax_cents INTEGER,
      processing_fee_cents INTEGER,
      tax_state TEXT,
      product_title TEXT,
      stripe_session_id TEXT,
      tracking_number TEXT,
      fulfillment_note TEXT,
      shipping_address TEXT,
      amazon_total_cents INTEGER,
      confirmation_number TEXT,
      est_delivery TEXT,
      phase1_task_id TEXT,
      phase2_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );

  const tableInfo = await client.execute({
    sql: "PRAGMA table_info(amazon_orders)",
    args: [],
  });
  const columns = (tableInfo.rows ?? []) as unknown as { name: string }[];
  const names = new Set(columns.map((c) => c.name));

  const migrations: Record<string, string> = {
    estimated_price_cents: "INTEGER",
    product_title: "TEXT",
    estimated_tax_cents: "INTEGER",
    tax_state: "TEXT",
    processing_fee_cents: "INTEGER",
    tracking_number: "TEXT",
    fulfillment_note: "TEXT",
    shipping_address: "TEXT",
    amazon_total_cents: "INTEGER",
    confirmation_number: "TEXT",
    est_delivery: "TEXT",
    phase1_task_id: "TEXT",
    phase2_task_id: "TEXT",
  };

  for (const [col, colType] of Object.entries(migrations)) {
    if (!names.has(col)) {
      await client.execute(
        `ALTER TABLE amazon_orders ADD COLUMN ${col} ${colType}`,
      );
    }
  }

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_amazon_orders_username ON amazon_orders(username_lower)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_amazon_orders_phase1 ON amazon_orders(phase1_task_id)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_amazon_orders_phase2 ON amazon_orders(phase2_task_id)",
  );

  schemaReady = true;
}
