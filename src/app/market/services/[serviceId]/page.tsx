import Link from "next/link";
import { notFound } from "next/navigation";
import {
  centsToUsd,
  getMarketServiceById,
  serviceRails,
  serviceTags,
} from "@/lib/market-services";

export const dynamic = "force-dynamic";

type Props = {
  params: {
    serviceId: string;
  };
};

function prettyJson(value: string | null) {
  if (!value) return "Not provided";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export default async function MarketServicePage({ params }: Props) {
  const serviceId = Number(params.serviceId);
  if (!Number.isInteger(serviceId) || serviceId <= 0) notFound();
  const service = await getMarketServiceById(serviceId);
  if (!service || service.status !== "enabled") notFound();
  const tags = serviceTags(service);

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <section className="dashboard-header">
          <div>
            <div className="eyebrow">Market service</div>
            <h1>{service.name}</h1>
            <p className="lede">{service.description || service.capability}</p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button" href="/market">
              Back to Market
            </Link>
          </div>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Service Details</div>
            <div className="dashboard-list">
              <div className="dashboard-row">
                <span>Capability</span>
                <strong>{service.capability}</strong>
              </div>
              <div className="dashboard-row">
                <span>Endpoint</span>
                <code>{service.endpoint_url}</code>
              </div>
              <div className="dashboard-row">
                <span>Price</span>
                <strong>{centsToUsd(service.price_cents)}</strong>
              </div>
              <div className="dashboard-row">
                <span>Rails</span>
                <strong>{serviceRails(service).join(", ")}</strong>
              </div>
              <div className="dashboard-row">
                <span>Provider</span>
                <strong>{service.owner_agent_username_lower || `Human #${service.owner_human_user_id}`}</strong>
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
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Agent Call</div>
            <p className="dashboard-muted">
              Agents call this through <code>ottoauth_use_service</code> with a max
              spend and idempotency key. OttoAuth handles policy, settlement, and
              receipts.
            </p>
            <pre className="dashboard-prewrap">{`{
  "tool": "ottoauth_use_service",
  "arguments": {
    "service_id": ${service.id},
    "input": {},
    "max_price_cents": ${service.price_cents},
    "reason": "Use ${service.capability}",
    "idempotency_key": "task-123-${service.id}"
  }
}`}</pre>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Input Schema</div>
            <pre className="dashboard-prewrap">{prettyJson(service.input_schema_json)}</pre>
          </article>
          <article className="dashboard-card">
            <div className="supported-accounts-title">Output Schema</div>
            <pre className="dashboard-prewrap">{prettyJson(service.output_schema_json)}</pre>
          </article>
          <article className="dashboard-card">
            <div className="supported-accounts-title">Examples</div>
            <pre className="dashboard-prewrap">{prettyJson(service.examples_json)}</pre>
          </article>
          <article className="dashboard-card">
            <div className="supported-accounts-title">Refund Policy</div>
            <p className="dashboard-muted">
              {service.refund_policy || "Provider did not publish a custom refund policy. Failed calls are refunded automatically."}
            </p>
          </article>
        </section>
      </section>
    </main>
  );
}
