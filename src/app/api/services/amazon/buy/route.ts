import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { createOrder } from "@/services/amazon/orders";
import { enqueueComputerUseLocalAgentGoalTask } from "@/lib/computeruse-store";
import { getAgentDefaultComputerUseDevice } from "@/lib/computeruse-registrations";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const itemUrl =
    typeof payload.item_url === "string" ? payload.item_url.trim() : "";
  const shippingAddress =
    typeof payload.shipping_address === "string"
      ? payload.shipping_address.trim()
      : "";
  const shippingLocation =
    typeof payload.shipping_location === "string"
      ? payload.shipping_location.trim()
      : shippingAddress;

  if (!itemUrl) {
    return NextResponse.json(
      { error: "item_url is required." },
      { status: 400 },
    );
  }
  if (!shippingAddress && !shippingLocation) {
    return NextResponse.json(
      { error: "shipping_address is required." },
      { status: 400 },
    );
  }

  const address = shippingAddress || shippingLocation;

  const goal = buildPhase1Prompt({ itemUrl, address });

  let deviceId = "*";
  const reg = await getAgentDefaultComputerUseDevice(auth.usernameLower).catch(() => null);
  if (reg?.device_id) deviceId = reg.device_id;

  const { task } = await enqueueComputerUseLocalAgentGoalTask({
    goal,
    deviceId,
    agentUsername: auth.usernameLower,
    taskPrompt: goal,
    source: "computeruse_tasks",
  });

  const order = await createOrder({
    usernameLower: auth.usernameLower,
    itemUrl,
    shippingLocation: shippingLocation || address,
    shippingAddress: address,
    status: "pending_price",
    phase1TaskId: task.id,
  });

  return NextResponse.json({
    order_id: order.id,
    status: "pending_price",
    phase1_task_id: task.id,
    message:
      "Order created. A browser agent is navigating Amazon to get the real price. " +
      "You will be notified with a payment link once pricing is confirmed. " +
      "Check order status at GET /api/services/amazon/orders/" + order.id,
  });
}

function buildPhase1Prompt(params: { itemUrl: string; address: string }): string {
  return `You are an Amazon shopping assistant. Your ONLY job is to find the final price of an item shipped to a specific address. Be efficient — do not restart or go back if you already have the information.

GOAL: Get the full price breakdown (item, shipping, tax, total) for this item shipped to: ${params.address}

STEPS:
1. Navigate to ${params.itemUrl}
2. Click "Add to Cart".
3. You may be taken to a "Added to Cart" confirmation or directly to checkout. Either way, navigate to checkout:
   - If you see a "Proceed to checkout" button, click it.
   - Otherwise navigate to https://www.amazon.com/gp/buy/spc/handlers/display.html or https://www.amazon.com/gp/cart/view.html and proceed from there.
4. You should now be on the checkout/order review page.

ADDRESS: The shipping address MUST be: ${params.address}
   - If the page shows a DIFFERENT address, click the "Change" link next to the shipping address section.
   - In the address form, enter the correct address and save/use it.
   - If you cannot change the address, note this in your report.

GIFT: If you see "Add gift options" or a "This order contains a gift" checkbox anywhere on checkout, click/check it. If you don't see it, skip this — don't go hunting for it.

PRICE: Once you can see the order summary with Items, Shipping, Tax, and Order Total:
   - Read those numbers. That's all you need.
   - DO NOT click "Place your order". DO NOT go back to the cart. Just read and report.

IMPORTANT RULES:
- If you already see the price breakdown on screen, READ IT AND REPORT IMMEDIATELY. Do not navigate away.
- Do not go back to redo steps you've already completed.
- Use screenshots to read prices — they are the most reliable source.
- Convert dollar amounts to cents (e.g. $19.14 = 1914).

Report EXACTLY this JSON:
{"status":"success","item_price_cents":<item in cents>,"shipping_cents":<shipping in cents>,"tax_cents":<tax in cents>,"amazon_total_cents":<total in cents>,"product_title":"<product name>"}

If something goes wrong:
{"status":"error","error":"<what went wrong>"}`;
}
