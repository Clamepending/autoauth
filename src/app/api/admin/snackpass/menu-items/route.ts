import { NextResponse } from "next/server";
import {
  createMenuItem,
  listMenuItems,
} from "@/services/snackpass/menu";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num) : null;
  }
  return null;
}

export async function GET() {
  const items = await listMenuItems();
  return NextResponse.json(items, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const dishName = typeof payload.dish_name === "string" ? payload.dish_name.trim() : "";
  const restaurantName = typeof payload.restaurant_name === "string" ? payload.restaurant_name.trim() : "";
  const restaurantAddress = typeof payload.restaurant_address === "string" ? payload.restaurant_address.trim() : "";
  const basePriceCents = parseCents(payload.base_price_cents);
  const serviceFeeCents = parseCents(payload.service_fee_cents);
  const deliveryFeeCents = parseCents(payload.delivery_fee_cents);
  const currency = typeof payload.currency === "string" ? payload.currency.trim().toLowerCase() : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const isActive = typeof payload.is_active === "boolean" ? payload.is_active : true;

  if (!dishName) {
    return NextResponse.json({ error: "dish_name is required." }, { status: 400 });
  }
  if (!restaurantName) {
    return NextResponse.json({ error: "restaurant_name is required." }, { status: 400 });
  }
  if (basePriceCents == null || basePriceCents < 0) {
    return NextResponse.json({ error: "base_price_cents must be a non-negative number." }, { status: 400 });
  }

  const created = await createMenuItem({
    dishName,
    restaurantName,
    restaurantAddress: restaurantAddress || null,
    basePriceCents,
    serviceFeeCents: serviceFeeCents ?? null,
    deliveryFeeCents: deliveryFeeCents ?? null,
    currency: currency || undefined,
    isActive,
    notes: notes || null,
  });

  return NextResponse.json({ ok: true, item: created }, { status: 201 });
}
