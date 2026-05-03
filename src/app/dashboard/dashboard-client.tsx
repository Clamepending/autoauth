"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";
import { HomeCommandBox } from "@/app/home-command-box";
import { CurrentBrowserFulfillmentClient } from "@/app/dashboard/current-browser-fulfillment-client";
import type { ComputerUseDeviceRecord } from "@/lib/computeruse-store";
import type {
  CreditLedgerRecord,
  HumanAgentLinkWithAgentRecord,
  HumanDevicePairingCodeRecord,
  HumanUserRecord,
} from "@/lib/human-accounts";

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m6 6 1 14h10l1-14" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

type LinkedAgentWithSpend = HumanAgentLinkWithAgentRecord & {
  total_spent_cents?: number;
};

export function DashboardClient(props: {
  user: HumanUserRecord;
  referralLink: string;
  referralStats: {
    successful_referrals: number;
    total_bonus_cents: number;
  };
  balanceCents: number;
  linkedAgents: LinkedAgentWithSpend[];
  devices: ComputerUseDeviceRecord[];
  pairingCodes: HumanDevicePairingCodeRecord[];
  ledger: CreditLedgerRecord[];
  serverUrl: string;
  agentSkillCommand: string;
}) {
  const [copiedReferralLink, setCopiedReferralLink] = useState(false);
  const [agentName, setAgentName] = useState("my-agent");
  const [creatingAgentKey, setCreatingAgentKey] = useState(false);
  const [copiedAgentCredential, setCopiedAgentCredential] = useState(false);
  const [generatedAgentCredential, setGeneratedAgentCredential] = useState<{
    username: string;
    privateKey: string;
  } | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("raspberry-pi-browser");
  const [creatingCode, setCreatingCode] = useState(false);
  const [togglingDeviceId, setTogglingDeviceId] = useState<string | null>(null);
  const [removingAgentLinkId, setRemovingAgentLinkId] = useState<number | null>(null);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const activeCode = props.pairingCodes[0] ?? null;

  function getAgentCredentialText(credential = generatedAgentCredential) {
    if (!credential) return "";
    return [
      "Please use these OttoAuth credentials when calling OttoAuth services:",
      `OTTOAUTH_BASE_URL=${props.serverUrl}`,
      `OTTOAUTH_USERNAME=${credential.username}`,
      `OTTOAUTH_PRIVATE_KEY=${credential.privateKey}`,
      "",
      "Example auth body:",
      JSON.stringify(
        {
          username: credential.username,
          private_key: credential.privateKey,
        },
        null,
        2,
      ),
    ].join("\n");
  }

  async function handleCreateAgentKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agentName.trim()) return;
    setCreatingAgentKey(true);
    setStatusMessage(null);
    setGeneratedAgentCredential(null);
    setCopiedAgentCredential(false);
    try {
      const response = await fetch("/api/human/agent-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_name: agentName,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatusMessage(payload?.error || "Could not generate an agent API key.");
        return;
      }
      const credential = {
        username: String(payload?.username || payload?.agent?.username || ""),
        privateKey: String(payload?.privateKey || payload?.private_key || ""),
      };
      if (!credential.username || !credential.privateKey) {
        setStatusMessage("OttoAuth generated an agent, but did not return credentials.");
        return;
      }
      setGeneratedAgentCredential(credential);
      setStatusMessage(
        `Generated API key for ${credential.username}. Send it to your agent now.`,
      );
    } finally {
      setCreatingAgentKey(false);
    }
  }

  async function handleCopyAgentCredential() {
    const text = getAgentCredentialText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAgentCredential(true);
      window.setTimeout(() => setCopiedAgentCredential(false), 1400);
    } catch {
      setCopiedAgentCredential(false);
      setStatusMessage("Could not copy the agent credentials.");
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
        setStatusMessage(payload?.error || "Could not create fulfillment link code.");
        return;
      }
      setStatusMessage(`Created link code ${payload?.code}.`);
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
        setStatusMessage(payload?.error || "Could not update device status.");
        return;
      }
      setStatusMessage(
        enabled
          ? `Device ${deviceId} is now enabled for OttoAuth orders.`
          : `Device ${deviceId} is now disabled for OttoAuth orders.`,
      );
      window.location.reload();
    } finally {
      setTogglingDeviceId(null);
    }
  }

  async function handleRemoveAgent(linkId: number, usernameDisplay: string) {
    const confirmed = window.confirm(
      `Remove ${usernameDisplay} from your OttoAuth account? The agent will no longer be able to spend from your credits until you generate new credentials.`,
    );
    if (!confirmed) return;

    setRemovingAgentLinkId(linkId);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/human/agents/${linkId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatusMessage(payload?.error || "Could not remove linked agent.");
        return;
      }
      setStatusMessage(`Removed linked agent ${payload?.agent?.username_display || usernameDisplay}.`);
      window.location.reload();
    } finally {
      setRemovingAgentLinkId(null);
    }
  }

  async function handleRemoveDevice(deviceId: string, label: string) {
    const confirmed = window.confirm(
      `Remove ${label} from your OttoAuth account? That fulfillment agent will stop receiving orders until it is linked again.`,
    );
    if (!confirmed) return;

    setRemovingDeviceId(deviceId);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/human/devices/${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatusMessage(payload?.error || "Could not remove device.");
        return;
      }
      setStatusMessage(`Removed device ${payload?.device?.label || label}.`);
      window.location.reload();
    } finally {
      setRemovingDeviceId(null);
    }
  }

  function getLedgerOrderHref(entry: CreditLedgerRecord) {
    if (entry.reference_type !== "generic_browser_task" || !entry.reference_id) return null;
    const taskId = Number(entry.reference_id);
    if (!Number.isInteger(taskId) || taskId < 1) return null;
    return `/orders/${taskId}`;
  }

  async function handleCopyReferralLink() {
    try {
      await navigator.clipboard.writeText(props.referralLink);
      setCopiedReferralLink(true);
      window.setTimeout(() => setCopiedReferralLink(false), 1400);
    } catch {
      setCopiedReferralLink(false);
      setStatusMessage("Could not copy your referral link.");
    }
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <section className="referral-banner">
          <div className="referral-banner-copy">
            <div className="supported-accounts-title">Referrals</div>
            <strong className="referral-banner-title">Give $5, get $5.</strong>
            <p className="dashboard-muted">
              When a friend creates a new OttoAuth account through your link and makes their first deposit, they get $5 in credits and you get $5 too. Existing accounts do not qualify.
            </p>
          </div>
          <div className="referral-banner-actions">
            <div className="referral-link">{props.referralLink}</div>
            <button
              type="button"
              className="auth-button"
              onClick={handleCopyReferralLink}
            >
              {copiedReferralLink ? "Copied" : "Copy referral link"}
            </button>
            <div className="dashboard-muted">
              Successful referrals: {props.referralStats.successful_referrals} · Earned{" "}
              {fmtUsd(props.referralStats.total_bonus_cents)}
            </div>
          </div>
        </section>

        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Human Dashboard</div>
            <h1>{props.user.display_name || props.user.email}</h1>
            <p className="lede">
              Generate OttoAuth API keys for agents, manage credits, and submit your own browser fulfillment orders.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button primary" href="/orders/new">
              New order
            </Link>
            <Link className="auth-button" href="/orders">
              Orders
            </Link>
            <button className="auth-button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>

        {statusMessage && <div className="auth-success">{statusMessage}</div>}

        <section className="dashboard-grid mobile-priority-grid">
          <article className="dashboard-card highlight">
            <div className="supported-accounts-title">Credits</div>
            <div className="dashboard-balance">{fmtUsd(props.balanceCents)}</div>
            <Link className="auth-button primary" href="/credits/refill">
              Refill credits
            </Link>
          </article>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card dashboard-card-span-2">
            <div className="supported-accounts-title">Agent API Keys</div>
            <h2 className="dashboard-card-title">Connect an AI agent</h2>

            <div className="dashboard-onboarding-steps">
              <article className="dashboard-mini-step">
                <strong>1. Send this to your agent</strong>
                <HomeCommandBox command={props.agentSkillCommand} />
              </article>

              <article className="dashboard-mini-step">
                <strong>2. Generate OttoAuth API keys</strong>
                <form className="stack-form" onSubmit={handleCreateAgentKey}>
                  <input
                    className="auth-input"
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    placeholder="Agent label"
                  />
                  <button className="auth-button primary" type="submit" disabled={creatingAgentKey}>
                    {creatingAgentKey ? "Generating..." : "Generate API keys"}
                  </button>
                </form>
              </article>

              {generatedAgentCredential && (
                <article className="dashboard-mini-step">
                  <strong>3. Send these credentials to your agent now</strong>
                  <pre className="agent-credential-block">
                    <code>{getAgentCredentialText()}</code>
                  </pre>
                  <button
                    type="button"
                    className="auth-button"
                    onClick={handleCopyAgentCredential}
                  >
                    {copiedAgentCredential ? "Copied" : "Copy agent credentials"}
                  </button>
                  <p className="dashboard-muted">
                    The private key is shown only at generation time. Create a new
                    key if you need to rotate access later.
                  </p>
                </article>
              )}
            </div>

            <div className="dashboard-list">
              {generatedAgentCredential && (
                <div className="dashboard-row">
                  <div>
                    <strong>{generatedAgentCredential.username}</strong>
                    <div className="dashboard-muted mono">@{generatedAgentCredential.username}</div>
                  </div>
                  <div className="dashboard-muted">Generated just now</div>
                </div>
              )}
              {props.linkedAgents.length === 0 && !generatedAgentCredential ? (
                <div className="dashboard-empty">No agent API keys generated yet.</div>
              ) : (
                props.linkedAgents.map((agent) => (
                  <div key={agent.id} className="dashboard-row">
                    <div>
                      <strong>{agent.username_display}</strong>
                      <div className="dashboard-muted mono">@{agent.username_lower}</div>
                      <div className="dashboard-muted dashboard-agent-spend">
                        Total spent {fmtUsd(agent.total_spent_cents ?? 0)}
                      </div>
                    </div>
                    <div className="dashboard-device-actions">
                      <div className="dashboard-muted">
                        Linked {new Date(agent.linked_at).toLocaleString()}
                      </div>
                      <button
                        type="button"
                        className="dashboard-icon-button"
                        onClick={() => handleRemoveAgent(agent.id, agent.username_display)}
                        disabled={removingAgentLinkId === agent.id}
                        aria-label={`Remove ${agent.username_display}`}
                        title="Remove agent"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        <details className="dashboard-advanced">
          <summary>Advanced</summary>
          <div className="dashboard-advanced-content">
            <section className="dashboard-grid wide">
              <article className="dashboard-card dashboard-card-span-2">
                <div className="supported-accounts-title">Link Fulfillment Agent</div>
                <div className="stack-form">
                  <input
                    className="auth-input"
                    value={deviceLabel}
                    onChange={(event) => setDeviceLabel(event.target.value)}
                    placeholder="Device label"
                  />
                  <button className="auth-button primary" onClick={handleCreateCode} disabled={creatingCode}>
                    {creatingCode ? "Generating..." : "Generate link code"}
                  </button>
                </div>
                <p className="dashboard-muted">
                  Use this link code in the OttoAuth fulfillment agent settings on the Raspberry Pi or browser machine.
                </p>
                <p className="dashboard-muted">
                  Enabled devices can receive browser fulfillment orders. Disabled devices receive neither.
                </p>

                {activeCode ? (
                  <div className="claim-code-block">
                    <div className="claim-code">{activeCode.code}</div>
                    <div className="dashboard-muted">
                      Expires {new Date(activeCode.expires_at).toLocaleString()}
                    </div>
                  </div>
                ) : (
                  <div className="dashboard-empty">No active link code yet.</div>
                )}

                <div className="dashboard-list">
                  {props.devices.length === 0 ? (
                    <div className="dashboard-empty">No fulfillment agents linked yet.</div>
                  ) : (
                    props.devices.map((device) => (
                      <div key={device.device_id} className="dashboard-row">
                        <div>
                          <strong>{device.label || device.device_id}</strong>
                          <div className="dashboard-muted mono">{device.device_id}</div>
                          <div className="dashboard-muted">
                            {device.marketplace_enabled ? "Enabled" : "Disabled"}
                            {device.last_seen_at ? ` · Seen ${new Date(device.last_seen_at).toLocaleString()}` : ""}
                          </div>
                        </div>
                        <div className="dashboard-device-actions">
                          <div className="dashboard-muted">
                            Updated {new Date(device.updated_at).toLocaleString()}
                          </div>
                          <label
                            className={`dashboard-toggle ${
                              togglingDeviceId === device.device_id ||
                              removingDeviceId === device.device_id
                                ? "is-disabled"
                                : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="dashboard-toggle-input"
                              checked={device.marketplace_enabled}
                              onChange={(event) =>
                                handleToggleMarketplace(device.device_id, event.target.checked)
                              }
                              disabled={
                                togglingDeviceId === device.device_id ||
                                removingDeviceId === device.device_id
                              }
                            />
                            <span className="dashboard-toggle-track" aria-hidden="true">
                              <span className="dashboard-toggle-thumb" />
                            </span>
                            <span className="dashboard-toggle-label">
                              {togglingDeviceId === device.device_id ? "Saving..." : "Enabled"}
                            </span>
                          </label>
                          <button
                            type="button"
                            className="dashboard-icon-button"
                            onClick={() =>
                              handleRemoveDevice(
                                device.device_id,
                                device.label || device.device_id,
                              )
                            }
                            disabled={
                              togglingDeviceId === device.device_id ||
                              removingDeviceId === device.device_id
                            }
                            aria-label={`Remove ${device.label || device.device_id}`}
                            title="Remove fulfillment agent"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </section>

            <section className="dashboard-grid wide">
              <article className="dashboard-card dashboard-card-span-2">
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
                    props.ledger.map((entry) => {
                      const href = getLedgerOrderHref(entry);
                      const content = (
                        <>
                          <div className="dashboard-activity-heading">
                            <strong>{entry.description || entry.entry_type}</strong>
                            <div className="dashboard-muted">
                              {new Date(entry.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="dashboard-activity-side">
                            <div
                              className={
                                entry.amount_cents >= 0
                                  ? "amount-positive"
                                  : "amount-negative"
                              }
                            >
                              {entry.amount_cents >= 0 ? "+" : "-"}
                              {fmtUsd(Math.abs(entry.amount_cents))}
                            </div>
                            {href && (
                              <span className="dashboard-task-cta">Open order</span>
                            )}
                          </div>
                        </>
                      );

                      return href ? (
                        <Link
                          key={entry.id}
                          href={href}
                          className="dashboard-row dashboard-activity-link"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div key={entry.id} className="dashboard-row">
                          {content}
                        </div>
                      );
                    })
                  )}
                </div>
              </article>
            </section>

            <CurrentBrowserFulfillmentClient serverUrl={props.serverUrl} embedded />
          </div>
        </details>
      </section>
    </main>
  );
}
