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
  if (task.summary?.trim()) return task.summary.trim();
  if (task.error?.trim()) return task.error.trim();
  if (task.status === "completed") {
    return "Completed successfully.";
  }
  if (task.status === "failed") {
    return "This task failed before the fulfiller returned a summary.";
  }
  return "Still in progress.";
}

function taskRoleLabel(task: GenericBrowserTaskRecord, humanUserId: number) {
  if (task.human_user_id === humanUserId && task.fulfiller_human_user_id === humanUserId) {
    return "Self-fulfilled";
  }
  if (task.human_user_id === humanUserId) {
    return "Submitted";
  }
  if (task.fulfiller_human_user_id === humanUserId) {
    return "Fulfilled";
  }
  return "Related";
}

function TaskListSection(props: {
  title: string;
  empty: string;
  tasks: GenericBrowserTaskRecord[];
  humanUserId: number;
}) {
  return (
    <article className="dashboard-card">
      <div className="dashboard-section-header">
        <div className="supported-accounts-title">{props.title}</div>
        <div className="dashboard-muted">
          {props.tasks.length} task{props.tasks.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="dashboard-list dashboard-feed">
        {props.tasks.length === 0 ? (
          <div className="dashboard-empty">{props.empty}</div>
        ) : (
          props.tasks.map((task) => (
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
                <span>{taskRoleLabel(task, props.humanUserId)}</span>
                <span>Created {new Date(task.created_at).toLocaleString()}</span>
                {task.completed_at ? <span>Completed {new Date(task.completed_at).toLocaleString()}</span> : null}
                <span>Total {fmtUsd(task.total_cents || 0)}</span>
                {task.merchant ? <span>{task.merchant}</span> : null}
              </div>
            </Link>
          ))
        )}
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
  const fulfilledTasks = tasks.filter(
    (task) => task.fulfiller_human_user_id === user.id && task.human_user_id !== user.id,
  );

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Orders</div>
            <h1>Your OttoAuth Tasks</h1>
            <p className="lede">
              Review submitted tasks, jump back into live order chats, and see the jobs you fulfilled for other humans.
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

        <section className="dashboard-grid metrics-grid">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Submitted</div>
            <div className="dashboard-stat">{submittedTasks.length}</div>
            <p className="dashboard-muted">
              Tasks requested by you or your linked agents.
            </p>
          </article>
          <article className="dashboard-card">
            <div className="supported-accounts-title">Fulfilled</div>
            <div className="dashboard-stat">{fulfilledTasks.length}</div>
            <p className="dashboard-muted">
              Marketplace tasks you completed for other humans.
            </p>
          </article>
          <article className="dashboard-card">
            <div className="supported-accounts-title">Running Now</div>
            <div className="dashboard-stat">
              {tasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "awaiting_agent_clarification").length}
            </div>
            <p className="dashboard-muted">
              Includes queued, active, and waiting-for-reply tasks.
            </p>
          </article>
          <article className="dashboard-card">
            <div className="supported-accounts-title">Completed</div>
            <div className="dashboard-stat">
              {tasks.filter((task) => task.status === "completed").length}
            </div>
            <p className="dashboard-muted">
              Finished tasks stay here so you can revisit receipts, pickup details, and chat history.
            </p>
          </article>
        </section>

        <section className="dashboard-grid wide">
          <TaskListSection
            title="Submitted Tasks"
            empty="You have not submitted any browser tasks yet."
            tasks={submittedTasks}
            humanUserId={user.id}
          />
          <TaskListSection
            title="Fulfillment History"
            empty="You have not fulfilled any marketplace tasks yet."
            tasks={fulfilledTasks}
            humanUserId={user.id}
          />
        </section>
      </section>
    </main>
  );
}
