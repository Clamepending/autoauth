"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  AgentMandatePolicyMode,
  AgentMandatePolicyRecord,
} from "@/lib/agent-mandates";

const APPROVAL_RULES = [
  ["unknown_merchant", "Unknown merchant"],
  ["subscription", "Subscription"],
  ["gift_card", "Gift card"],
  ["travel", "Travel"],
  ["regulated_goods", "Regulated goods"],
  ["address_change", "Delivery address"],
] as const;

function centsToDollars(cents: number | null) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function dollarsToCents(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.NaN;
  return Math.round(parsed * 100);
}

function lines(values: string[]) {
  return values.join("\n");
}

function splitLines(value: string) {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function modeLabel(mode: AgentMandatePolicyMode) {
  if (mode === "paused") return "Paused";
  if (mode === "restricted") return "Restricted";
  return "Unrestricted";
}

export function AgentMandateClient(props: {
  linkId: number;
  agentUsername: string;
  initialPolicy: AgentMandatePolicyRecord;
  initialSummary: string;
}) {
  const [policy, setPolicy] = useState(props.initialPolicy);
  const [summary, setSummary] = useState(props.initialSummary);
  const [mode, setMode] = useState<AgentMandatePolicyMode>(props.initialPolicy.mode);
  const [maxPerOrder, setMaxPerOrder] = useState(
    centsToDollars(props.initialPolicy.max_per_order_cents),
  );
  const [maxDaily, setMaxDaily] = useState(centsToDollars(props.initialPolicy.max_daily_cents));
  const [maxWeekly, setMaxWeekly] = useState(centsToDollars(props.initialPolicy.max_weekly_cents));
  const [maxMonthly, setMaxMonthly] = useState(centsToDollars(props.initialPolicy.max_monthly_cents));
  const [approvalThreshold, setApprovalThreshold] = useState(
    centsToDollars(props.initialPolicy.require_approval_over_cents),
  );
  const [allowedDomains, setAllowedDomains] = useState(lines(props.initialPolicy.allowed_domains));
  const [blockedDomains, setBlockedDomains] = useState(lines(props.initialPolicy.blocked_domains));
  const [blockedCategories, setBlockedCategories] = useState(
    lines(props.initialPolicy.blocked_categories),
  );
  const [approvalRules, setApprovalRules] = useState<string[]>(
    props.initialPolicy.approval_rules,
  );
  const [naturalLanguageMandate, setNaturalLanguageMandate] = useState(
    props.initialPolicy.natural_language_mandate ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controlsDisabled = mode !== "restricted";

  const revisionLabel = useMemo(
    () => (policy.active_revision ? `Revision ${policy.active_revision}` : "Default"),
    [policy.active_revision],
  );

  function toggleApprovalRule(rule: string) {
    setApprovalRules((current) =>
      current.includes(rule)
        ? current.filter((entry) => entry !== rule)
        : [...current, rule],
    );
  }

  function buildPayload() {
    const amountFields = [
      ["Max per order", maxPerOrder, "max_per_order_cents"],
      ["Daily limit", maxDaily, "max_daily_cents"],
      ["Weekly limit", maxWeekly, "max_weekly_cents"],
      ["Monthly limit", maxMonthly, "max_monthly_cents"],
      ["Approval threshold", approvalThreshold, "require_approval_over_cents"],
    ] as const;
    const payload: Record<string, unknown> = {
      mode,
      allowed_domains: splitLines(allowedDomains),
      blocked_domains: splitLines(blockedDomains),
      blocked_categories: splitLines(blockedCategories),
      approval_rules: approvalRules,
      natural_language_mandate: naturalLanguageMandate,
    };
    for (const [label, value, key] of amountFields) {
      const cents = dollarsToCents(value);
      if (Number.isNaN(cents)) {
        throw new Error(`${label} must be blank or a positive dollar amount.`);
      }
      payload[key] = cents;
    }
    return payload;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/human/agents/${props.linkId}/mandate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            error?: string;
            policy?: AgentMandatePolicyRecord;
            summary?: string;
          }
        | null;
      if (!response.ok || !body?.policy) {
        setError(body?.error || "Could not save agent mandate.");
        return;
      }
      setPolicy(body.policy);
      setSummary(body.summary || modeLabel(body.policy.mode));
      setMessage("Saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save agent mandate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dashboard-card agent-mandate-form" onSubmit={handleSubmit}>
      <div className="dashboard-section-header">
        <div>
          <div className="supported-accounts-title">Controls</div>
          <h2 className="dashboard-card-title">Spending criteria</h2>
        </div>
        <div className="agent-mandate-summary small">
          <span>{summary}</span>
          <span>{revisionLabel}</span>
        </div>
      </div>

      <div className="agent-mandate-mode-grid" role="group" aria-label="Mandate mode">
        {(["unrestricted", "restricted", "paused"] as AgentMandatePolicyMode[]).map((entry) => (
          <button
            key={entry}
            type="button"
            className={`agent-mandate-mode-button ${mode === entry ? "selected" : ""}`}
            aria-pressed={mode === entry}
            onClick={() => setMode(entry)}
          >
            {modeLabel(entry)}
          </button>
        ))}
      </div>

      <section className="agent-mandate-field-grid" aria-label="Spending limits">
        <label>
          <span>Max per order</span>
          <input
            className="auth-input"
            inputMode="decimal"
            placeholder="No limit"
            value={maxPerOrder}
            onChange={(event) => setMaxPerOrder(event.target.value)}
            disabled={controlsDisabled}
          />
        </label>
        <label>
          <span>Daily limit</span>
          <input
            className="auth-input"
            inputMode="decimal"
            placeholder="No limit"
            value={maxDaily}
            onChange={(event) => setMaxDaily(event.target.value)}
            disabled={controlsDisabled}
          />
        </label>
        <label>
          <span>Weekly limit</span>
          <input
            className="auth-input"
            inputMode="decimal"
            placeholder="No limit"
            value={maxWeekly}
            onChange={(event) => setMaxWeekly(event.target.value)}
            disabled={controlsDisabled}
          />
        </label>
        <label>
          <span>Monthly limit</span>
          <input
            className="auth-input"
            inputMode="decimal"
            placeholder="No limit"
            value={maxMonthly}
            onChange={(event) => setMaxMonthly(event.target.value)}
            disabled={controlsDisabled}
          />
        </label>
        <label>
          <span>Ask first above</span>
          <input
            className="auth-input"
            inputMode="decimal"
            placeholder="Never"
            value={approvalThreshold}
            onChange={(event) => setApprovalThreshold(event.target.value)}
            disabled={controlsDisabled}
          />
        </label>
      </section>

      <section className="agent-mandate-text-grid" aria-label="Domain and category criteria">
        <label>
          <span>Allowed domains</span>
          <textarea
            className="auth-input"
            rows={5}
            placeholder="amazon.com"
            value={allowedDomains}
            onChange={(event) => setAllowedDomains(event.target.value)}
            disabled={controlsDisabled}
          />
        </label>
        <label>
          <span>Blocked domains</span>
          <textarea
            className="auth-input"
            rows={5}
            placeholder="example.com"
            value={blockedDomains}
            onChange={(event) => setBlockedDomains(event.target.value)}
            disabled={controlsDisabled}
          />
        </label>
        <label>
          <span>Blocked categories</span>
          <textarea
            className="auth-input"
            rows={5}
            placeholder="gift card"
            value={blockedCategories}
            onChange={(event) => setBlockedCategories(event.target.value)}
            disabled={controlsDisabled}
          />
        </label>
      </section>

      <section className="agent-mandate-check-grid" aria-label="Approval criteria">
        {APPROVAL_RULES.map(([rule, label]) => (
          <label key={rule} className="agent-mandate-check">
            <input
              type="checkbox"
              checked={approvalRules.includes(rule)}
              onChange={() => toggleApprovalRule(rule)}
              disabled={controlsDisabled}
            />
            <span>{label}</span>
          </label>
        ))}
      </section>

      <label className="agent-mandate-natural">
        <span>Mandate notes</span>
        <textarea
          className="auth-input"
          rows={4}
          placeholder={`${props.agentUsername} can buy normal work supplies.`}
          value={naturalLanguageMandate}
          onChange={(event) => setNaturalLanguageMandate(event.target.value)}
          disabled={controlsDisabled}
        />
      </label>

      {message && <div className="auth-success">{message}</div>}
      {error && <div className="auth-error">{error}</div>}

      <div className="agent-mandate-actions">
        <button className="auth-button primary" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save mandate"}
        </button>
      </div>
    </form>
  );
}
