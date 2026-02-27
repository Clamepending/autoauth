import { NextResponse } from "next/server";
import {
  getMenuItemById,
  updateMenuItem,
} from "@/services/snackpass/menu";

function parseCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num) : null;
  }
  return null;
}

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid menu item id." }, { status: 400 });
  }
  const item = await getMenuItemById(id);
  if (!item) {
    return NextResponse.json({ error: "Menu item not found." }, { status: 404 });
  }
  return NextResponse.json(item);
}

export async function PATCH(request: Request, { params }: Context) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid menu item id." }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const dishName = typeof payload.dish_name === "string" ? payload.dish_name.trim() : undefined;
  const restaurantName = typeof payload.restaurant_name === "string" ? payload.restaurant_name.trim() : undefined;
  const restaurantAddress = typeof payload.restaurant_address === "string" ? payload.restaurant_address.trim() : undefined;
  const basePriceCents = typeof payload.base_price_cents === "undefined" ? undefined : parseCents(payload.base_price_cents);
  const serviceFeeCents = typeof payload.service_fee_cents === "undefined" ? undefined : parseCents(payload.service_fee_cents);
  const deliveryFeeCents = typeof payload.delivery_fee_cents === "undefined" ? undefined : parseCents(payload.delivery_fee_cents);
  const currency = typeof payload.currency === "string" ? payload.currency.trim().toLowerCase() : undefined;
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : undefined;
  const isActive = typeof payload.is_active === "boolean" ? payload.is_active : undefined;

  if (typeof basePriceCents === "number" && basePriceCents < 0) {
    return NextResponse.json({ error: "base_price_cents must be a non-negative number." }, { status: 400 });
  }

  const updated = await updateMenuItem({
    id,
    dishName,
    restaurantName,
    restaurantAddress,
    basePriceCents: basePriceCents ?? undefined,
    serviceFeeCents: serviceFeeCents ?? undefined,
    deliveryFeeCents: deliveryFeeCents ?? undefined,
    currency,
    isActive,
    notes,
  });

  if (!updated) {
    return NextResponse.json({ error: "Menu item not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, item: updated });
}
