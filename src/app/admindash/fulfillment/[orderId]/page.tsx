import { notFound } from "next/navigation";

import { ManualFulfillmentForm } from "@/app/admindash/fulfillment/[orderId]/manual-fulfillment-form";
import {
  getOrderByPublicIdOrId,
  listOrderClarifications,
  listOrderEvents,
  listOrderMessages,
  parseOrderForApi,
  type HumanFulfillmentPacket,
} from "@/lib/order-orchestration";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orderId: string }>;
};

function fmtMoney(cents: number | null | undefined, currency = "usd") {
  if (cents == null) return "none";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function compact(value: string | null | undefined, max = 220) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "No details recorded.";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function statusTone(status: string) {
  if (status === "completed") return "success";
  if (status === "failed" || status === "disputed") return "danger";
  if (status === "blocked" || status === "human_required") return "warning";
  if (status === "human_claimed" || status === "api_ordering") return "info";
  return "neutral";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function packetFrom(value: unknown): HumanFulfillmentPacket | null {
  return isRecord(value) ? (value as HumanFulfillmentPacket) : null;
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="admin-fact">
      <span>{label}</span>
      <strong className={mono ? "mono" : undefined}>
        {value == null || value === "" ? "none" : value}
      </strong>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number | null | undefined;
  tone?: "success" | "warning" | "danger" | "info";
}) {
  return (
    <div className={`admin-operator-metric${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value == null || value === "" ? "none" : value}</strong>
    </div>
  );
}

function BriefField({
  label,
  value,
  href,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  href?: string | null;
  mono?: boolean;
}) {
  const display = value == null || value === "" ? "none" : String(value);
  return (
    <div className="admin-brief-field">
      <span>{label}</span>
      {href ? (
        <a className={mono ? "mono" : undefined} href={href} target="_blank" rel="noreferrer">
          {display}
        </a>
      ) : (
        <strong className={mono ? "mono" : undefined}>{display}</strong>
      )}
    </div>
  );
}

function fileText(file: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = file[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export default async function AdminFulfillmentOrderPage({ params }: PageProps) {
  const { orderId } = await params;
  const order = await getOrderByPublicIdOrId(orderId);
  if (!order) notFound();

  const apiOrder = parseOrderForApi(order);
  const packet = packetFrom(apiOrder.human_fulfillment_packet);
  const events = await listOrderEvents(order.id, 120);
  const messages = await listOrderMessages(order.id);
  const clarifications = await listOrderClarifications(order.id);
  const request = parseJson(order.request_json);
  const result = parseJson(order.result_json);
  const final = ["completed", "failed", "canceled"].includes(order.status);
  const pricing = apiOrder.pricing;
  const statusLabel = order.status.replace(/_/g, " ");
  const modeLabel = order.fulfillment_mode.replace(/_/g, " ");
  const kindLabel = order.kind.replace(/_/g, " ");
  const items = packet?.items ?? [];
  const files = packet?.files ?? [];
  const checklist = packet?.checklist ?? [];
  const riskNotes = packet?.risk_notes ?? [];
  const openClarifications = clarifications.filter((entry) => entry.status === "open").length;
  const merchant = packet?.merchant || order.provider_label || "Merchant not recorded";
  const destination = packet?.shipping_address || packet?.pickup_location || "No destination recorded.";
  const storeUrl = packet?.store_url || "";
  const goal = packet?.fulfillment_goal || "No fulfillment goal recorded.";
  const pageTitle = packet?.merchant ? `${packet.merchant} order` : `Fulfill ${order.public_id}`;

  return (
    <main className="admin-control-plane admin-fulfillment-page">
      <div className="admin-shell admin-fulfillment-shell">
        <header className="admin-page-header admin-fulfillment-header">
          <div className="admin-fulfillment-title-block">
            <span className="admin-eyebrow">Human fulfillment</span>
            <div className="admin-fulfillment-title-row">
              <h1>{pageTitle}</h1>
              <span className={`admin-status ${statusTone(order.status)}`}>{statusLabel}</span>
            </div>
            <p>{compact(goal, 260)}</p>
          </div>
          <nav className="admin-header-actions" aria-label="Fulfillment navigation">
            <a className="admin-button" href="/admindash">Admin dashboard</a>
            <a className="admin-button" href="/api/services/order/docs">API docs</a>
          </nav>
        </header>

        <section className="admin-fulfillment-layout">
          <div className="admin-operator-main">
            <section className="admin-operator-metrics" aria-label="Order summary">
              <Metric label="Spend cap" value={fmtMoney(order.max_charge_cents, order.currency)} tone="warning" />
              <Metric label="Estimate" value={fmtMoney(pricing.estimated_total_cents, order.currency)} />
              <Metric label="Captured" value={fmtMoney(order.captured_cents, order.currency)} tone={order.captured_cents ? "success" : undefined} />
              <Metric label="Blockers" value={openClarifications} tone={openClarifications ? "danger" : "success"} />
              <Metric label="Items" value={items.length} />
              <Metric label="Updated" value={fmtDate(order.updated_at)} />
            </section>

            <article className="admin-panel admin-operator-brief">
              <div className="admin-panel-header admin-tight-header">
                <div>
                  <h2>Buy this</h2>
                  <p>Everything needed to fulfill without digging through raw payloads.</p>
                </div>
              </div>
              <div className="admin-goal-card">
                <span>Goal</span>
                <p>{goal}</p>
              </div>
              <div className="admin-brief-grid">
                <BriefField label="Merchant" value={merchant} />
                <BriefField label="Store URL" value={storeUrl || "none"} href={storeUrl || null} mono />
                <BriefField label="Destination" value={destination} />
                <BriefField label="Pricing" value={pricing.state.replace(/_/g, " ")} />
                <BriefField label="Mode" value={modeLabel} />
                <BriefField label="Kind" value={kindLabel} />
              </div>
            </article>

            <article className="admin-panel">
              <div className="admin-panel-header admin-tight-header">
                <div>
                  <h2>Items</h2>
                  <p>{items.length ? `${items.length} structured item${items.length === 1 ? "" : "s"}` : "No structured items"}</p>
                </div>
              </div>
              {items.length ? (
                <div className="admin-table-wrap admin-fulfillment-table-wrap">
                  <table className="admin-table compact admin-fulfillment-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={`${item.name}:${index}`}>
                          <td>
                            <strong>{item.name}</strong>
                            <small>{compact(item.details, 160)}</small>
                          </td>
                          <td>{item.quantity || "1"}</td>
                          <td>
                            {item.url ? (
                              <a className="admin-mini-link" href={item.url} target="_blank" rel="noreferrer">
                                open
                              </a>
                            ) : (
                              <span className="admin-subtle">none</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty">No structured item rows. Use the goal above as the source of truth.</p>
              )}
            </article>

            <section className="admin-fulfillment-two">
              <article className="admin-panel">
                <div className="admin-panel-header admin-tight-header">
                  <div>
                    <h2>Checklist</h2>
                    <p>Operator steps before closing.</p>
                  </div>
                </div>
                {checklist.length ? (
                  <ol className="admin-checklist admin-fast-checklist">
                    {checklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="admin-empty">No checklist recorded.</p>
                )}
              </article>

              <article className="admin-panel">
                <div className="admin-panel-header admin-tight-header">
                  <div>
                    <h2>Files and risk</h2>
                    <p>{files.length} files, {riskNotes.length} risk notes.</p>
                  </div>
                </div>
                {files.length ? (
                  <div className="admin-compact-list">
                    {files.map((file, index) => {
                      const url = fileText(file, ["download_url", "url"]);
                      return (
                        <div key={`${fileText(file, ["file_id", "name"]) || "file"}:${index}`}>
                          <strong>{fileText(file, ["name", "filename"]) || "attachment"}</strong>
                          <span>{fileText(file, ["purpose", "notes", "content_type"]) || "order attachment"}</span>
                          {url ? (
                            <a className="admin-mini-link" href={url} target="_blank" rel="noreferrer">
                              download
                            </a>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="admin-empty">No uploaded files.</p>
                )}
                {riskNotes.length ? (
                  <ul className="admin-risk-list">
                    {riskNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            </section>

            <section className="admin-fulfillment-two">
              <article className="admin-panel">
                <div className="admin-panel-header admin-tight-header">
                  <div>
                    <h2>Blockers</h2>
                    <p>{openClarifications ? `${openClarifications} open` : "No open clarifications"}</p>
                  </div>
                </div>
                {clarifications.length === 0 ? (
                  <p className="admin-empty">No clarifications requested.</p>
                ) : (
                  <div className="admin-request-list admin-compact-requests">
                    {clarifications.map((clarification) => (
                      <article key={clarification.id}>
                        <div>
                          <strong>{clarification.status}</strong>
                          <span className={`admin-status ${clarification.status === "open" ? "warning" : "success"}`}>
                            {fmtDate(clarification.created_at)}
                          </span>
                        </div>
                        <p>{clarification.question}</p>
                        {clarification.response ? <p>{clarification.response}</p> : null}
                      </article>
                    ))}
                  </div>
                )}
              </article>

              <article className="admin-panel">
                <div className="admin-panel-header admin-tight-header">
                  <div>
                    <h2>Messages</h2>
                    <p>{messages.length ? `${messages.length} recorded` : "No messages"}</p>
                  </div>
                </div>
                {messages.length === 0 ? (
                  <p className="admin-empty">No messages recorded.</p>
                ) : (
                  <div className="admin-request-list admin-compact-requests">
                    {messages.map((message) => (
                      <article key={message.id}>
                        <div>
                          <strong>{message.channel.replace(/_/g, " ")}</strong>
                          <span className={`admin-status ${message.status === "needs_human_delivery" ? "warning" : "info"}`}>
                            {message.status.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p>{message.body}</p>
                        <small>{message.author_label || message.author_type} - {fmtDate(message.created_at)}</small>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            </section>

            <details className="admin-panel admin-debug-details">
              <summary>
                <span>Timeline and raw payloads</span>
                <strong>{events.length} events</strong>
              </summary>
              <div className="admin-debug-grid">
                <section>
                  <h3>Event timeline</h3>
                  {events.length === 0 ? (
                    <p className="admin-empty">No events recorded.</p>
                  ) : (
                    <div className="admin-timeline admin-compact-timeline">
                      {events.map((event) => (
                        <article key={event.id}>
                          <div>
                            <strong>{event.type}</strong>
                            <time>{fmtDate(event.created_at)}</time>
                          </div>
                          <pre>{pretty(parseJson(event.payload_json))}</pre>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <h3>Raw request</h3>
                  <pre className="admin-code-block">{pretty(request)}</pre>
                </section>
                <section>
                  <h3>Raw result</h3>
                  <pre className="admin-code-block">{pretty(result)}</pre>
                </section>
              </div>
            </details>
          </div>

          <aside className="admin-operator-aside">
            <article className="admin-panel admin-manual-panel">
              <div className="admin-panel-header admin-tight-header">
                <div>
                  <h2>Close it out</h2>
                  <p>Claim, record final charge, save result.</p>
                </div>
              </div>
              <ManualFulfillmentForm
                orderId={order.public_id}
                defaultMerchant={packet?.merchant || ""}
                final={final}
              />
            </article>

            <article className="admin-panel admin-system-panel">
              <div className="admin-panel-header admin-tight-header">
                <div>
                  <h2>System record</h2>
                  <p>Identifiers and routing state.</p>
                </div>
              </div>
              <div className="admin-brief-grid single">
                <BriefField label="Order id" value={order.public_id} mono />
                <BriefField label="Provider" value={order.provider_label} />
                <BriefField label="Agent" value={order.agent_username_lower || "none"} mono />
                <BriefField label="Human user" value={`#${order.human_user_id}`} mono />
                <BriefField label="Claimed by" value={order.claimed_by_admin_email} />
                <BriefField label="Claimed" value={fmtDate(order.claimed_at)} />
                <BriefField label="Created" value={fmtDate(order.created_at)} />
              </div>
            </article>
          </aside>
        </section>
      </div>
    </main>
  );
}
