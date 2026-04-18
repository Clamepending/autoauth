import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getCurrentHumanUser } from "@/lib/human-session";
import {
  centsToUsd,
  getMarketServiceById,
  serviceRails,
  serviceTags,
} from "@/lib/market-services";
import { MarketServiceUseForm } from "./market-service-use-form";

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

function firstExampleInputJson(value: string | null) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    const first = Array.isArray(parsed) ? parsed[0] : null;
    const input =
      first && typeof first === "object" && !Array.isArray(first) && "input" in first
        ? (first as { input?: unknown }).input
        : null;
    return input ? JSON.stringify(input, null, 2) : "";
  } catch {
    return "";
  }
}

function ServiceDetailRow(props: { label: string; children: ReactNode }) {
  return (
    <div
      className="dashboard-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 7.5rem) minmax(0, 1fr)",
        alignItems: "start",
      }}
    >
      <span style={{ minWidth: 0 }}>{props.label}</span>
      <strong
        style={{
          minWidth: 0,
          overflowWrap: "anywhere",
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {props.children}
      </strong>
    </div>
  );
}

export default async function MarketServicePage({ params }: Props) {
  const serviceId = Number(params.serviceId);
  if (!Number.isInteger(serviceId) || serviceId <= 0) notFound();
  const [service, currentHuman] = await Promise.all([
    getMarketServiceById(serviceId),
    getCurrentHumanUser().catch(() => null),
  ]);
  const canEdit = currentHuman?.id === service?.owner_human_user_id;
  if (!service || (service.status !== "enabled" && !canEdit)) notFound();
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
            {canEdit && (
              <Link className="auth-button primary" href={`/market/services/${service.id}/edit`}>
                Edit service
              </Link>
            )}
          </div>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Service Details</div>
            <div className="dashboard-list">
              <ServiceDetailRow label="Capability">
                {service.capability}
              </ServiceDetailRow>
              <ServiceDetailRow label="Endpoint">
                <code>{service.endpoint_url}</code>
              </ServiceDetailRow>
              <ServiceDetailRow label="Price">
                {centsToUsd(service.price_cents)}
              </ServiceDetailRow>
              <ServiceDetailRow label="Status">
                {service.status}
              </ServiceDetailRow>
              <ServiceDetailRow label="Visibility">
                {service.visibility}
              </ServiceDetailRow>
              <ServiceDetailRow label="Rails">
                {serviceRails(service).join(", ")}
              </ServiceDetailRow>
              <ServiceDetailRow label="Provider">
                {service.owner_agent_username_lower || `Human #${service.owner_human_user_id}`}
              </ServiceDetailRow>
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

        <section className="dashboard-grid wide">
          <MarketServiceUseForm
            serviceId={service.id}
            serviceName={service.name}
            serviceCapability={service.capability}
            servicePriceCents={service.price_cents}
            currentHumanUserId={currentHuman?.id ?? null}
            isOwnPaidService={Boolean(canEdit && service.price_cents > 0)}
            exampleInputJson={firstExampleInputJson(service.examples_json)}
          />
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
