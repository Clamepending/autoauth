import {
  getOrderByPhase1TaskId,
  getOrderByPhase2TaskId,
  updateOrderPriceFromAgent,
  updateOrderConfirmation,
  updateOrderStatus,
} from "@/services/amazon/orders";
import { getBaseUrl } from "@/lib/base-url";
import { notifySlackAmazonFulfillment } from "@/lib/slack";
import {
  enqueueComputerUseLocalAgentGoalTask,
  getComputerUseTaskById,
} from "@/lib/computeruse-store";
import { updateOrderPhase2TaskId, getOrderById } from "@/services/amazon/orders";
import { getAgentDefaultComputerUseDevice } from "@/lib/computeruse-registrations";

/**
 * Called when a browser-agent task completes. Checks if the task is linked
 * to an Amazon order (Phase 1 or Phase 2) and handles accordingly.
 *
 * Returns true if this task was handled as an Amazon fulfillment task.
 */
export async function handleAmazonTaskCompletion(params: {
  taskId: string;
  status: "completed" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
}): Promise<boolean> {
  const phase1Order = await getOrderByPhase1TaskId(params.taskId);
  if (phase1Order) {
    await handlePhase1Completion(phase1Order.id, params);
    return true;
  }

  const phase2Order = await getOrderByPhase2TaskId(params.taskId);
  if (phase2Order) {
    await handlePhase2Completion(phase2Order.id, params);
    return true;
  }

  return false;
}

async function handlePhase1Completion(
  orderId: number,
  params: {
    taskId: string;
    status: "completed" | "failed";
    result: Record<string, unknown> | null;
    error: string | null;
  },
): Promise<void> {
  if (params.status === "failed" || !params.result) {
    await updateOrderStatus(orderId, "Failed");
    return;
  }

  const r = params.result;
  const agentStatus = r.status as string | undefined;

  if (agentStatus === "error" || agentStatus === "failed") {
    await updateOrderStatus(orderId, "Failed");
    return;
  }

  const itemPriceCents = toInt(r.item_price_cents);
  const shippingCents = toInt(r.shipping_cents);
  const taxCents = toInt(r.tax_cents);
  const amazonTotalCents = toInt(r.amazon_total_cents);

  if (amazonTotalCents == null || amazonTotalCents <= 0) {
    await updateOrderStatus(orderId, "Failed");
    return;
  }

  await updateOrderPriceFromAgent({
    orderId,
    itemPriceCents: itemPriceCents ?? 0,
    shippingCents: shippingCents ?? 0,
    taxCents: taxCents ?? 0,
    amazonTotalCents,
    productTitle: typeof r.product_title === "string" ? r.product_title : null,
    processingFeeCents: 0,
  });
}

async function handlePhase2Completion(
  orderId: number,
  params: {
    taskId: string;
    status: "completed" | "failed";
    result: Record<string, unknown> | null;
    error: string | null;
  },
): Promise<void> {
  if (params.status === "failed" || !params.result) {
    await updateOrderStatus(orderId, "Failed");
    return;
  }

  const r = params.result;
  const agentStatus = r.status as string | undefined;

  if (agentStatus === "price_changed") {
    await updateOrderStatus(orderId, "price_changed");
    return;
  }

  if (agentStatus === "error" || agentStatus === "failed") {
    await updateOrderStatus(orderId, "Failed");
    return;
  }

  const confirmationNumber =
    typeof r.confirmation_number === "string" ? r.confirmation_number : null;

  if (!confirmationNumber) {
    await updateOrderStatus(orderId, "Failed");
    return;
  }

  await updateOrderConfirmation({
    orderId,
    confirmationNumber,
    estDelivery:
      typeof r.est_delivery === "string" ? r.est_delivery : null,
    finalTotalCents: toInt(r.final_total_cents),
  });

  const order = await getOrderById(orderId);
  if (order) {
    const totalCents = order.amazon_total_cents ?? order.estimated_price_cents ?? 0;
    await notifySlackAmazonFulfillment({
      orderId: order.id,
      username: order.username_lower,
      productTitle: order.product_title,
      itemUrl: order.item_url,
      shippingLocation: order.shipping_address || order.shipping_location,
      estimatedTotal: totalCents > 0 ? `$${(totalCents / 100).toFixed(2)}` : null,
      appUrl: getBaseUrl(),
    }).catch(() => {});
  }
}

