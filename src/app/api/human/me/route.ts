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
  listGenericBrowserTasksRelatedToHuman,
} from "@/lib/generic-browser-tasks";

export async function GET() {
  const user = await getCurrentHumanUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const [balanceCents, linkedAgents, devices, pairingCodes, ledger, tasks, fulfillmentStats] =
    await Promise.all([
    getHumanCreditBalance(user.id),
    getLinkedAgentsForHuman(user.id),
    listComputerUseDevicesForHuman(user.id),
    getActiveHumanDevicePairingCodes(user.id),
    listCreditLedgerEntries(user.id, 20),
    listGenericBrowserTasksRelatedToHuman(user.id, 20),
    getHumanFulfillmentRatingStats(user.id),
  ]);

  return NextResponse.json({
    user,
    balance_cents: balanceCents,
    linked_agents: linkedAgents,
    devices,
    active_device_pairing_codes: pairingCodes,
    ledger,
    tasks,
    fulfillment_stats: fulfillmentStats,
  });
}
