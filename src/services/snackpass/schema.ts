import { getTursoClient } from "@/lib/turso";

let schemaReady = false;

export async function ensureSnackpassSchema() {
  if (schemaReady) return;
  const client = getTursoClient();

  await client.execute(
    `CREATE TABLE IF NOT EXISTS snackpass_menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dish_slug TEXT NOT NULL UNIQUE,
      dish_name TEXT NOT NULL,
      restaurant_name TEXT NOT NULL,
      restaurant_address TEXT,
      base_price_cents INTEGER NOT NULL,
      service_fee_cents INTEGER,
      delivery_fee_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'usd',
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS snackpass_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_lower TEXT NOT NULL,
      menu_item_id INTEGER NOT NULL,
      dish_name TEXT NOT NULL,
      restaurant_name TEXT NOT NULL,
      shipping_location TEXT NOT NULL,
      order_type TEXT NOT NULL DEFAULT 'pickup',
      delivery_instructions TEXT,
      tip_cents INTEGER,
      service_fee_cents INTEGER,
      delivery_fee_cents INTEGER,
      status TEXT NOT NULL DEFAULT 'Submitted',
      estimated_price_cents INTEGER NOT NULL,
      estimated_tax_cents INTEGER,
      processing_fee_cents INTEGER,
      tax_state TEXT,
      stripe_session_id TEXT,
      fulfillment_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_snackpass_orders_username ON snackpass_orders(username_lower)"
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_snackpass_orders_status ON snackpass_orders(status)"
  );

  const tableInfo = await client.execute({
    sql: "PRAGMA table_info(snackpass_menu_items)",
    args: [],
  });
  const columns = (tableInfo.rows ?? []) as unknown as { name: string }[];
  const names = new Set(columns.map((c) => c.name));

  if (!names.has("service_fee_cents")) {
    await client.execute(
      "ALTER TABLE snackpass_menu_items ADD COLUMN service_fee_cents INTEGER"
    );
  }
  if (!names.has("delivery_fee_cents")) {
    await client.execute(
      "ALTER TABLE snackpass_menu_items ADD COLUMN delivery_fee_cents INTEGER"
    );
  }
  if (!names.has("restaurant_address")) {
    await client.execute(
      "ALTER TABLE snackpass_menu_items ADD COLUMN restaurant_address TEXT"
    );
  }

  const ordersInfo = await client.execute({
    sql: "PRAGMA table_info(snackpass_orders)",
    args: [],
  });
  const orderColumns = (ordersInfo.rows ?? []) as unknown as { name: string }[];
  const orderNames = new Set(orderColumns.map((c) => c.name));

  if (!orderNames.has("delivery_instructions")) {
    await client.execute(
      "ALTER TABLE snackpass_orders ADD COLUMN delivery_instructions TEXT"
    );
  }
  if (!orderNames.has("tip_cents")) {
    await client.execute(
      "ALTER TABLE snackpass_orders ADD COLUMN tip_cents INTEGER"
    );
  }
  if (!orderNames.has("service_fee_cents")) {
    await client.execute(
      "ALTER TABLE snackpass_orders ADD COLUMN service_fee_cents INTEGER"
    );
  }
  if (!orderNames.has("delivery_fee_cents")) {
    await client.execute(
      "ALTER TABLE snackpass_orders ADD COLUMN delivery_fee_cents INTEGER"
    );
  }
  if (!orderNames.has("tax_state")) {
    await client.execute(
      "ALTER TABLE snackpass_orders ADD COLUMN tax_state TEXT"
    );
  }
  if (!orderNames.has("processing_fee_cents")) {
    await client.execute(
      "ALTER TABLE snackpass_orders ADD COLUMN processing_fee_cents INTEGER"
    );
  }
  if (!orderNames.has("stripe_session_id")) {
    await client.execute(
      "ALTER TABLE snackpass_orders ADD COLUMN stripe_session_id TEXT"
    );
  }
  if (!orderNames.has("fulfillment_note")) {
    await client.execute(
      "ALTER TABLE snackpass_orders ADD COLUMN fulfillment_note TEXT"
    );
  }

  schemaReady = true;
}
