import { NextResponse } from "next/server";

import { requireAdminApiAccess } from "@/lib/admin-auth";
import {
  claimOrderForAdmin,
  getOrderByPublicIdOrId,
  parseOrderForApi,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

export async function POST(_request: Request, context: Context) {
  const admin = await requireAdminApiAccess();
  if (!admin.ok) return admin.response;

  const { orderId } = await context.params;
  const order = await getOrderByPublicIdOrId(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  try {
    const claimed = await claimOrderForAdmin({
      orderId: order.id,
      adminEmail: admin.email,
    });
    return NextResponse.json({
      ok: true,
      order: claimed ? parseOrderForApi(claimed) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claim failed.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
