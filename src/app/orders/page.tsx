import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentHumanUser } from "@/lib/human-session";
import {
  listGenericBrowserTasksRelatedToHuman,
  type GenericBrowserTaskRecord,
} from "@/lib/generic-browser-tasks";

export const dynamic = "force-dynamic";

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function displayTaskStatus(status: string) {
  if (status === "awaiting_agent_clarification") return "awaiting clarification";
  return status;
}

function displayTaskSummary(task: GenericBrowserTaskRecord) {
  if (task.pickup_summary?.trim()) return task.pickup_summary.trim();
  if (task.tracking_summary?.trim()) return task.tracking_summary.trim();
  if (task.summary?.trim()) return task.summary.trim();
  if (task.error?.trim()) return task.error.trim();
  if (task.status === "completed") return "Completed successfully.";
  if (task.status === "failed") return "This order failed before OttoAuth returned a summary.";
  return "Still in progress.";
}

function OrderList(props: {
  tasks: GenericBrowserTaskRecord[];
}) {
  if (props.tasks.length === 0) {
    return (
      <article className="dashboard-card">
        <div className="supported-accounts-title">Submitted Orders</div>
        <div className="dashboard-empty">
          You have not submitted any browser orders yet.
        </div>
      </article>
    );
  }

  return (
    <article className="dashboard-card">
      <div className="dashboard-section-header">
        <div className="supported-accounts-title">Submitted Orders</div>
        <div className="dashboard-muted">
          {props.tasks.length} order{props.tasks.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="dashboard-list">
        {props.tasks.map((task) => (
          <Link key={task.id} href={`/orders/${task.id}`} className="dashboard-task">
            <div className="dashboard-row">
              <div>
                <strong>{task.task_title || task.task_prompt}</strong>
                <div className="dashboard-muted">{displayTaskSummary(task)}</div>
              </div>
              <span className={`status-chip status-${task.status}`}>
                {displayTaskStatus(task.status)}
              </span>
            </div>
            <div className="dashboard-task-meta">
              <span>Created {new Date(task.created_at).toLocaleString()}</span>
              {task.completed_at ? (
                <span>Completed {new Date(task.completed_at).toLocaleString()}</span>
              ) : null}
              {task.merchant ? <span>{task.merchant}</span> : null}
              {task.pickup_details?.order_number ? (
                <span>Order {task.pickup_details.order_number}</span>
              ) : null}
              {task.pickup_details?.confirmation_code ? (
                <span>Confirmation {task.pickup_details.confirmation_code}</span>
              ) : null}
              {task.pickup_details?.pickup_code ? (
                <span>Pickup code {task.pickup_details.pickup_code}</span>
              ) : null}
              {task.pickup_details?.ready_time ? (
                <span>Ready {task.pickup_details.ready_time}</span>
              ) : null}
              {task.tracking_details?.tracking_number ? (
                <span>Tracking {task.tracking_details.tracking_number}</span>
              ) : null}
              <span>Total {fmtUsd(task.total_cents || 0)}</span>
            </div>
          </Link>
        ))}
      </div>
    </article>
  );
}

export default async function OrdersIndexPage() {
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect("/login");
  }

  const tasks = await listGenericBrowserTasksRelatedToHuman(user.id, 100);
  const submittedTasks = tasks.filter((task) => task.human_user_id === user.id);

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Orders</div>
            <h1>Your submitted orders</h1>
            <p className="lede">
              Open any order to see the receipt, order number, pickup code, tracking details, and the full fulfillment record.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button primary" href="/orders/new">
              New order
            </Link>
            <Link className="auth-button" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>

        <OrderList tasks={submittedTasks} />
      </section>
    </main>
  );
}
