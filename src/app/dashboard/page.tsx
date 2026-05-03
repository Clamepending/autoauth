import { redirect } from "next/navigation";
import { DashboardClient } from "./dashboard-client";
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
    referralStats,
  ] = await Promise.all([
    getHumanCreditBalance(user.id),
    getLinkedAgentsForHuman(user.id),
    listComputerUseDevicesForHuman(user.id),
    getActiveHumanDevicePairingCodes(user.id),
    listCreditLedgerEntries(user.id, 20),
    getHumanReferralStats(user.id),
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
        serverUrl={baseUrl}
        agentSkillCommand={`curl -s ${baseUrl}/skill.md`}
      />
    </>
  );
}
