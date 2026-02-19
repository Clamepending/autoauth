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
      product_title TEXT,
      stripe_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_amazon_orders_username ON amazon_orders(username_lower)",
  );

  // Migrate older tables that lack the new columns
  const tableInfo = await client.execute({
    sql: "PRAGMA table_info(amazon_orders)",
    args: [],
  });
  const columns = (tableInfo.rows ?? []) as unknown as { name: string }[];
  const names = new Set(columns.map((c) => c.name));

  if (!names.has("estimated_price_cents")) {
    await client.execute(
      "ALTER TABLE amazon_orders ADD COLUMN estimated_price_cents INTEGER",
    );
  }
  if (!names.has("product_title")) {
    await client.execute(
      "ALTER TABLE amazon_orders ADD COLUMN product_title TEXT",
    );
  }

  schemaReady = true;
}
