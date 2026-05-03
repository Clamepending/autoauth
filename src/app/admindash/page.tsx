import type { CSSProperties } from "react";

import { AdminRestartOrderButton } from "@/app/admindash/admin-restart-order-button";
import {
  getAdminControlPlaneData,
  type AdminAgentRow,
  type AdminDailyBucket,
  type AdminDeviceRow,
  type AdminOrderRow,
  type AdminSignupRow,
} from "@/lib/admin-analytics";

export const dynamic = "force-dynamic";

function fmtInt(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value || 0));
}

function fmtMoney(cents: number | null | undefined) {
  const dollars = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dollars >= 100 ? 0 : 2,
  }).format(dollars);
}

function fmtPercent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
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

function fmtShortDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function fmtAge(minutes: number) {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  return `${Math.round(hours / 24)}d`;
}

function compact(value: string | null | undefined, max = 130) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "No details recorded.";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function shortToken(value: string | null | undefined) {
  if (!value) return "none";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-5)}`;
}

function hostFromUrl(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function statusTone(status: string) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "awaiting_agent_clarification") return "warning";
  if (status === "running") return "info";
  return "neutral";
}

function KpiCard(props: {
  label: string;
  value: string;
  detail: string;
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
}) {
  return (
    <article className={`admin-kpi-card ${props.tone ?? "neutral"}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function DualBarChart({
  buckets,
  leftKey,
  rightKey,
  leftLabel,
  rightLabel,
}: {
  buckets: AdminDailyBucket[];
  leftKey: "signups" | "orders" | "completed" | "failed" | "active";
  rightKey: "signups" | "orders" | "completed" | "failed" | "active";
  leftLabel: string;
  rightLabel: string;
}) {
  const max = Math.max(
    1,
    ...buckets.map((bucket) => Math.max(bucket[leftKey], bucket[rightKey])),
  );
  return (
    <div className="admin-bar-chart" role="img" aria-label={`${leftLabel} and ${rightLabel} by day`}>
      {buckets.map((bucket) => (
        <div key={bucket.day} className="admin-bar-day" title={`${bucket.day}: ${bucket[leftKey]} ${leftLabel}, ${bucket[rightKey]} ${rightLabel}`}>
          <div className="admin-bar-track">
            <span
              className="admin-bar-fill primary"
              style={{ height: `${Math.max(4, (bucket[leftKey] / max) * 100)}%` }}
            />
            <span
              className="admin-bar-fill secondary"
              style={{ height: `${Math.max(4, (bucket[rightKey] / max) * 100)}%` }}
            />
          </div>
          <time>{fmtShortDay(bucket.day)}</time>
        </div>
      ))}
    </div>
  );
}

function MoneyFailureChart({ buckets }: { buckets: AdminDailyBucket[] }) {
  const maxMoney = Math.max(1, ...buckets.map((bucket) => bucket.debited_cents));
  const maxFailures = Math.max(1, ...buckets.map((bucket) => bucket.failed));
  return (
    <div className="admin-money-chart" role="img" aria-label="Credits moved and failed orders by day">
      {buckets.map((bucket) => {
        const moneyHeight = Math.max(4, (bucket.debited_cents / maxMoney) * 100);
        const failureHeight = Math.max(4, (bucket.failed / maxFailures) * 100);
        return (
          <div key={bucket.day} className="admin-money-day" title={`${bucket.day}: ${fmtMoney(bucket.debited_cents)} debited, ${bucket.failed} failed`}>
            <span
              className="admin-money-fill"
              style={{ "--money-height": `${moneyHeight}%` } as CSSProperties}
            />
            <span
              className="admin-failure-dot"
              style={{ bottom: `${failureHeight}%` }}
            />
            <time>{fmtShortDay(bucket.day)}</time>
          </div>
        );
      })}
    </div>
  );
}

