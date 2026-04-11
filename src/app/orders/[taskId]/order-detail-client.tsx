"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TaskPayload = {
  id: number;
  submission_source: string;
  status: string;
  billing_status: string;
  payout_status: string;
  task_title: string | null;
  task_prompt: string;
  summary: string | null;
  error: string | null;
  requester_rating: number | null;
  requester_rating_at: string | null;
  merchant: string | null;
  goods_total: string | null;
  shipping_total: string | null;
  tax_total: string | null;
  other_total: string | null;
  inference_total: string | null;
  total_debited: string | null;
  payout_total: string | null;
  run_id: string | null;
  created_at: string;
  completed_at: string | null;
  charged_at: string | null;
  payout_credited_at: string | null;
  max_charge: string | null;
  fulfiller_human_user_id: number | null;
};

type RunEvent = {
  id: string;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
};

type Snapshot = {
  id: number;
  created_at: string;
  image_base64: string;
  width: number | null;
  height: number | null;
  tabs: Array<{
    id: number;
    title: string;
    url: string;
    active: boolean;
  }>;
};

type DetailPayload = {
  ok: true;
  task: TaskPayload;
  viewer_role: string;
  requester: { id: number; email: string; display_name: string | null } | null;
  fulfiller: { id: number; email: string; display_name: string | null } | null;
  fulfiller_rating: {
    human_user_id: number;
    submitted_task_count: number;
    fulfilled_task_count: number;
    rating_count: number;
    average_rating: number | null;
  } | null;
  run: { status: string } | null;
  run_events: RunEvent[];
  latest_snapshot: Snapshot | null;
};

