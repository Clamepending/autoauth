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
  website_url: string | null;
  shipping_address: string | null;
  pickup_details: {
    order_number: string | null;
    confirmation_code: string | null;
    pickup_code: string | null;
    ready_time: string | null;
    pickup_name: string | null;
    instructions: string | null;
    order_reference: string | null;
    receipt_url: string | null;
    receipt_text: string | null;
  } | null;
  pickup_summary: string | null;
  tracking_details: {
    tracking_number: string | null;
    tracking_url: string | null;
    carrier: string | null;
    status: string | null;
    delivery_eta: string | null;
    delivery_window: string | null;
    instructions: string | null;
  } | null;
  tracking_summary: string | null;
  fulfillment_details_missing: boolean;
  clarification: {
    question: string;
    requested_at: string | null;
    deadline_at: string | null;
    response: string | null;
    responded_at: string | null;
    callback_status: string | null;
    callback_http_status: number | null;
    callback_error: string | null;
    callback_last_attempt_at: string | null;
  } | null;
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
  recent_snapshots: Snapshot[];
};

type ChatItem = {
  id: string;
  role: "requester" | "agent" | "system";
  text: string;
  timestamp: string;
};

function fmtDate(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function fmtRating(value: number | null | undefined) {
  return value == null ? "No ratings yet" : `${value.toFixed(1)} / 5`;
}

function cleanChatText(value: string | null | undefined, limit = 700) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutFences = raw.replace(/```[\s\S]*?```/g, " ").trim();
  const withoutJsonTail = withoutFences.replace(/\{[\s\S]*$/, " ").trim();
  const collapsed = withoutJsonTail.replace(/\n{3,}/g, "\n\n").trim();
  const finalText = collapsed || raw;
  return finalText.length > limit ? `${finalText.slice(0, limit)}...` : finalText;
}

function buildInitialRequestText(task: TaskPayload) {
  const parts = [task.task_prompt.trim()];
  if (task.website_url) {
    parts.push(`Preferred website: ${task.website_url}`);
  }
  if (task.shipping_address) {
    parts.push(`Shipping address:\n${task.shipping_address}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

function displayTaskStatus(status: string) {
  if (status === "awaiting_agent_clarification") return "awaiting clarification";
  return status;
}

function buildTaskChatItems(data: DetailPayload) {
  const items: ChatItem[] = [];
  const push = (item: ChatItem | null) => {
    if (!item || !item.text.trim()) return;
    const previous = items[items.length - 1];
    if (previous && previous.role === item.role && previous.text === item.text) {
      return;
    }
    items.push(item);
  };

  push({
    id: `task-request-${data.task.id}`,
    role: "requester",
    text: buildInitialRequestText(data.task),
    timestamp: data.task.created_at,
  });

  const chronologicalEvents = [...data.run_events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  for (const event of chronologicalEvents) {
    switch (event.type) {
      case "computeruse.chat.human_message":
        push({
          id: event.id,
          role: "requester",
          text: cleanChatText(
            typeof event.data.message === "string" ? event.data.message : null,
          ),
          timestamp: event.created_at,
        });
        break;
      case "computeruse.chat.agent_message":
        push({
          id: event.id,
          role: "agent",
          text: cleanChatText(
            typeof event.data.message === "string" ? event.data.message : null,
          ),
          timestamp: event.created_at,
        });
        break;
      case "computeruse.local_agent.clarification_requested":
        push({
          id: event.id,
          role: "agent",
          text: cleanChatText(
            typeof event.data.clarification_question === "string"
              ? event.data.clarification_question
              : describeEvent(event),
          ),
          timestamp: event.created_at,
        });
        break;
      case "computeruse.run.created":
      case "computeruse.task.queued":
      case "computeruse.task.delivered":
      case "computeruse.run.awaiting_agent_clarification":
      case "computeruse.human_clarification.responded":
      case "computeruse.human_clarification.timed_out":
      case "computeruse.agent_clarification.responded":
      case "computeruse.agent_clarification.timed_out":
      case "computeruse.local_agent.completed":
      case "computeruse.local_agent.failed":
        push({
          id: event.id,
          role: "system",
          text: describeEvent(event),
          timestamp: event.created_at,
        });
        break;
      default:
        break;
    }
  }

  if (data.task.status === "completed") {
    push({
      id: `task-final-${data.task.id}`,
      role: "agent",
      text: cleanChatText(displaySummary(data.task)),
      timestamp: data.task.completed_at || data.task.created_at,
    });
  } else if (data.task.status === "failed") {
    push({
      id: `task-final-${data.task.id}`,
      role: "agent",
      text: cleanChatText(data.task.error || displaySummary(data.task)),
      timestamp: data.task.completed_at || data.task.created_at,
    });
  }

  return items;
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
    case "computeruse.chat.human_message":
      return "You sent a live message to the browser fulfiller.";
    case "computeruse.chat.agent_message":
      return "The browser fulfiller sent a live chat update.";
    case "computeruse.local_agent.clarification_requested":
      return "Browser fulfiller requested clarification before continuing.";
    case "computeruse.run.awaiting_agent_clarification":
      return "OttoAuth is waiting for clarification before continuing the run.";
    case "computeruse.human_clarification.responded":
      return "Your clarification reply was received and OttoAuth resumed the task.";
    case "computeruse.human_clarification.timed_out":
      return "The clarification window expired before OttoAuth received a reply.";
    case "computeruse.agent_clarification.responded":
      return "The submitting agent replied to the clarification request and OttoAuth resumed the task.";
    case "computeruse.agent_clarification.timed_out":
      return "The submitting agent did not answer the clarification request before the deadline.";
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
  if (task.status === "completed" && task.pickup_summary) {
    return `Completed successfully. ${task.pickup_summary}.`;
  }
  if (task.status === "completed" && task.tracking_summary) {
    return `Completed successfully. ${task.tracking_summary}.`;
  }
  if (task.status === "completed") {
    return "Completed successfully, but the fulfiller did not return a written summary.";
  }
  if (task.status === "awaiting_agent_clarification" && task.clarification?.question) {
    return "OttoAuth is waiting for a clarification reply before the browser fulfiller can continue.";
  }
  if (task.status === "failed") {
    return task.error || "This task failed before the fulfiller returned a written summary.";
  }
  return "Not yet available";
}

function PickupDetailsBlock(props: {
  details: NonNullable<TaskPayload["pickup_details"]>;
  summary: string | null;
}) {
  const rows = [
    { label: "Order number", value: props.details.order_number, mono: true },
    { label: "Confirmation code", value: props.details.confirmation_code, mono: true },
    { label: "Pickup code", value: props.details.pickup_code, mono: true },
    { label: "Ready time", value: props.details.ready_time },
    { label: "Pickup name", value: props.details.pickup_name },
    { label: "Order reference", value: props.details.order_reference, mono: true },
    { label: "Instructions", value: props.details.instructions, prewrap: true },
    { label: "Receipt text", value: props.details.receipt_text, prewrap: true },
  ].filter((row) => Boolean(row.value));

  return (
    <div className="pickup-details-block">
      <div className="supported-accounts-title">Pickup &amp; Receipt</div>
      {props.summary && <div><strong>{props.summary}</strong></div>}
      <div className="dashboard-list">
        {rows.map((row) => (
          <div className="dashboard-row" key={row.label}>
            <div>
              <strong>{row.label}</strong>
              <div className={`dashboard-muted ${row.prewrap ? "dashboard-prewrap" : ""} ${row.mono ? "mono" : ""}`}>
                {row.value}
              </div>
            </div>
          </div>
        ))}
        {props.details.receipt_url && (
          <div className="dashboard-row">
            <div>
              <strong>Receipt URL</strong>
              <div className="dashboard-muted">
                <a href={props.details.receipt_url} target="_blank" rel="noreferrer">
                  {props.details.receipt_url}
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrackingDetailsBlock(props: {
  details: NonNullable<TaskPayload["tracking_details"]>;
  summary: string | null;
}) {
  const rows = [
    { label: "Tracking number", value: props.details.tracking_number, mono: true },
    { label: "Carrier", value: props.details.carrier },
    { label: "Status", value: props.details.status },
    { label: "Delivery ETA", value: props.details.delivery_eta },
    { label: "Delivery window", value: props.details.delivery_window, prewrap: true },
    { label: "Instructions", value: props.details.instructions, prewrap: true },
  ].filter((row) => Boolean(row.value));

  return (
    <div className="pickup-details-block">
      <div className="supported-accounts-title">Tracking &amp; Delivery</div>
      {props.summary && <div><strong>{props.summary}</strong></div>}
      <div className="dashboard-list">
        {rows.map((row) => (
          <div className="dashboard-row" key={row.label}>
            <div>
              <strong>{row.label}</strong>
              <div className={`dashboard-muted ${row.prewrap ? "dashboard-prewrap" : ""} ${row.mono ? "mono" : ""}`}>
                {row.value}
              </div>
            </div>
          </div>
        ))}
        {props.details.tracking_url && (
          <div className="dashboard-row">
            <div>
              <strong>Tracking URL</strong>
              <div className="dashboard-muted">
                <a href={props.details.tracking_url} target="_blank" rel="noreferrer">
                  {props.details.tracking_url}
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function OrderDetailClient(props: {
  taskId: number;
  initialData: DetailPayload;
}) {
  const [data, setData] = useState<DetailPayload>(props.initialData);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(
    props.initialData.latest_snapshot?.id ?? props.initialData.recent_snapshots[0]?.id ?? null,
  );
  const [followingLatestSnapshot, setFollowingLatestSnapshot] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [savingRating, setSavingRating] = useState(false);
  const [ratingMessage, setRatingMessage] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState<number>(props.initialData.task.requester_rating ?? 0);
  const [chatDraft, setChatDraft] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [chatMessage, setChatMessage] = useState<string | null>(null);

  useEffect(() => {
    setRatingValue(data.task.requester_rating ?? 0);
  }, [data.task.requester_rating]);

  useEffect(() => {
    const snapshotIds = data.recent_snapshots.map((snapshot) => snapshot.id);
    if (selectedSnapshotId == null) {
      const fallbackId = data.latest_snapshot?.id ?? data.recent_snapshots[0]?.id ?? null;
      if (fallbackId != null) {
        setSelectedSnapshotId(fallbackId);
        setFollowingLatestSnapshot(true);
      }
      return;
    }
    if (
      snapshotIds.length > 0 &&
      !snapshotIds.includes(selectedSnapshotId) &&
      data.latest_snapshot?.id != null
    ) {
      setSelectedSnapshotId(data.latest_snapshot.id);
      setFollowingLatestSnapshot(true);
    }
  }, [data.latest_snapshot, data.recent_snapshots, selectedSnapshotId]);

  useEffect(() => {
    if (!followingLatestSnapshot) return;
    if (data.latest_snapshot?.id == null) return;
    if (selectedSnapshotId === data.latest_snapshot.id) return;
    setSelectedSnapshotId(data.latest_snapshot.id);
  }, [data.latest_snapshot, followingLatestSnapshot, selectedSnapshotId]);

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

  const canChatWithAgent =
    data.viewer_role === "requester" &&
    data.task.status !== "completed" &&
    data.task.status !== "failed";

  async function handleSendChatMessage() {
    if (!canChatWithAgent || sendingChat) return;
    const responseText = chatDraft.trim();
    if (!responseText) {
      setChatMessage(
        data.task.status === "awaiting_agent_clarification"
          ? "Please answer the clarification question before sending."
          : "Please type a message before sending.",
      );
      return;
    }
    setSendingChat(true);
    setChatMessage(null);
    try {
      const response = await fetch(`/api/human/tasks/${props.taskId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: responseText }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; note?: string; task?: TaskPayload }
        | null;
      if (!response.ok || !payload?.task) {
        setChatMessage(payload?.error || "Could not send your message.");
        return;
      }
      setData((current) => ({
        ...current,
        task: payload.task ?? current.task,
      }));
      setChatMessage(payload?.note || "Message sent.");
      setChatDraft("");
    } catch (error) {
      setChatMessage(
        error instanceof Error ? error.message : "Could not send your message.",
      );
    } finally {
      setSendingChat(false);
    }
  }

  const availableSnapshots =
    data.recent_snapshots.length > 0
      ? data.recent_snapshots
      : data.latest_snapshot
        ? [data.latest_snapshot]
        : [];
  const selectedSnapshot =
    availableSnapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ??
    data.latest_snapshot ??
    availableSnapshots[0] ??
    null;
  const taskChatItems = buildTaskChatItems(data);

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Order Detail</div>
            <h1>{data.task.task_title || `Task #${data.task.id}`}</h1>
            <p className="lede">
              Watch the live browser snapshot, chat with the fulfiller when needed, and inspect the final charges once fulfillment finishes.
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
        {data.task.fulfillment_details_missing && (
          <div className="auth-error">
            This purchase completed, but the fulfiller did not capture an order number, pickup code, or tracking number.
            Check the recent frames below and the merchant account directly before pickup or delivery.
          </div>
        )}

        <section className="dashboard-grid metrics-grid">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Status</div>
            <div className="dashboard-row">
              <strong>Task</strong>
              <span className={`status-chip status-${data.task.status}`}>{displayTaskStatus(data.task.status)}</span>
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
            {selectedSnapshot ? (
              <div className="live-view-block">
                <div className="live-view-frame">
                  <img
                    src={`data:image/png;base64,${selectedSnapshot.image_base64}`}
                    alt="Live browser snapshot"
                    className="live-view-image"
                  />
                </div>
                <div className="dashboard-muted">
                  Showing frame {fmtDate(selectedSnapshot.created_at)}
                </div>
                {availableSnapshots.length > 1 && (
                  <div className="snapshot-strip">
                    {availableSnapshots.map((snapshot) => (
                      <button
                        key={snapshot.id}
                        type="button"
                        className={`snapshot-chip ${selectedSnapshot.id === snapshot.id ? "selected" : ""}`}
                        onClick={() => {
                          setSelectedSnapshotId(snapshot.id);
                          setFollowingLatestSnapshot(snapshot.id === data.latest_snapshot?.id);
                        }}
                      >
                        {snapshot.id === data.latest_snapshot?.id ? "Latest" : "Frame"} · {new Date(snapshot.created_at).toLocaleTimeString()}
                      </button>
                    ))}
                  </div>
                )}
                {selectedSnapshot.tabs.length > 0 && (
                  <div className="dashboard-list" style={{ marginTop: "1rem" }}>
                    <div className="supported-accounts-title">Live Tabs</div>
                    {selectedSnapshot.tabs.map((tab) => (
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
            <div className="supported-accounts-title">Task Chat</div>
            <div className="task-chat-feed">
              {taskChatItems.length === 0 ? (
                <div className="dashboard-empty">No messages yet.</div>
              ) : (
                taskChatItems.map((item) => (
                  <div key={item.id} className={`chat-bubble chat-${item.role}`}>
                    <div className="chat-bubble-meta">
                      <strong>
                        {item.role === "requester"
                          ? "You"
                          : item.role === "agent"
                            ? "Browser Agent"
                            : "OttoAuth"}
                      </strong>
                      <span className="dashboard-muted">{fmtDate(item.timestamp)}</span>
                    </div>
                    <div className="dashboard-prewrap">{item.text}</div>
                  </div>
                ))
              )}
            </div>
            {canChatWithAgent && (
              <div className="task-chat-composer">
                {data.task.status === "awaiting_agent_clarification" && data.task.clarification?.deadline_at && (
                  <div className="dashboard-muted">
                    Reply by {fmtDate(data.task.clarification.deadline_at)} or OttoAuth will cancel this task.
                  </div>
                )}
                <textarea
                  className="auth-input shipping-textarea"
                  placeholder={
                    data.task.status === "awaiting_agent_clarification"
                      ? "Type the clarification reply OttoAuth should use to continue..."
                      : "Send a live message to the browser fulfiller..."
                  }
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  disabled={sendingChat}
                />
                <div className="dashboard-actions">
                  <button
                    type="button"
                    className="auth-button primary"
                    onClick={handleSendChatMessage}
                    disabled={sendingChat}
                  >
                    {sendingChat
                      ? "Sending..."
                      : data.task.status === "awaiting_agent_clarification"
                        ? "Send reply"
                        : "Send message"}
                  </button>
                </div>
                {chatMessage && <div className="auth-success">{chatMessage}</div>}
              </div>
            )}
            {data.task.pickup_details && (
              <PickupDetailsBlock
                details={data.task.pickup_details}
                summary={data.task.pickup_summary}
              />
            )}
            {data.task.tracking_details && (
              <TrackingDetailsBlock
                details={data.task.tracking_details}
                summary={data.task.tracking_summary}
              />
            )}
          </article>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Debug Events</div>
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