function DistributionList({
  rows,
  total,
  label,
}: {
  rows: Array<{ status?: string; source?: string; count: number }>;
  total: number;
  label: "status" | "source";
}) {
  if (rows.length === 0) {
    return <p className="admin-empty">No orders yet.</p>;
  }
  return (
    <div className="admin-distribution-list">
      {rows.map((row) => {
        const name = row[label] || "unknown";
        const pct = total ? (row.count / total) * 100 : 0;
        return (
          <div key={name} className="admin-distribution-row">
            <span>{name.replace(/_/g, " ")}</span>
            <div className="admin-distribution-track">
              <i style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <strong>{fmtInt(row.count)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function OrderTable({
  orders,
  empty,
}: {
  orders: AdminOrderRow[];
  empty: string;
}) {
  if (orders.length === 0) {
    return <p className="admin-empty">{empty}</p>;
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Status</th>
            <th>Requester</th>
            <th>Task</th>
            <th>Device</th>
            <th>Money</th>
            <th>Age</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <a className="admin-link-strong" href={`/admindash/orders/${order.id}`}>#{order.id}</a>
                <div className="admin-subtle">{order.submission_source}</div>
              </td>
              <td>
                <span className={`admin-status ${statusTone(order.status)}`}>
                  {order.status.replace(/_/g, " ")}
                </span>
                {order.issue_flags.length > 0 ? (
                  <div className="admin-flag-row">
                    {order.issue_flags.map((flag) => (
                      <span key={flag}>{flag}</span>
                    ))}
                  </div>
                ) : null}
              </td>
              <td>
                <strong>{order.human_label}</strong>
                <div className="admin-subtle">{order.agent_username_lower || "no agent"}</div>
              </td>
              <td className="admin-task-cell">
                <strong>{compact(order.title, 72)}</strong>
                <div>{compact(order.error || order.summary || order.prompt, 150)}</div>
                {order.website_url ? (
                  <a className="admin-mini-link" href={order.website_url} target="_blank" rel="noreferrer">
                    {hostFromUrl(order.website_url)}
                  </a>
                ) : null}
              </td>
              <td>
                <code>{shortToken(order.device_id)}</code>
                <div className="admin-subtle">task {shortToken(order.computeruse_task_id)}</div>
              </td>
              <td>
                <strong>{fmtMoney(order.total_cents)}</strong>
                <div className="admin-subtle">cap {order.max_charge_cents == null ? "balance" : fmtMoney(order.max_charge_cents)}</div>
              </td>
              <td>
                <strong>{fmtAge(order.age_minutes)}</strong>
                <div className="admin-subtle">updated {fmtAge(order.updated_minutes_ago)} ago</div>
              </td>
              <td>
                {order.can_restart ? (
                  <AdminRestartOrderButton taskId={order.id} />
                ) : (
                  <span className="admin-subtle">Final</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignupTable({ signups }: { signups: AdminSignupRow[] }) {
  if (signups.length === 0) return <p className="admin-empty">No human signups yet.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table compact">
        <thead>
          <tr>
            <th>Human</th>
            <th>Signed up</th>
            <th>Agent keys</th>
            <th>Orders</th>
            <th>Balance</th>
            <th>Last order</th>
          </tr>
        </thead>
        <tbody>
          {signups.map((signup) => (
            <tr key={signup.id}>
              <td>
                <strong>{signup.label}</strong>
                <div className="admin-subtle">{signup.email || `Human #${signup.id}`}</div>
              </td>
              <td>{fmtDate(signup.created_at)}</td>
              <td>{fmtInt(signup.linked_agents)}</td>
              <td>
                <strong>{fmtInt(signup.orders)}</strong>
                {signup.failed_orders ? (
                  <div className="admin-subtle danger-text">{fmtInt(signup.failed_orders)} failed</div>
                ) : null}
              </td>
              <td>{fmtMoney(signup.balance_cents)}</td>
              <td>{fmtDate(signup.last_order_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeviceTable({ devices }: { devices: AdminDeviceRow[] }) {
  if (devices.length === 0) return <p className="admin-empty">No paired fulfillment devices yet.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table compact">
        <thead>
          <tr>
            <th>Device</th>
            <th>Owner</th>
            <th>Mode</th>
            <th>Queue</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.device_id}>
              <td>
                <code>{shortToken(device.device_id)}</code>
                <div className="admin-subtle">{device.label || "No label"}</div>
              </td>
              <td>{device.owner_label}</td>
              <td>
                <span className={`admin-status ${device.online ? "success" : "neutral"}`}>
                  {device.online ? "online" : "offline"}
                </span>
                <div className="admin-subtle">
                  {device.marketplace_enabled ? "marketplace enabled" : "private"}
                </div>
              </td>
              <td>
                {fmtInt(device.queued_tasks)} queued
                <div className="admin-subtle">{fmtInt(device.delivered_tasks)} delivered</div>
              </td>
              <td>
                {fmtDate(device.last_seen_at)}
                {device.failed_tasks_24h ? (
                  <div className="admin-subtle danger-text">{fmtInt(device.failed_tasks_24h)} failed in 24h</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentTable({ agents }: { agents: AdminAgentRow[] }) {
  if (agents.length === 0) return <p className="admin-empty">No agent API keys registered yet.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table compact">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Linked humans</th>
            <th>Orders</th>
            <th>Failure rate</th>
            <th>Spend</th>
            <th>Last order</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.id}>
              <td>
                <strong>{agent.username_display}</strong>
                <div className="admin-subtle">{agent.callback_url ? "webhook configured" : "no webhook"}</div>
              </td>
              <td>{fmtInt(agent.linked_humans)}</td>
              <td>{fmtInt(agent.order_count)}</td>
              <td>{fmtPercent(agent.failed_orders, agent.order_count)}</td>
              <td>{fmtMoney(agent.total_spent_cents)}</td>
              <td>{fmtDate(agent.last_order_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminDashPage() {
  const data = await getAdminControlPlaneData();
  const { summary } = data;
  const problemPressure =
    summary.failed_24h +
    summary.stuck_orders +
    summary.clarification_orders +
    summary.callback_failures;
  const conversionRate = fmtPercent(summary.completed_orders, summary.orders_total);
  const failureRate = fmtPercent(summary.failed_orders, summary.orders_total);
  const pendingRequests = data.requests
    .filter((request) => request.status === "pending" || request.status === "notify_failed")
    .slice(0, 8);

  return (
    <main className="admin-control-plane">
      <div className="admin-shell">
        <header className="admin-page-header">
          <div>
            <span className="admin-eyebrow">Operations</span>
            <h1>Admin control plane</h1>
            <p>
              Orders, signups, credits, fulfillment devices, agent keys, and restart controls in one place.
            </p>
          </div>
          <nav className="admin-header-actions" aria-label="Admin navigation">
            <a className="admin-button" href="/admindash">Refresh</a>
            <a className="admin-button" href="/orders">Orders</a>
            <a className="admin-button" href="/dashboard">Human dashboard</a>
          </nav>
        </header>

        <section className="admin-kpi-grid" aria-label="Top-level metrics">
          <KpiCard
            label="Humans"
            value={fmtInt(summary.humans_total)}
            detail={`${fmtInt(summary.humans_7d)} signups in 7d, ${fmtInt(summary.humans_24h)} in 24h`}
            tone="info"
          />
          <KpiCard
            label="Orders"
            value={fmtInt(summary.orders_total)}
            detail={`${conversionRate} completed, ${failureRate} failed`}
            tone="success"
          />
          <KpiCard
            label="Active queue"
            value={fmtInt(summary.active_orders)}
            detail={`${fmtInt(summary.stuck_orders)} stuck, ${fmtInt(summary.clarification_orders)} awaiting clarification`}
            tone={summary.stuck_orders ? "warning" : "neutral"}
          />
          <KpiCard
            label="Problem pressure"
            value={fmtInt(problemPressure)}
            detail={`${fmtInt(summary.failed_24h)} failures in 24h, ${fmtInt(summary.callback_failures)} callback failures`}
            tone={problemPressure ? "danger" : "success"}
          />
          <KpiCard
            label="Credits moved"
            value={fmtMoney(summary.total_debited_cents)}
            detail={`${fmtMoney(summary.debited_7d_cents)} in 7d, ${fmtMoney(summary.outstanding_balance_cents)} balances`}
            tone="info"
          />
          <KpiCard
            label="Device fleet"
            value={`${fmtInt(summary.device_online)} / ${fmtInt(summary.device_total)}`}
            detail={`${fmtInt(summary.device_marketplace)} marketplace, ${fmtInt(summary.computeruse_queued)} queued tasks`}
            tone={summary.device_online ? "success" : "warning"}
          />
        </section>

        <section className="admin-chart-grid" aria-label="Analytics charts">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Signups and orders</h2>
                <p>Last 14 days, daily volume.</p>
              </div>
              <div className="admin-legend">
                <span><i className="primary" /> Signups</span>
                <span><i className="secondary" /> Orders</span>
              </div>
            </div>
            <DualBarChart
              buckets={data.daily}
              leftKey="signups"
              rightKey="orders"
              leftLabel="signups"
              rightLabel="orders"
            />
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Credits and failures</h2>
                <p>Daily debits with failure markers.</p>
              </div>
              <div className="admin-legend">
                <span><i className="money" /> Credits</span>
                <span><i className="danger" /> Failed</span>
              </div>
            </div>
            <MoneyFailureChart buckets={data.daily} />
          </article>
        </section>

        <section className="admin-ops-grid">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Operational health</h2>
                <p>Signals that usually mean someone is stuck.</p>
              </div>
            </div>
            <div className="admin-health-grid">
              <div>
                <span>Avg completion</span>
                <strong>{summary.avg_minutes_to_complete.toFixed(summary.avg_minutes_to_complete >= 10 ? 0 : 1)}m</strong>
              </div>
              <div>
                <span>Computer-use delivered</span>
                <strong>{fmtInt(summary.computeruse_delivered)}</strong>
              </div>
              <div>
                <span>Device task failures 24h</span>
                <strong>{fmtInt(summary.computeruse_failed_24h)}</strong>
              </div>
              <div>
                <span>Agent requests</span>
                <strong>{fmtInt(summary.pending_requests)}</strong>
              </div>
            </div>
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Order mix</h2>
                <p>Status and source breakdown.</p>
              </div>
            </div>
            <div className="admin-distribution-grid">
              <DistributionList rows={data.status_counts} total={summary.orders_total} label="status" />
              <DistributionList rows={data.source_counts} total={summary.orders_total} label="source" />
            </div>
          </article>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-header">
            <div>
              <h2>Problem orders</h2>
              <p>Failed, stuck, clarification-blocked, or callback-failed orders. Restart queues a replacement order with the same intent and spend cap.</p>
            </div>
          </div>
          <OrderTable
            orders={data.problem_orders}
            empty="No problem orders right now."
          />
        </section>

        <section className="admin-panel">
          <div className="admin-panel-header">
            <div>
              <h2>Recent orders</h2>
              <p>Latest order traffic across human and agent submissions.</p>
            </div>
          </div>
          <OrderTable
            orders={data.recent_orders.slice(0, 30)}
            empty="No orders have been submitted yet."
          />
        </section>

        <section className="admin-two-column">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Recent signups</h2>
                <p>Who joined, whether they linked agents, and whether they ordered.</p>
              </div>
            </div>
            <SignupTable signups={data.recent_signups} />
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Fulfillment devices</h2>
                <p>Claimed devices, marketplace availability, and queue pressure.</p>
              </div>
            </div>
            <DeviceTable devices={data.devices} />
          </article>
        </section>

        <section className="admin-two-column">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Agent API keys</h2>
                <p>Usage and reliability by developer agent.</p>
              </div>
            </div>
            <AgentTable agents={data.top_agents} />
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Agent request queue</h2>
                <p>Pending or webhook-failed legacy human service requests.</p>
              </div>
            </div>
            {pendingRequests.length === 0 ? (
              <p className="admin-empty">No pending agent requests.</p>
            ) : (
              <div className="admin-request-list">
                {pendingRequests.map((request) => (
                  <article key={request.id}>
                    <div>
                      <strong>#{request.id} {request.request_type}</strong>
                      <span className={`admin-status ${request.status === "notify_failed" ? "danger" : "warning"}`}>
                        {request.status}
                      </span>
                    </div>
                    <p>{compact(request.message, 160)}</p>
                    <small>
                      {request.username_display} · {fmtDate(request.created_at)}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        <footer className="admin-footer">
          Generated {fmtDate(data.generated_at)}. Metrics are read directly from production tables.
        </footer>
      </div>
    </main>
  );
}
