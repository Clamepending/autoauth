import { notFound } from "next/navigation";

import { AdminCopyDebugButton } from "@/app/admindash/admin-copy-debug-button";
import { AdminCopyOrderButton } from "@/app/admindash/admin-copy-order-button";
import { AdminRestartOrderButton } from "@/app/admindash/admin-restart-order-button";
import { getAdminOrderDetailData } from "@/lib/admin-order-detail";

export const dynamic = "force-dynamic";

type PageProps = {
  params: {
    taskId: string;
  };
};

function fmtMoney(cents: number | null | undefined) {
  if (cents == null) return "balance";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function compact(value: string | null | undefined, max = 220) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "No details recorded.";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function statusTone(status: string) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "awaiting_agent_clarification") return "warning";
  if (status === "running") return "info";
  return "neutral";
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
      <strong className={mono ? "mono" : undefined}>{value == null || value === "" ? "none" : value}</strong>
    </div>
  );
}

export default async function AdminOrderDetailPage({ params }: PageProps) {
  const data = await getAdminOrderDetailData(params.taskId);
  if (!data) notFound();

  const { task, requester, fulfiller, run, computeruseTask, runEvents, snapshots } = data;
  const result = parseJson(task.result_json);
  const usage = parseJson(task.usage_json);
  const latestSnapshot = snapshots[0] ?? null;

  return (
    <main className="admin-control-plane">
      <div className="admin-shell">
        <header className="admin-page-header">
          <div>
            <span className="admin-eyebrow">Order detail</span>
            <h1>Order #{task.id}</h1>
            <p>{compact(task.task_title || task.task_prompt, 180)}</p>
          </div>
          <nav className="admin-header-actions" aria-label="Order admin navigation">
            <a className="admin-button" href="/admindash">Admin dashboard</a>
            <a className="admin-button" href={`/orders/${task.id}`}>Human view</a>
            <AdminCopyOrderButton taskId={task.id} />
            {task.status !== "completed" ? (
              <AdminRestartOrderButton taskId={task.id} />
            ) : null}
          </nav>
        </header>

        <section className="admin-detail-grid">
          <article className="admin-panel admin-detail-main">
            <div className="admin-panel-header">
              <div>
                <h2>Current state</h2>
                <p>Requester, fulfillment, billing, and task identifiers.</p>
              </div>
              <span className={`admin-status ${statusTone(task.status)}`}>
                {task.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="admin-fact-grid">
              <Fact label="Requester" value={requester?.email || requester?.display_name || `Human #${task.human_user_id}`} />
              <Fact label="Fulfiller" value={fulfiller?.email || fulfiller?.display_name || task.fulfiller_human_user_id} />
              <Fact label="Submission" value={task.submission_source} />
              <Fact label="Agent" value={task.agent_username_lower} mono />
              <Fact label="Device" value={task.device_id} mono />
              <Fact label="Computer-use task" value={task.computeruse_task_id} mono />
              <Fact label="Run" value={task.run_id} mono />
              <Fact label="Created" value={fmtDate(task.created_at)} />
              <Fact label="Updated" value={fmtDate(task.updated_at)} />
              <Fact label="Completed" value={fmtDate(task.completed_at)} />
              <Fact label="Spend cap" value={fmtMoney(task.max_charge_cents)} />
              <Fact label="Debited" value={fmtMoney(task.total_cents)} />
            </div>
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Controls</h2>
                <p>Copy creates a fresh order and leaves this one unchanged. Restart cancels in-flight work first.</p>
              </div>
            </div>
            <div className="admin-control-stack">
              <AdminCopyOrderButton taskId={task.id} />
              {task.status !== "completed" ? (
                <AdminRestartOrderButton taskId={task.id} />
              ) : (
                <p className="admin-empty">Completed orders cannot be restarted. Use Copy as new order.</p>
              )}
            </div>
          </article>
        </section>

        <section className="admin-two-column">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Original request</h2>
                <p>The exact task intent that will be reused by Copy as new order.</p>
              </div>
            </div>
            <pre className="admin-code-block">{task.task_prompt}</pre>
            {task.website_url || task.shipping_address ? (
              <div className="admin-fact-grid compact">
                <Fact label="Website" value={task.website_url} mono />
                <Fact label="Shipping address" value={task.shipping_address} />
              </div>
            ) : null}
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Result and billing</h2>
                <p>Final output, error state, pickup/tracking, and token usage.</p>
              </div>
            </div>
            <div className="admin-fact-grid compact">
              <Fact label="Billing status" value={task.billing_status} />
              <Fact label="Payout status" value={task.payout_status} />
              <Fact label="Merchant" value={task.merchant} />
              <Fact label="Pickup" value={task.pickup_summary} />
              <Fact label="Tracking" value={task.tracking_summary} />
              <Fact label="Rating" value={task.requester_rating} />
            </div>
            {task.summary || task.error ? (
              <div className="admin-result-stack">
                {task.summary ? <p><strong>Summary:</strong> {task.summary}</p> : null}
                {task.error ? <p className="danger-text"><strong>Error:</strong> {task.error}</p> : null}
              </div>
            ) : null}
          </article>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-header">
            <div>
              <h2>Codex debug bundle</h2>
              <p>Copy this whole bundle into Codex when you want help debugging the order path.</p>
            </div>
            <AdminCopyDebugButton text={data.debugBundle} />
          </div>
          <textarea className="admin-debug-textarea" readOnly value={data.debugBundle} />
        </section>

        <section className="admin-two-column">
          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Computer-use run</h2>
                <p>Run state and current task payload.</p>
              </div>
            </div>
            <pre className="admin-code-block">{pretty({ run, computeruse_task: computeruseTask })}</pre>
          </article>

          <article className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Raw result</h2>
                <p>Parsed result and model usage payloads.</p>
              </div>
            </div>
            <pre className="admin-code-block">{pretty({ result, usage })}</pre>
          </article>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-header">
            <div>
              <h2>Run event timeline</h2>
              <p>{runEvents.length} events, oldest first.</p>
            </div>
          </div>
          {runEvents.length === 0 ? (
            <p className="admin-empty">No run events recorded.</p>
          ) : (
            <div className="admin-timeline">
              {runEvents.map((event) => (
                <article key={event.id}>
                  <div>
                    <strong>{event.type}</strong>
                    <time>{fmtDate(event.created_at)}</time>
                  </div>
                  <pre>{pretty(event.data)}</pre>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-header">
            <div>
              <h2>Snapshots</h2>
              <p>Latest browser screenshots and tab metadata from the fulfillment device.</p>
            </div>
          </div>
          {snapshots.length === 0 ? (
            <p className="admin-empty">No snapshots recorded for this order.</p>
          ) : (
            <div className="admin-snapshot-grid">
              {latestSnapshot ? (
                <figure className="admin-snapshot-primary">
                  <img
                    src={`data:image/png;base64,${latestSnapshot.image_base64}`}
                    alt={`Latest snapshot for order ${task.id}`}
                  />
                  <figcaption>
                    Latest snapshot · {fmtDate(latestSnapshot.created_at)}
                  </figcaption>
                </figure>
              ) : null}
              <div className="admin-snapshot-list">
                {snapshots.map((snapshot) => (
                  <article key={snapshot.id}>
                    <strong>Snapshot #{snapshot.id}</strong>
                    <span>{fmtDate(snapshot.created_at)} · {snapshot.width || "?"}x{snapshot.height || "?"}</span>
                    {snapshot.tabs.length > 0 ? (
                      <pre>{pretty(snapshot.tabs)}</pre>
                    ) : (
                      <p className="admin-subtle">No tab metadata.</p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        <footer className="admin-footer">
          Generated {fmtDate(data.generated_at)}.
        </footer>
      </div>
    </main>
  );
}
