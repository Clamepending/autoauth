import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AgentMandateClient } from "./agent-mandate-client";
import {
  getAgentMandateForHumanLink,
  summarizeAgentMandate,
} from "@/lib/agent-mandates";
import { getHumanCreditBalance } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import { listOrdersForAgent } from "@/lib/order-orchestration";

type PageProps = {
  params: {
    linkId: string;
  };
};

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export const dynamic = "force-dynamic";

export default async function AgentMandatePage(props: PageProps) {
  const user = await getCurrentHumanUser();
  if (!user) redirect("/login");

  const linkId = Number(props.params.linkId?.trim() ?? "");
  if (!Number.isInteger(linkId) || linkId <= 0) notFound();

  const mandate = await getAgentMandateForHumanLink({
    humanUserId: user.id,
    linkId,
  });
  if (!mandate) notFound();

  const [orders, balanceCents] = await Promise.all([
    listOrdersForAgent(mandate.link.username_lower, 8),
    getHumanCreditBalance(user.id),
  ]);
  const capturedCents = orders.reduce(
    (total, order) => total + Math.max(0, order.captured_cents),
    0,
  );

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell agent-mandate-shell">
        <div className="agent-mandate-topbar">
          <Link className="dashboard-muted mono" href="/dashboard">
            Back to dashboard
          </Link>
          <span className="dashboard-profile-balance">
            Credits {fmtUsd(balanceCents)}
          </span>
        </div>

        <header className="agent-mandate-hero">
          <div>
            <div className="eyebrow">Agent Mandate</div>
            <h1>{mandate.link.username_display}</h1>
            <div className="dashboard-muted mono">@{mandate.link.username_lower}</div>
          </div>
          <div className="agent-mandate-summary">
            <span>{summarizeAgentMandate(mandate.policy)}</span>
          </div>
        </header>

        <section className="agent-mandate-stats" aria-label="Agent mandate status">
          <div>
            <span className="quick-fact-label">Linked</span>
            <strong>{new Date(mandate.link.linked_at).toLocaleDateString()}</strong>
          </div>
          <div>
            <span className="quick-fact-label">Recent captured</span>
            <strong>{fmtUsd(capturedCents)}</strong>
          </div>
          <div>
            <span className="quick-fact-label">Revision</span>
            <strong>{mandate.policy.active_revision || "Default"}</strong>
          </div>
        </section>

        <AgentMandateClient
          linkId={mandate.link.id}
          agentUsername={mandate.link.username_display}
          initialPolicy={mandate.policy}
          initialSummary={summarizeAgentMandate(mandate.policy)}
        />

        <section className="dashboard-card agent-mandate-orders">
          <div className="dashboard-section-header">
            <div>
              <div className="supported-accounts-title">Recent Orders</div>
              <h2 className="dashboard-card-title">Activity</h2>
            </div>
          </div>
          <div className="dashboard-list">
            {orders.length === 0 ? (
              <div className="dashboard-empty">No orders from this agent yet.</div>
            ) : (
              orders.map((order) => (
                <div
                  key={order.id}
                  className="dashboard-row dashboard-activity-link"
                >
                  <div>
                    <strong>{order.public_id}</strong>
                    <div className="dashboard-muted">
                      {order.provider_label} · {order.status}
                    </div>
                  </div>
                  <div className="dashboard-activity-side">
                    <strong>{fmtUsd(order.captured_cents || order.max_charge_cents || 0)}</strong>
                    <span className="dashboard-muted">
                      {new Date(order.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
