import { NextResponse } from "next/server";
import { listComputerUseDevicesForHuman } from "@/lib/computeruse-store";
import {
  getActiveHumanDevicePairingCodes,
  getHumanCreditBalance,
  getLinkedAgentsForHuman,
  listCreditLedgerEntries,
} from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import {
  getHumanFulfillmentRatingStats,
  listAgentSpendTotalsForHuman,
  listGenericBrowserTasksRelatedToHuman,
} from "@/lib/generic-browser-tasks";

export async function GET() {
  const user = await getCurrentHumanUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const [
    balanceCents,
    linkedAgents,
    devices,
    pairingCodes,
    ledger,
    tasks,
    fulfillmentStats,
    agentSpendTotals,
  ] = await Promise.all([
    getHumanCreditBalance(user.id),
    getLinkedAgentsForHuman(user.id),
    listComputerUseDevicesForHuman(user.id),
    getActiveHumanDevicePairingCodes(user.id),
    listCreditLedgerEntries(user.id, 20),
    listGenericBrowserTasksRelatedToHuman(user.id, 20),
    getHumanFulfillmentRatingStats(user.id),
    listAgentSpendTotalsForHuman(user.id),
  ]);
  const spendByAgentId = new Map(
    agentSpendTotals.map((entry) => [entry.agent_id, entry.total_spent_cents]),
  );
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