/**
 * Enqueue the Phase 2 "place order" task for a paid Amazon order.
 */
export async function enqueuePhase2ForOrder(orderId: number): Promise<string | null> {
  const order = await getOrderById(orderId);
  if (!order) return null;

  const phase2TaskId = order.phase2_task_id?.trim() || buildPhase2TaskId(orderId);
  const existingTask = await getComputerUseTaskById(phase2TaskId);
  if (existingTask) {
    if (order.phase2_task_id !== phase2TaskId || order.status !== "fulfilling") {
      await updateOrderPhase2TaskId(orderId, phase2TaskId);
    }
    return phase2TaskId;
  }

  const address = order.shipping_address || order.shipping_location;
  const expectedTotal = order.amazon_total_cents
    ? `$${(order.amazon_total_cents / 100).toFixed(2)}`
    : "the expected amount";

  const goal = buildPhase2Prompt({
    productTitle: order.product_title || "the item",
    address,
    expectedTotal,
    itemUrl: order.item_url,
  });

  let deviceId = "*";
  const reg = await getAgentDefaultComputerUseDevice(order.username_lower).catch(() => null);
  if (reg?.device_id) deviceId = reg.device_id;

  try {
    await enqueueComputerUseLocalAgentGoalTask({
      goal,
      deviceId,
      id: phase2TaskId,
      agentUsername: order.username_lower,
      taskPrompt: goal,
      source: "computeruse_tasks",
    });
  } catch (error) {
    const queuedTask = await getComputerUseTaskById(phase2TaskId);
    if (!queuedTask) throw error;
  }

  await updateOrderPhase2TaskId(orderId, phase2TaskId);
  return phase2TaskId;
}

export async function markAmazonOrderPaidAndEnqueuePhase2(
  orderId: number,
): Promise<{ orderStatus: string | null; phase2TaskId: string | null }> {
  const order = await getOrderById(orderId);
  if (!order) {
    return {
      orderStatus: null,
      phase2TaskId: null,
    };
  }

  if (order.status === "Fulfilled" || order.status === "Failed") {
    return {
      orderStatus: order.status,
      phase2TaskId: order.phase2_task_id,
    };
  }

  if (order.status !== "Paid" && order.status !== "fulfilling") {
    await updateOrderStatus(orderId, "Paid");
  }

  const phase2TaskId = await enqueuePhase2ForOrder(orderId);
  const updatedOrder = await getOrderById(orderId);
  return {
    orderStatus: updatedOrder?.status ?? "Paid",
    phase2TaskId,
  };
}

function buildPhase2Prompt(params: {
  productTitle: string;
  address: string;
  expectedTotal: string;
  itemUrl: string;
}): string {
  return `You are completing an Amazon purchase. Be efficient and direct.

GOAL: Place the order for "${params.productTitle}" shipped to ${params.address}. Expected total is approximately ${params.expectedTotal}.

STEPS:
1. Navigate to https://www.amazon.com/gp/cart/view.html
2. Verify the item is in the cart. If not, go to ${params.itemUrl}, add it, then come back.
3. Click "Proceed to checkout" to get to the order review page.

ADDRESS: Must be ${params.address}
   - If a different address is shown, click "Change" next to shipping address and update it.

GIFT: If you see "Add gift options" or "This order contains a gift", enable it. If not visible, skip.

PRICE CHECK: The expected total is ${params.expectedTotal}.
   - If the order total differs by MORE than $2.00, DO NOT place the order.
     Report: {"status":"price_changed","new_total_cents":<actual cents>,"message":"Price changed to $X.XX"}
   - If the price is acceptable, continue.

PLACE ORDER: Click "Place your order" button. Wait for the confirmation page.

CONFIRMATION: On the confirmation page, read:
   - The order number (format like "112-1234567-1234567")
   - The estimated delivery date

IMPORTANT RULES:
- If you can already see the checkout/review page, don't go back to the cart.
- Use screenshots to read prices and confirmation numbers — most reliable.
- Do not restart steps you've already completed.

Report EXACTLY this JSON:
{"status":"success","confirmation_number":"<order number>","est_delivery":"<delivery date>","final_total_cents":<total in cents>}

If something goes wrong:
{"status":"error","error":"<what went wrong>"}`;
}

function toInt(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function buildPhase2TaskId(orderId: number): string {
  return `amazon_phase2_order_${orderId}`;
}
