import { NextResponse } from "next/server";
import {
  ensureComputerUseTransportSchema,
  listComputerUseDevicesForHuman,
} from "@/lib/computeruse-store";
import {
  ensureHumanAccountSchema,
  getActiveHumanDevicePairingCodes,
  getHumanCreditBalance,
  getLinkedAgentsForHuman,
  listCreditLedgerEntries,
} from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import {
  ensureGenericBrowserTaskSchema,
  getHumanFulfillmentRatingStats,
  listAgentSpendTotalsForHuman,
  listGenericBrowserTasksRelatedToHuman,
} from "@/lib/generic-browser-tasks";
import { listOrderSpendTotalsForHuman } from "@/lib/order-orchestration";
import { isUserFulfillmentEnabled } from "@/lib/user-fulfillment-config";

export async function GET() {
  const user = await getCurrentHumanUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const exposeUserFulfillment = isUserFulfillmentEnabled();
  await ensureHumanAccountSchema();
  await ensureGenericBrowserTaskSchema();
  if (exposeUserFulfillment) {
    await ensureComputerUseTransportSchema();
  }
  const balanceCents = await getHumanCreditBalance(user.id);
  const linkedAgents = await getLinkedAgentsForHuman(user.id);
  const devices = exposeUserFulfillment ? await listComputerUseDevicesForHuman(user.id) : [];
  const pairingCodes = exposeUserFulfillment ? await getActiveHumanDevicePairingCodes(user.id) : [];
  const ledger = await listCreditLedgerEntries(user.id, 20);
  const tasks = await listGenericBrowserTasksRelatedToHuman(user.id, 20);
  const fulfillmentStats = exposeUserFulfillment
    ? await getHumanFulfillmentRatingStats(user.id)
    : {
        human_user_id: user.id,
        submitted_task_count: 0,
        fulfilled_task_count: 0,
        rating_count: 0,
        average_rating: null,
      };
  const [agentSpendTotals, orderSpendTotals] = await Promise.all([
    listAgentSpendTotalsForHuman(user.id),
    listOrderSpendTotalsForHuman(user.id),
  ]);
  const spendByAgentId = new Map(
    agentSpendTotals.map((entry) => [entry.agent_id, entry.total_spent_cents]),
  );
  for (const entry of orderSpendTotals) {
    spendByAgentId.set(
      entry.agent_id,
      (spendByAgentId.get(entry.agent_id) ?? 0) + entry.total_spent_cents,
    );
  }
  const linkedAgentsWithSpend = linkedAgents.map((agent) => ({
    ...agent,
    total_spent_cents: spendByAgentId.get(agent.agent_id) ?? 0,
  }));

  return NextResponse.json({
    user,
    balance_cents: balanceCents,
    linked_agents: linkedAgentsWithSpend,
    devices,
    active_device_pairing_codes: pairingCodes,
    ledger,
    tasks,
    fulfillment_stats: fulfillmentStats,
  });
}
