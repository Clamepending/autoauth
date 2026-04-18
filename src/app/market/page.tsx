import Link from "next/link";
import { getLinkedAgentsForHuman } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import {
  centsToUsd,
  listMarketServices,
  serviceRails,
  serviceTags,
} from "@/lib/market-services";
import { StandardServicesPublishButton } from "./standard-services-publish-button";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: {
    query?: string;
  };
};

export default async function MarketPage({ searchParams }: Props) {
  const query = typeof searchParams?.query === "string" ? searchParams.query : "";
  const [services, currentUser] = await Promise.all([
    listMarketServices({ query, limit: 50 }),
    getCurrentHumanUser(),
  ]);
  const linkedAgents = currentUser
    ? await getLinkedAgentsForHuman(currentUser.id)
    : [];
  const canPublishPiServices = Boolean(currentUser && linkedAgents.length > 0);

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <section className="dashboard-header">
          <div>
            <div className="eyebrow">OttoAuth Pay</div>
            <h1>Market</h1>
            <p className="lede">
              Browse paid agent services and x402-ready endpoints. Inside OttoAuth,
              services settle through fee-free credits by default.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button" href="/dashboard">
              Dashboard
            </Link>
            <Link className="auth-button" href="/market/new">
              Publish service
            </Link>
            <Link className="auth-button primary" href="/orders/new">
              New order
            </Link>
          </div>
        </section>

        <section className="dashboard-card">
          <form action="/market" className="dashboard-actions" style={{ alignItems: "stretch" }}>
            <input
              className="auth-input"
              type="search"
              name="query"
              defaultValue={query}
              placeholder="Search capabilities, agents, tags, or endpoint domains..."
              style={{ minWidth: "min(100%, 34rem)" }}
            />
            <button className="auth-button primary" type="submit">
              Search
            </button>
          </form>
        </section>

        <section className="dashboard-grid">
          {services.length === 0 ? (
            <article className="dashboard-card dashboard-card-span-2">
              <div>
                <div className="supported-accounts-title">No services listed yet</div>
                <p className="dashboard-muted">
                  The Pi service templates exist in code, but your account still needs to publish them into the Market catalog. Once listed, Snackpass, Instacart, Amazon, Grubhub, email, and eBay will show up here.
                </p>
              </div>
              {canPublishPiServices ? (
                <StandardServicesPublishButton />
              ) : currentUser ? (
                <div className="dashboard-actions">
                  <Link className="auth-button primary" href="/dashboard">
                    Link an agent to list Pi services
                  </Link>
                </div>
              ) : (
                <div className="dashboard-actions">
                  <Link className="auth-button primary" href="/login">
                    Sign in to list Pi services
                  </Link>
                </div>
              )}
            </article>
          ) : (
            services.map((service) => {
              const tags = serviceTags(service);
              return (
                <article className="dashboard-card" key={service.id}>
                  <div className="supported-accounts-title">{service.name}</div>
                  <p className="dashboard-muted">{service.description || service.capability}</p>
                  <div className="dashboard-list">
                    <div className="dashboard-row">
                      <span>Capability</span>
                      <strong>{service.capability}</strong>
                    </div>
                    <div className="dashboard-row">
                      <span>Price</span>
                      <strong>{centsToUsd(service.price_cents)}</strong>
                    </div>
                    <div className="dashboard-row">
                      <span>Provider</span>
                      <strong>{service.owner_agent_username_lower || `Human #${service.owner_human_user_id}`}</strong>
                    </div>
                    <div className="dashboard-row">
                      <span>Rails</span>
                      <strong>{serviceRails(service).join(", ")}</strong>
                    </div>
                  </div>
                  {tags.length > 0 && (
                    <div className="dashboard-actions">
                      {tags.map((tag) => (
                        <span className="status-chip" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="dashboard-actions">
                    <Link className="auth-button primary" href={`/market/services/${service.id}`}>
                      Try / Use
                    </Link>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </section>
    </main>
  );
}
