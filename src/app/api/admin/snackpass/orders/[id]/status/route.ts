import { NextResponse } from "next/server";
import {
  getSnackpassOrderById,
  updateSnackpassOrderFulfillment,
  updateSnackpassOrderStatus,
} from "@/services/snackpass/orders";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
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
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : "";

  const order = await getSnackpassOrderById(id);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (action === "paid") {
    await updateSnackpassOrderStatus(id, "Paid");
    return NextResponse.json({ ok: true, status: "Paid" });
  }

  if (action !== "fulfilled" && action !== "failed") {
    return NextResponse.json(
      { error: "action must be one of: fulfilled, failed, paid." },
      { status: 400 },
    );
  }

  if (action === "fulfilled" && !note) {
    return NextResponse.json(
      { error: "For fulfilled orders, provide a note so the result is traceable." },
      { status: 400 },
    );
  }

  await updateSnackpassOrderFulfillment({
    orderId: id,
    status: action === "fulfilled" ? "Fulfilled" : "Failed",
    fulfillmentNote: note || null,
  });

  return NextResponse.json({
    ok: true,
    status: action === "fulfilled" ? "Fulfilled" : "Failed",
    fulfillment_note: note || null,
  });
}