function fmtDate(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function fmtRating(value: number | null | undefined) {
  return value == null ? "No ratings yet" : `${value.toFixed(1)} / 5`;
}

function describeEvent(event: RunEvent) {
  const taskId =
    typeof event.data.task_id === "string" || typeof event.data.task_id === "number"
      ? String(event.data.task_id)
      : null;
  switch (event.type) {
    case "computeruse.run.created":
      return "Task accepted by OttoAuth and assigned to a browser fulfiller.";
    case "computeruse.task.queued":
      return taskId ? `Queued for device pickup as task ${taskId}.` : "Queued for device pickup.";
    case "computeruse.task.delivered":
      return taskId ? `Picked up by the fulfiller device as task ${taskId}.` : "Picked up by the fulfiller device.";
    case "computeruse.local_agent.completed":
      return "Browser fulfiller reported completion.";
    case "computeruse.local_agent.failed":
      return "Browser fulfiller reported a failure.";
    case "computeruse.run.completed":
      return "OttoAuth marked the task run complete.";
    case "computeruse.run.failed":
      return "OttoAuth marked the task run failed.";
    default:
      return event.type;
  }
}

function displaySummary(task: TaskPayload) {
  if (task.summary) return task.summary;
  if (task.status === "completed") {
    return "Completed successfully, but the fulfiller did not return a written summary.";
  }
  if (task.status === "failed") {
    return task.error || "This task failed before the fulfiller returned a written summary.";
  }
  return "Not yet available";
}

export function OrderDetailClient(props: {
  taskId: number;
  initialData: DetailPayload;
}) {
  const [data, setData] = useState<DetailPayload>(props.initialData);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [savingRating, setSavingRating] = useState(false);
  const [ratingMessage, setRatingMessage] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState<number>(props.initialData.task.requester_rating ?? 0);

  useEffect(() => {
    setRatingValue(data.task.requester_rating ?? 0);
  }, [data.task.requester_rating]);

  useEffect(() => {
    const taskDone =
      data.task.status === "completed" || data.task.status === "failed";
    if (taskDone) return;

    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/human/tasks/${props.taskId}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as DetailPayload | { error?: string } | null;
        if (!response.ok) {
          if (!stopped) {
            setLoadingError((payload as { error?: string } | null)?.error || "Could not refresh task.");
          }
          return;
        }
        if (!stopped && payload && "task" in payload) {
          setData(payload);
          setLoadingError(null);
        }
      } catch (error) {
        if (!stopped) {
          setLoadingError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    poll();
    const intervalId = window.setInterval(poll, 2500);
    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, [props.taskId, data.task.status]);

  const canRequesterRate =
    data.viewer_role === "requester" &&
    data.task.status === "completed" &&
    data.fulfiller != null &&
    data.requester != null &&
    data.fulfiller.id !== data.requester.id;

  async function handleSaveRating(nextRating: number) {
    if (!canRequesterRate || savingRating) return;
    setSavingRating(true);
    setRatingMessage(null);
    setRatingValue(nextRating);
    try {
      const response = await fetch(`/api/human/tasks/${props.taskId}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: nextRating }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            task?: TaskPayload;
            fulfiller_rating?: DetailPayload["fulfiller_rating"];
          }
        | null;
      if (!response.ok || !payload?.task) {
        setRatingValue(data.task.requester_rating ?? 0);
        setRatingMessage(payload?.error || "Could not save rating.");
        return;
      }
      setData((current) => ({
        ...current,
        task: payload.task ?? current.task,
        fulfiller_rating: payload.fulfiller_rating ?? current.fulfiller_rating,
      }));
      setRatingValue(nextRating);
      setRatingMessage(`Saved ${nextRating} / 5 rating.`);
    } catch (error) {
      setRatingValue(data.task.requester_rating ?? 0);
      setRatingMessage(error instanceof Error ? error.message : "Could not save rating.");
    } finally {
      setSavingRating(false);
    }
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Order Detail</div>
            <h1>{data.task.task_title || `Task #${data.task.id}`}</h1>
            <p className="lede">
              Watch the latest browser snapshot, follow run events, and inspect final credits once fulfillment finishes.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button" href="/orders/new">
              New order
            </Link>
            <Link className="auth-button" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>

        {loadingError && <div className="auth-error">{loadingError}</div>}

        <section className="dashboard-grid metrics-grid">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Status</div>
            <div className="dashboard-row">
              <strong>Task</strong>
              <span className={`status-chip status-${data.task.status}`}>{data.task.status}</span>
            </div>
            <div className="dashboard-row">
              <strong>Billing</strong>
              <span>{data.task.billing_status}</span>
            </div>
            <div className="dashboard-row">
              <strong>Payout</strong>
              <span>{data.task.payout_status}</span>
            </div>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Parties</div>
            <div className="dashboard-row">
              <div>
                <strong>Requester</strong>
                <div className="dashboard-muted">
                  {data.requester?.display_name || data.requester?.email || "Unknown"}
                </div>
              </div>
              <span>{data.viewer_role === "requester" ? "You" : ""}</span>
            </div>
            <div className="dashboard-row">
              <div>
                <strong>Fulfiller</strong>
                <div className="dashboard-muted">
                  {data.fulfiller?.display_name || data.fulfiller?.email || "Not assigned"}
                </div>
                {data.fulfiller_rating && (
                  <div className="dashboard-muted">
                    Reputation {fmtRating(data.fulfiller_rating.average_rating)}
                    {data.fulfiller_rating.rating_count > 0
                      ? ` from ${data.fulfiller_rating.rating_count} rating${
                          data.fulfiller_rating.rating_count === 1 ? "" : "s"
                        }`
                      : ` across ${data.fulfiller_rating.fulfilled_task_count} completed fulfillment${
                          data.fulfiller_rating.fulfilled_task_count === 1 ? "" : "s"
                        }`}
                  </div>
                )}
              </div>
              <span>{data.viewer_role === "fulfiller" ? "You" : ""}</span>
            </div>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Amounts</div>
            <div className="dashboard-row">
              <strong>Spend cap</strong>
              <span>{data.task.max_charge || "Current balance"}</span>
            </div>
            <div className="dashboard-row">
              <strong>Total debited</strong>
              <span>{data.task.total_debited || "$0.00"}</span>
            </div>
            <div className="dashboard-row">
              <strong>Payout total</strong>
              <span>{data.task.payout_total || "$0.00"}</span>
            </div>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Fulfillment Rating</div>
            {canRequesterRate ? (
              <div className="rating-block">
                <div className="dashboard-muted">
                  Rate this completed fulfillment from 1 to 5. You can update it later if needed.
                </div>
                <div className="rating-picker">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`rating-button ${ratingValue === value ? "selected" : ""}`}
                      onClick={() => handleSaveRating(value)}
                      disabled={savingRating}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <div className="dashboard-muted">
                  {data.task.requester_rating != null
                    ? `Current rating: ${data.task.requester_rating} / 5${
                        data.task.requester_rating_at
                          ? ` · Updated ${fmtDate(data.task.requester_rating_at)}`
                          : ""
                      }`
                    : "No rating saved yet."}
                </div>
                {ratingMessage && <div className="auth-success">{ratingMessage}</div>}
              </div>
            ) : data.task.requester_rating != null ? (
              <div className="dashboard-muted">
                Requester rating: {data.task.requester_rating} / 5
                {data.task.requester_rating_at
                  ? ` · Updated ${fmtDate(data.task.requester_rating_at)}`
                  : ""}
              </div>
            ) : data.task.status !== "completed" ? (
              <div className="dashboard-muted">
                Ratings unlock after the task is completed.
              </div>
            ) : data.fulfiller && data.requester && data.fulfiller.id === data.requester.id ? (
              <div className="dashboard-muted">
                Self-fulfilled tasks do not need a separate rating.
              </div>
            ) : (
              <div className="dashboard-muted">
                Waiting for the requester to leave a rating.
              </div>
            )}
          </article>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Live Screen</div>
            {data.latest_snapshot ? (
              <div className="live-view-block">
                <img
                  src={`data:image/png;base64,${data.latest_snapshot.image_base64}`}
                  alt="Live browser snapshot"
                  className="live-view-image"
                />
                <div className="dashboard-muted">
                  Latest frame {fmtDate(data.latest_snapshot.created_at)}
                </div>
                {data.latest_snapshot.tabs.length > 0 && (
                  <div className="dashboard-list" style={{ marginTop: "1rem" }}>
                    <div className="supported-accounts-title">Live Tabs</div>
                    {data.latest_snapshot.tabs.map((tab) => (
                      <div className="dashboard-row" key={tab.id}>
                        <div>
                          <strong>{tab.title || "Untitled tab"}</strong>
                          <div className="dashboard-muted">{tab.url || "about:blank"}</div>
                        </div>
                        <span>{tab.active ? "Active" : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="dashboard-empty">
                Waiting for the fulfiller device to send the first snapshot.
              </div>
            )}
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Task Summary</div>
            <div className="dashboard-list">
              <div className="dashboard-row">
                <div>
                  <strong>Prompt</strong>
                  <div className="dashboard-muted">{data.task.task_prompt}</div>
                </div>
              </div>
              <div className="dashboard-row">
                <div>
                  <strong>Summary</strong>
                  <div className="dashboard-muted">{displaySummary(data.task)}</div>
                </div>
              </div>
              {data.task.error && (
                <div className="dashboard-row">
                  <div>
                    <strong>Error</strong>
                    <div className="dashboard-muted">{data.task.error}</div>
                  </div>
                </div>
              )}
              <div className="dashboard-row">
                <div>
                  <strong>Created</strong>
                  <div className="dashboard-muted">{fmtDate(data.task.created_at)}</div>
                </div>
              </div>
              <div className="dashboard-row">
                <div>
                  <strong>Completed</strong>
                  <div className="dashboard-muted">{fmtDate(data.task.completed_at)}</div>
                </div>
              </div>
            </div>
          </article>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Run Events</div>
            <div className="dashboard-list">
              {data.run_events.length === 0 ? (
                <div className="dashboard-empty">No events yet.</div>
              ) : (
                data.run_events.map((event) => (
                  <div key={event.id} className="dashboard-task">
                    <div className="dashboard-row">
                      <strong>{event.type}</strong>
                      <span className="dashboard-muted">{fmtDate(event.created_at)}</span>
                    </div>
                    <div className="dashboard-muted">{describeEvent(event)}</div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Charge Breakdown</div>
            <div className="dashboard-list">
              <div className="dashboard-row">
                <strong>Goods</strong>
                <span>{data.task.goods_total || "$0.00"}</span>
              </div>
              <div className="dashboard-row">
                <strong>Shipping</strong>
                <span>{data.task.shipping_total || "$0.00"}</span>
              </div>
              <div className="dashboard-row">
                <strong>Tax</strong>
                <span>{data.task.tax_total || "$0.00"}</span>
              </div>
              <div className="dashboard-row">
                <strong>Other</strong>
                <span>{data.task.other_total || "$0.00"}</span>
              </div>
              <div className="dashboard-row">
                <strong>Inference</strong>
                <span>{data.task.inference_total || "$0.00"}</span>
              </div>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
