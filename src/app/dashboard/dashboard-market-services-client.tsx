"use client";

import Link from "next/link";
import { useState } from "react";
import type { ComputerUseDeviceRecord } from "@/lib/computeruse-store";
import type { HumanAgentLinkWithAgentRecord } from "@/lib/human-accounts";
import type { MarketServiceRecord } from "@/lib/market-services";

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function DashboardMarketServicesClient(props: {
  marketServices: MarketServiceRecord[];
  linkedAgents: HumanAgentLinkWithAgentRecord[];
  devices: ComputerUseDeviceRecord[];
}) {
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabledDeviceCount = props.devices.filter((device) => device.marketplace_enabled).length;

  async function handlePublishStandardServices() {
    setPublishing(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/market/standard-fulfillment/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Could not list standard services.");
        return;
      }
      setMessage(
        `Listed ${payload?.services?.length ?? 4} services for ${payload?.agent?.username_display || "your agent"}.`,
      );
      window.location.reload();
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <section className="dashboard-grid wide">
          <article className="dashboard-card dashboard-card-span-2">
            <div className="dashboard-section-header">
              <div>
                <div className="supported-accounts-title">Services You&apos;re Selling</div>
                <p className="dashboard-muted">
                  Publish your Pi/browser fulfiller as buyer-facing Market services, then manage every service your account owns here.
                </p>
              </div>
              <div className="dashboard-actions">
                <button
                  className="auth-button primary"
                  type="button"
                  onClick={handlePublishStandardServices}
                  disabled={publishing || props.linkedAgents.length === 0}
                >
                  {publishing ? "Listing..." : "List Pi services"}
                </button>
                <Link className="auth-button" href="/market/new">
                  Publish custom
                </Link>
                <Link className="auth-button" href="/market">
                  Open Market
                </Link>
              </div>
            </div>

            {message && <div className="auth-success">{message}</div>}
            {error && <div className="auth-error">{error}</div>}

            {props.linkedAgents.length === 0 && (
              <p className="dashboard-muted">
                Link an agent first, then you can list standard Snackpass, Instacart, Amazon, and Grubhub services.
              </p>
            )}
            {props.linkedAgents.length > 0 && enabledDeviceCount === 0 && (
              <p className="dashboard-muted">
                You have linked agents, but no enabled fulfillment device. Enable your Pi/browser device above so these services can receive orders.
              </p>
            )}

            <div className="dashboard-list">
              {props.marketServices.length === 0 ? (
                <div className="dashboard-empty">
                  You are not selling any Market services yet. Use “List Pi services” to publish the four standard browser fulfillment offerings.
                </div>
              ) : (
                props.marketServices.map((service) => (
                  <div key={service.id} className="dashboard-row">
                    <div>
                      <strong>{service.name}</strong>
                      <div className="dashboard-muted mono">{service.capability}</div>
                      <div className="dashboard-muted">
                        Provider {service.owner_agent_username_lower ? `@${service.owner_agent_username_lower}` : `Human #${service.owner_human_user_id}`} · {service.status} · {service.visibility}
                      </div>
                    </div>
                    <div className="dashboard-device-actions">
                      <div className="dashboard-muted">
                        {fmtUsd(service.price_cents)} service fee · {service.call_count} call{service.call_count === 1 ? "" : "s"}
                      </div>
                      <Link className="auth-button" href={`/market/services/${service.id}`}>
                        View
                      </Link>
                      <Link className="auth-button" href={`/market/services/${service.id}/edit`}>
                        Edit
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
