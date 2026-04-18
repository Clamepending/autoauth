import { redirect } from "next/navigation";
import { DashboardClient } from "./dashboard-client";
import { DashboardMarketServicesClient } from "./dashboard-market-services-client";
import { getBaseUrl } from "@/lib/base-url";
import { listComputerUseDevicesForHuman } from "@/lib/computeruse-store";
import {
  getActiveHumanDevicePairingCodes,
  getHumanCreditBalance,
  getHumanReferralStats,
  getLinkedAgentsForHuman,
  listCreditLedgerEntries,
} from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import {
  getHumanFulfillmentRatingStats,
} from "@/lib/generic-browser-tasks";
import { listMarketServicesForOwner } from "@/lib/market-service-owner";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const baseUrl = getBaseUrl();
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect("/login");
  }

  const [
    balanceCents,
    linkedAgents,
    devices,
    pairingCodes,
    ledger,
    fulfillmentStats,
    referralStats,
    marketServices,
  ] =
    await Promise.all([
      getHumanCreditBalance(user.id),
      getLinkedAgentsForHuman(user.id),
      listComputerUseDevicesForHuman(user.id),
      getActiveHumanDevicePairingCodes(user.id),
      listCreditLedgerEntries(user.id, 20),
      getHumanFulfillmentRatingStats(user.id),
      getHumanReferralStats(user.id),
      listMarketServicesForOwner({ ownerHumanUserId: user.id, limit: 100 }),
    ]);

  return (
    <>
      <DashboardClient
        user={user}
        referralLink={`${baseUrl}/login?ref=${user.id}`}
        referralStats={referralStats}
        balanceCents={balanceCents}
        linkedAgents={linkedAgents}
        devices={devices}
        pairingCodes={pairingCodes}
        ledger={ledger}
        fulfillmentStats={fulfillmentStats}
      />
      <DashboardMarketServicesClient
        marketServices={marketServices}
        linkedAgents={linkedAgents}
        devices={devices}
      />
    </>
  );
}
