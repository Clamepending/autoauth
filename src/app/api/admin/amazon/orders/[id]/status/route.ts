import { NextResponse } from "next/server";
import {
  getOrderById,
  updateOrderFulfillment,
  updateOrderStatus,
} from "@/services/amazon/orders";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = typeof payload.action === "string" ? payload.action.trim().toLowerCase() : "";
  const trackingNumber =
    typeof payload.tracking_number === "string"
      ? payload.tracking_number.trim().slice(0, 120)
      : "";
  const note =
    typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : "";

  const order = await getOrderById(id);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (action === "paid") {
    await updateOrderStatus(id, "Paid");
    return NextResponse.json({ ok: true, status: "Paid" });
  }

  if (action !== "fulfilled" && action !== "failed") {
    return NextResponse.json(
      { error: "action must be one of: fulfilled, failed, paid." },
      { status: 400 },
    );
  }

  if (action === "fulfilled" && !trackingNumber && !note) {
    return NextResponse.json(
      {
        error:
          "For fulfilled orders, provide tracking_number or note so the result is traceable.",
      },
      { status: 400 },
    );
  }

  await updateOrderFulfillment({
    orderId: id,
    status: action === "fulfilled" ? "Fulfilled" : "Failed",
    trackingNumber: trackingNumber || null,
    fulfillmentNote: note || null,
  });

  return NextResponse.json({
    ok: true,
    status: action === "fulfilled" ? "Fulfilled" : "Failed",
    tracking_number: trackingNumber || null,
    fulfillment_note: note || null,
  });
}
