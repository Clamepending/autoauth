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
import { listAgentSpendTotalsForHuman } from "@/lib/generic-browser-tasks";
import { isUserFulfillmentEnabled } from "@/lib/user-fulfillment-config";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const baseUrl = getBaseUrl();
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect("/login");
  }

  const showUserFulfillmentControls = isUserFulfillmentEnabled();
  const [
    balanceCents,
    ledger,
    linkedAgents,
    devices,
    pairingCodes,
    referralStats,
    agentSpendTotals,
  ] = await Promise.all([
    getHumanCreditBalance(user.id),
    listCreditLedgerEntries(user.id, 20),
    getLinkedAgentsForHuman(user.id),
    showUserFulfillmentControls ? listComputerUseDevicesForHuman(user.id) : Promise.resolve([]),
    showUserFulfillmentControls ? getActiveHumanDevicePairingCodes(user.id) : Promise.resolve([]),
    getHumanReferralStats(user.id),
    listAgentSpendTotalsForHuman(user.id),
  ]);
  const spendByAgentId = new Map(
    agentSpendTotals.map((entry) => [entry.agent_id, entry.total_spent_cents]),
  );
  const linkedAgentsWithSpend = linkedAgents.map((agent) => ({
    ...agent,
    total_spent_cents: spendByAgentId.get(agent.agent_id) ?? 0,
  }));

  return (
    <>
      <DashboardClient
        user={user}
        referralLink={`${baseUrl}/login?ref=${user.id}`}
        referralStats={referralStats}
        balanceCents={balanceCents}
        linkedAgents={linkedAgentsWithSpend}
        devices={devices}
        pairingCodes={pairingCodes}
        ledger={ledger}
        serverUrl={baseUrl}
        agentSkillCommand={`curl -s ${baseUrl}/skill.md`}
        showUserFulfillmentControls={showUserFulfillmentControls}
      />
    </>
  );
}
