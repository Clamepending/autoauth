import { redirect } from "next/navigation";
import { DashboardClient } from "./dashboard-client";
import { getBaseUrl } from "@/lib/base-url";
import { listComputerUseDevicesForHuman } from "@/lib/computeruse-store";
import {
  getActiveHumanDevicePairingCodes,
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
  const ledger = await listCreditLedgerEntries(user.id, 20);
  const linkedAgents = await getLinkedAgentsForHuman(user.id);
  const devices = showUserFulfillmentControls
    ? await listComputerUseDevicesForHuman(user.id)
    : [];
  const pairingCodes = showUserFulfillmentControls
    ? await getActiveHumanDevicePairingCodes(user.id)
    : [];
  const referralStats = await getHumanReferralStats(user.id);
  const agentSpendTotals = await listAgentSpendTotalsForHuman(user.id);
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
