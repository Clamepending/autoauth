import { notFound } from "next/navigation";

import { ManualFulfillmentForm } from "@/app/admindash/fulfillment/[orderId]/manual-fulfillment-form";
import {
  getOrderByPublicIdOrId,
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

export default async function AdminFulfillmentOrderPage({ params }: PageProps) {
  const { orderId } = await params;
  const order = await getOrderByPublicIdOrId(orderId);
  if (!order) notFound();

  const apiOrder = parseOrderForApi(order);
  const packet = packetFrom(apiOrder.human_fulfillment_packet);
  const events = await listOrderEvents(order.id, 120);
  const messages = await listOrderMessages(order.id);
  const request = parseJson(order.request_json);
  const result = parseJson(order.result_json);
  const final = ["completed", "failed", "canceled"].includes(order.status);

  return (
    <main className="admin-control-plane">
      <div className="admin-shell">
        <header className="admin-page-header">
          <div>
            <span className="admin-eyebrow">Human fulfillment</span>
            <h1>{packet?.title || order.public_id}</h1>
            <p>{compact(packet?.fulfillment_goal, 180)}</p>
          </div>
          <nav className="admin-header-actions" aria-label="Fulfillment navigation">
            <a className="admin-button" href="/admindash">Admin dashboard</a>
            <a className="admin-button" href="/api/services/order/docs">API docs</a>
          </nav>
        </header>

        <section className="admin-detail-grid">
          <article className="admin-panel admin-detail-main">
            <div className="admin-panel-header">
              <div>
                <h2>Order state</h2>
                <p>Routing, payment limits, requester, and provider capability record.</p>
              </div>
              <span className={`admin-status ${statusTone(order.status)}`}>
                {order.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="admin-fact-grid">
              <Fact label="Order id" value={order.public_id} mono />
              <Fact label="Provider" value={order.provider_label} />
              <Fact label="Mode" value={order.fulfillment_mode.replace(/_/g, " ")} />
              <Fact label="Kind" value={order.kind.replace(/_/g, " ")} />
              <Fact label="Agent" value={order.agent_username_lower || "none"} mono />
              <Fact label="Human user" value={`#${order.human_user_id}`} mono />
              <Fact label="Spend cap" value={fmtMoney(order.max_charge_cents, order.currency)} />
              <Fact label="Captured" value={fmtMoney(order.captured_cents, order.currency)} />
              <Fact label="Claimed by" value={order.claimed_by_admin_email} />
              <Fact label="Claimed" value={fmtDate(order.claimed_at)} />
              <Fact label="Created" value={fmtDate(order.created_at)} />
              <Fact label="Updated" value={fmtDate(order.updated_at)} />
            </div>
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Manual result</h2>
                <p>Claim, record charges, and close out orders that do not have a native adapter.</p>
              </div>
            </div>
            <ManualFulfillmentForm
              orderId={order.public_id}
              defaultMerchant={packet?.merchant || ""}
              final={final}
            />
          </article>
        </section>

        <section className="admin-two-column">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Fulfillment packet</h2>
                <p>The normalized operator brief generated from the API request.</p>
              </div>
            </div>
            <div className="admin-fact-grid compact">
              <Fact label="Merchant" value={packet?.merchant} />
              <Fact label="Store URL" value={packet?.store_url} mono />
              <Fact label="Pickup or destination" value={packet?.pickup_location} />
              <Fact label="Shipping address" value={packet?.shipping_address} />
            </div>
            <pre className="admin-code-block">{packet?.fulfillment_goal || "No goal recorded."}</pre>
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Checklist</h2>
                <p>Provider-specific work the human operator should complete before closing.</p>
              </div>
            </div>
            {packet?.checklist.length ? (
              <ol className="admin-checklist">
                {packet.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            ) : (
              <p className="admin-empty">No checklist recorded.</p>
            )}
          </article>
        </section>

        <section className="admin-two-column">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Items</h2>
                <p>Structured items, quantities, links, and notes.</p>
              </div>
            </div>
            {packet?.items.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table compact">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Details</th>
                      <th>URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packet.items.map((item, index) => (
                      <tr key={`${item.name}:${index}`}>
                        <td><strong>{item.name}</strong></td>
                        <td>{item.quantity || "1"}</td>
                        <td>{compact(item.details, 120)}</td>
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
              <p className="admin-empty">No structured item rows.</p>
            )}
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Files and risks</h2>
                <p>CAD/manufacturing files plus operator risk notes.</p>
              </div>
            </div>
            <pre className="admin-code-block">{pretty({ files: packet?.files || [], risk_notes: packet?.risk_notes || [] })}</pre>
          </article>
        </section>

        <section className="admin-two-column">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Messages</h2>
                <p>Agent, requester, provider, and operator communication records.</p>
              </div>
            </div>
            {messages.length === 0 ? (
              <p className="admin-empty">No messages recorded.</p>
            ) : (
              <div className="admin-request-list">
                {messages.map((message) => (
                  <article key={message.id}>
                    <div>
                      <strong>{message.channel.replace(/_/g, " ")}</strong>
                      <span className={`admin-status ${message.status === "needs_human_delivery" ? "warning" : "info"}`}>
                        {message.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p>{message.body}</p>
                    <small>
                      {message.author_label || message.author_type} · {message.delivery_mode.replace(/_/g, " ")} · {fmtDate(message.created_at)}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Event timeline</h2>
                <p>{events.length} order orchestration events, oldest first.</p>
              </div>
            </div>
            {events.length === 0 ? (
              <p className="admin-empty">No events recorded.</p>
            ) : (
              <div className="admin-timeline">
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
          </article>
        </section>

        <section className="admin-two-column">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Raw request</h2>
                <p>The original API payload plus normalized fields and provider capabilities.</p>
              </div>
            </div>
            <pre className="admin-code-block">{pretty(request)}</pre>
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Raw result</h2>
                <p>Manual or provider result returned to agents through the API.</p>
              </div>
            </div>
            <pre className="admin-code-block">{pretty(result)}</pre>
          </article>
        </section>
      </div>
    </main>
  );
}
