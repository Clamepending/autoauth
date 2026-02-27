import { getTursoClient } from "@/lib/turso";
import { ensureSnackpassSchema } from "@/services/snackpass/schema";

export type SnackpassMenuItemRecord = {
  id: number;
  dish_slug: string;
  dish_name: string;
  restaurant_name: string;
  restaurant_address: string | null;
  base_price_cents: number;
  service_fee_cents: number | null;
  delivery_fee_cents: number | null;
  currency: string;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function toSlugPart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildDishSlug(dishName: string, restaurantName: string): string {
  const dish = toSlugPart(dishName) || "dish";
  const restaurant = toSlugPart(restaurantName) || "restaurant";
  return `${restaurant}__${dish}`;
}

function mapRow(row: Record<string, unknown>): SnackpassMenuItemRecord {
  return {
    id: Number(row.id),
    dish_slug: String(row.dish_slug),
    dish_name: String(row.dish_name),
    restaurant_name: String(row.restaurant_name),
    restaurant_address: row.restaurant_address ? String(row.restaurant_address) : null,
    base_price_cents: Number(row.base_price_cents),
    service_fee_cents: row.service_fee_cents == null ? null : Number(row.service_fee_cents),
    delivery_fee_cents: row.delivery_fee_cents == null ? null : Number(row.delivery_fee_cents),
    currency: String(row.currency ?? "usd"),
    is_active: Number(row.is_active ?? 1),
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listMenuItems(): Promise<SnackpassMenuItemRecord[]> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM snackpass_menu_items ORDER BY updated_at DESC",
    args: [],
  });
  const rows = (result.rows ?? []) as unknown as Record<string, unknown>[];
  return rows.map(mapRow);
}

export async function searchMenuItems(params: {
  dishQuery: string;
  restaurantQuery?: string;
  limit?: number;
}): Promise<SnackpassMenuItemRecord[]> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const dishQuery = params.dishQuery.trim().toLowerCase();
  if (!dishQuery) return [];

  const restaurantQuery = params.restaurantQuery?.trim().toLowerCase() ?? "";
  const limit = Math.max(1, Math.min(params.limit ?? 10, 50));

  if (restaurantQuery) {
    const result = await client.execute({
      sql: `SELECT * FROM snackpass_menu_items
            WHERE is_active = 1
              AND LOWER(dish_name) LIKE ?
              AND LOWER(restaurant_name) LIKE ?
            ORDER BY dish_name ASC
            LIMIT ?`,
      args: [`%${dishQuery}%`, `%${restaurantQuery}%`, limit],
    });
    const rows = (result.rows ?? []) as unknown as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  const result = await client.execute({
    sql: `SELECT * FROM snackpass_menu_items
          WHERE is_active = 1
            AND LOWER(dish_name) LIKE ?
          ORDER BY dish_name ASC
          LIMIT ?`,
    args: [`%${dishQuery}%`, limit],
  });
  const rows = (result.rows ?? []) as unknown as Record<string, unknown>[];
  return rows.map(mapRow);
}

export async function getMenuItemById(id: number): Promise<SnackpassMenuItemRecord | null> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM snackpass_menu_items WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = result.rows?.[0] as unknown as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export async function createMenuItem(params: {
  dishName: string;
  restaurantName: string;
  restaurantAddress?: string | null;
  basePriceCents: number;
  serviceFeeCents?: number | null;
  deliveryFeeCents?: number | null;
  currency?: string;
  isActive?: boolean;
  notes?: string | null;
}): Promise<SnackpassMenuItemRecord> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const dishSlug = buildDishSlug(params.dishName, params.restaurantName);
  const currency = params.currency?.trim().toLowerCase() || "usd";

  await client.execute({
    sql: `INSERT INTO snackpass_menu_items
          (dish_slug, dish_name, restaurant_name, restaurant_address, base_price_cents,
           service_fee_cents, delivery_fee_cents, currency, is_active, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    args: [
      dishSlug,
      params.dishName.trim(),
      params.restaurantName.trim(),
      params.restaurantAddress?.trim() || null,
      params.basePriceCents,
      params.serviceFeeCents ?? null,
      params.deliveryFeeCents ?? null,
      currency,
      params.isActive === false ? 0 : 1,
      params.notes?.trim() || null,
      now,
      now,
    ],
  });

  const row = await client.execute({
    sql: "SELECT * FROM snackpass_menu_items WHERE dish_slug = ? LIMIT 1",
    args: [dishSlug],
  });
  const created = row.rows?.[0] as unknown as Record<string, unknown> | undefined;
  if (!created) throw new Error("Menu item creation failed.");
  return mapRow(created);
}

export async function updateMenuItem(params: {
  id: number;
  dishName?: string;
  restaurantName?: string;
  restaurantAddress?: string | null;
  basePriceCents?: number;
  serviceFeeCents?: number | null;
  deliveryFeeCents?: number | null;
  currency?: string;
  isActive?: boolean;
  notes?: string | null;
}): Promise<SnackpassMenuItemRecord | null> {
  await ensureSnackpassSchema();
  const client = getTursoClient();
  const existing = await getMenuItemById(params.id);
  if (!existing) return null;

  const dishName = params.dishName?.trim() || existing.dish_name;
  const restaurantName = params.restaurantName?.trim() || existing.restaurant_name;
  const dishSlug = buildDishSlug(dishName, restaurantName);
  const restaurantAddress =
    typeof params.restaurantAddress === "undefined"
      ? existing.restaurant_address
      : params.restaurantAddress?.trim() || null;
  const basePriceCents =
    typeof params.basePriceCents === "number"
      ? params.basePriceCents
      : existing.base_price_cents;
  const serviceFeeCents =
    typeof params.serviceFeeCents === "undefined"
      ? existing.service_fee_cents
      : params.serviceFeeCents;
  const deliveryFeeCents =
    typeof params.deliveryFeeCents === "undefined"
      ? existing.delivery_fee_cents
      : params.deliveryFeeCents;
  const currency = params.currency?.trim().toLowerCase() || existing.currency;
  const isActive = typeof params.isActive === "boolean" ? (params.isActive ? 1 : 0) : existing.is_active;
  const notes =
    typeof params.notes === "undefined" ? existing.notes : params.notes?.trim() || null;

  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE snackpass_menu_items
          SET dish_slug = ?, dish_name = ?, restaurant_name = ?, restaurant_address = ?,
              base_price_cents = ?, service_fee_cents = ?, delivery_fee_cents = ?,
              currency = ?, is_active = ?, notes = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      dishSlug,
      dishName,
      restaurantName,
      restaurantAddress,
      basePriceCents,
      serviceFeeCents ?? null,
      deliveryFeeCents ?? null,
      currency,
      isActive,
      notes,
      now,
      params.id,
    ],
  });

  return getMenuItemById(params.id);
}
