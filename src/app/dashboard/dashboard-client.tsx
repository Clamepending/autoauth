"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";
import type { ComputerUseDeviceRecord } from "@/lib/computeruse-store";
import type {
  CreditLedgerRecord,
  HumanAgentLinkWithAgentRecord,
  HumanDevicePairingCodeRecord,
  HumanUserRecord,
} from "@/lib/human-accounts";
import type {
  GenericBrowserTaskRecord,
  HumanFulfillmentRatingStats,
} from "@/lib/generic-browser-tasks";

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtRating(value: number | null) {
  return value == null ? "No ratings yet" : `${value.toFixed(1)} / 5`;
}

export function DashboardClient(props: {
  user: HumanUserRecord;
  balanceCents: number;
  linkedAgents: HumanAgentLinkWithAgentRecord[];
  devices: ComputerUseDeviceRecord[];
  pairingCodes: HumanDevicePairingCodeRecord[];
  ledger: CreditLedgerRecord[];
  tasks: GenericBrowserTaskRecord[];
  fulfillmentStats: HumanFulfillmentRatingStats;
}) {
  const [pairingKey, setPairingKey] = useState("");
  const [pairingAgent, setPairingAgent] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState("raspberry-pi-browser");
  const [creatingCode, setCreatingCode] = useState(false);
  const [togglingDeviceId, setTogglingDeviceId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const activeCode = props.pairingCodes[0] ?? null;

  async function handlePairAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pairingKey.trim()) return;
    setPairingAgent(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/human/pair-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairing_key: pairingKey }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatusMessage(payload?.error || "Agent pairing failed.");
        return;
      }
      setStatusMessage(`Linked agent ${payload?.agent?.username || "agent"} successfully.`);
      window.location.reload();
    } finally {
      setPairingAgent(false);
    }
  }

  async function handleCreateCode() {
    setCreatingCode(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/human/devices/pairing-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_label: deviceLabel }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatusMessage(payload?.error || "Could not create device claim code.");
        return;
      }
      setStatusMessage(`Created claim code ${payload?.code}.`);
      window.location.reload();
    } finally {
      setCreatingCode(false);
    }
  }

  async function handleLogout() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.redirected) {
      window.location.href = response.url;
      return;
    }
    window.location.href = "/";
  }

  async function handleToggleMarketplace(deviceId: string, enabled: boolean) {
    setTogglingDeviceId(deviceId);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/human/devices/${encodeURIComponent(deviceId)}/marketplace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatusMessage(payload?.error || "Could not update marketplace status.");
        return;
      }
      setStatusMessage(
        enabled
          ? `Device ${deviceId} is now accepting marketplace tasks.`
          : `Device ${deviceId} is no longer accepting marketplace tasks.`,
      );
      window.location.reload();
    } finally {
      setTogglingDeviceId(null);
    }
  }

  function getTaskRoleLabel(task: GenericBrowserTaskRecord) {
    if (task.human_user_id === props.user.id && task.fulfiller_human_user_id === props.user.id) {
      return "Self-fulfilled";
    }
    if (task.human_user_id === props.user.id) {
      return "Submitted";
    }
    if (task.fulfiller_human_user_id === props.user.id) {
      return "Fulfilled";
    }
    return "Related";
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Human Dashboard</div>
            <h1>{props.user.display_name || props.user.email}</h1>
            <p className="lede">
              Your agents can spend from your credits, and you can now submit your own browser tasks too. Claimed devices can also opt into the marketplace and earn credits by fulfilling other humans&apos; orders.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button primary" href="/orders/new">
              New order
            </Link>
            <button className="auth-button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>

        {statusMessage && <div className="auth-success">{statusMessage}</div>}

        <section className="dashboard-grid metrics-grid">
          <article className="dashboard-card highlight">
            <div className="supported-accounts-title">Credits</div>
            <div className="dashboard-balance">{fmtUsd(props.balanceCents)}</div>
            <p className="dashboard-muted">
              New human accounts start with $20. Top-ups can be added later; for now the starter balance and debits are fully wired up.
            </p>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Linked Agents</div>
            <div className="dashboard-stat">{props.linkedAgents.length}</div>
            <p className="dashboard-muted">
              Agents linked to this human account can submit browser tasks against your credits.
            </p>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Tasks Submitted</div>
            <div className="dashboard-stat">{props.fulfillmentStats.submitted_task_count}</div>
            <p className="dashboard-muted">
              Requests from you or your linked agents show up here, whether they are still running or already done.
            </p>
            <Link className="auth-button" href="/orders/new">
              Submit a human task
            </Link>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Tasks Fulfilled</div>
            <div className="dashboard-stat">{props.fulfillmentStats.fulfilled_task_count}</div>
            <p className="dashboard-muted">
              Fulfillment rating: {fmtRating(props.fulfillmentStats.average_rating)}
              {props.fulfillmentStats.rating_count > 0
                ? ` from ${props.fulfillmentStats.rating_count} rating${
                    props.fulfillmentStats.rating_count === 1 ? "" : "s"
                  }.`
                : ". Completed marketplace work will start building your score once requesters rate it."}
            </p>
          </article>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Pair An Agent</div>
            <form className="stack-form" onSubmit={handlePairAgent}>
              <input
                className="auth-input"
                value={pairingKey}
                onChange={(event) => setPairingKey(event.target.value)}
                placeholder="Paste agent pairing key"
              />
              <button className="auth-button primary" type="submit" disabled={pairingAgent}>
                {pairingAgent ? "Linking..." : "Link agent"}
              </button>
            </form>
            <p className="dashboard-muted">
              Your agent gets this key when it creates its OttoAuth account. The human uses it once here; the agent keeps its private key private.
            </p>

            <div className="dashboard-list">
              {props.linkedAgents.length === 0 ? (
                <div className="dashboard-empty">No linked agents yet.</div>
              ) : (
                props.linkedAgents.map((agent) => (
                  <div key={agent.id} className="dashboard-row">
                    <div>
                      <strong>{agent.username_display}</strong>
                      <div className="dashboard-muted mono">@{agent.username_lower}</div>
                    </div>
                    <div className="dashboard-muted">
                      Linked {new Date(agent.linked_at).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Claim Extension Device</div>
            <div className="stack-form">
              <input
                className="auth-input"
                value={deviceLabel}
                onChange={(event) => setDeviceLabel(event.target.value)}
                placeholder="Device label"
              />
              <button className="auth-button primary" onClick={handleCreateCode} disabled={creatingCode}>
                {creatingCode ? "Generating..." : "Generate claim code"}
              </button>
            </div>
            <p className="dashboard-muted">
              Put this code into the OttoAuth extension settings on the Raspberry Pi or browser machine.
            </p>

            {activeCode ? (
              <div className="claim-code-block">
                <div className="claim-code">{activeCode.code}</div>
                <div className="dashboard-muted">
                  Expires {new Date(activeCode.expires_at).toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="dashboard-empty">No active claim code yet.</div>
            )}

            <div className="dashboard-list">
              {props.devices.length === 0 ? (
                <div className="dashboard-empty">No devices claimed yet.</div>
              ) : (
                props.devices.map((device) => (
                  <div key={device.device_id} className="dashboard-row">
                    <div>
                      <strong>{device.label || device.device_id}</strong>
                      <div className="dashboard-muted mono">{device.device_id}</div>
                      <div className="dashboard-muted">
                        Marketplace {device.marketplace_enabled ? "enabled" : "disabled"}
                        {device.last_seen_at ? ` · Seen ${new Date(device.last_seen_at).toLocaleString()}` : ""}
                      </div>
                    </div>
                    <div className="dashboard-device-actions">
                      <div className="dashboard-muted">
                        Updated {new Date(device.updated_at).toLocaleString()}
                      </div>
                      <button
                        className="auth-button"
                        onClick={() =>
                          handleToggleMarketplace(device.device_id, !device.marketplace_enabled)
                        }
                        disabled={togglingDeviceId === device.device_id}
                      >
                        {togglingDeviceId === device.device_id
                          ? "Saving..."
                          : device.marketplace_enabled
                            ? "Disable marketplace"
                            : "Enable marketplace"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="dashboard-section-header">
              <div className="supported-accounts-title">Recent Browser Tasks</div>
              <div className="dashboard-muted">
                {props.tasks.length} related task{props.tasks.length === 1 ? "" : "s"}
                {props.tasks.length > 6 ? " · Scroll for older activity" : ""}
              </div>
            </div>
            <div className="dashboard-list dashboard-feed">
              {props.tasks.length === 0 ? (
                <div className="dashboard-empty">No tasks yet.</div>
              ) : (
                props.tasks.map((task) => (
                  <div key={task.id} className="dashboard-task">
                    <div className="dashboard-row">
                      <strong>
                        <Link href={`/orders/${task.id}`}>{task.task_title || `Task #${task.id}`}</Link>
                      </strong>
                      <span className={`status-chip status-${task.status}`}>{task.status}</span>
                    </div>
                    <div className="dashboard-muted">{task.summary || task.task_prompt}</div>
                    {task.pickup_summary && (
                      <div className="dashboard-muted">
                        Pickup details: {task.pickup_summary}
                      </div>
                    )}
                    <div className="dashboard-task-meta">
                      <span>Role: {getTaskRoleLabel(task)}</span>
                      <span>Source: {task.submission_source}</span>
                      {task.pickup_details?.order_number && (
                        <span>Order {task.pickup_details.order_number}</span>
                      )}
                      {task.pickup_details?.pickup_code && (
                        <span>Pickup code {task.pickup_details.pickup_code}</span>
                      )}
                      {task.pickup_details?.ready_time && (
                        <span>Ready {task.pickup_details.ready_time}</span>
                      )}
                      <span>Total debited: {fmtUsd(task.total_cents)}</span>
                      <span>Payout: {fmtUsd(task.payout_cents)}</span>
                      {task.requester_rating != null && <span>Rating: {task.requester_rating} / 5</span>}
                      <span>Billing: {task.billing_status}</span>
                      <span>{new Date(task.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="dashboard-card">
            <div className="dashboard-section-header">
              <div className="supported-accounts-title">Credit Activity</div>
              <div className="dashboard-muted">
                {props.ledger.length} entr{props.ledger.length === 1 ? "y" : "ies"}
                {props.ledger.length > 6 ? " · Scroll for older activity" : ""}
              </div>
            </div>
            <div className="dashboard-list dashboard-feed">
              {props.ledger.length === 0 ? (
                <div className="dashboard-empty">No ledger activity yet.</div>
              ) : (
                props.ledger.map((entry) => (
                  <div key={entry.id} className="dashboard-row">
                    <div>
                      <strong>{entry.description || entry.entry_type}</strong>
                      <div className="dashboard-muted">
                        {new Date(entry.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className={entry.amount_cents >= 0 ? "amount-positive" : "amount-negative"}>
                      {entry.amount_cents >= 0 ? "+" : "-"}
                      {fmtUsd(Math.abs(entry.amount_cents))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
