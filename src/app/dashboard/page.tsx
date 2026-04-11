import { redirect } from "next/navigation";
import { DashboardClient } from "./dashboard-client";
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

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect("/login");
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

  return (
    <DashboardClient
      user={user}
      balanceCents={balanceCents}
      linkedAgents={linkedAgents}
      devices={devices}
      pairingCodes={pairingCodes}
      ledger={ledger}
      tasks={tasks}
      fulfillmentStats={fulfillmentStats}
    />
  );
}
