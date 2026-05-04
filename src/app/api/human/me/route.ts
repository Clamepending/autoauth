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
import { isUserFulfillmentEnabled } from "@/lib/user-fulfillment-config";

export async function GET() {
  const user = await getCurrentHumanUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const exposeUserFulfillment = isUserFulfillmentEnabled();
  const [balanceCents, linkedAgents, devices, pairingCodes, ledger, tasks, fulfillmentStats] =
    await Promise.all([
    getHumanCreditBalance(user.id),
    getLinkedAgentsForHuman(user.id),
    exposeUserFulfillment ? listComputerUseDevicesForHuman(user.id) : Promise.resolve([]),
    exposeUserFulfillment ? getActiveHumanDevicePairingCodes(user.id) : Promise.resolve([]),
    listCreditLedgerEntries(user.id, 20),
    listGenericBrowserTasksRelatedToHuman(user.id, 20),
    exposeUserFulfillment
      ? getHumanFulfillmentRatingStats(user.id)
      : Promise.resolve({
          human_user_id: user.id,
          submitted_task_count: 0,
          fulfilled_task_count: 0,
          rating_count: 0,
          average_rating: null,
        }),
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
