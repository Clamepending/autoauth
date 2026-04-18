"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";

type MarketCallResult = {
  call?: {
    id?: string;
    status?: string;
  } | null;
  output?: unknown;
  receipt?: {
    receipt_id?: string;
  } | null;
  idempotent?: boolean;
};

function centsToUsd(cents: number) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function optionalDollarsToCents(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/^\$/, ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Spend cap must be a non-negative dollar amount.");
  }
  return Math.round(parsed * 100);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringField(value: unknown, field: string) {
  const object = asObject(value);
  const raw = object?.[field];
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

function resultSummary(result: MarketCallResult | null) {
  if (!result) return "";
  const output = asObject(result.output);
  const summary =
    readStringField(result.output, "summary") ||
    readStringField(result.output, "status") ||
    result.call?.status ||
    "Service call completed.";
  const taskId = output?.task_id == null ? "" : String(output.task_id);
  return taskId ? `${summary} Task #${taskId}.` : summary;
}

function resultOrderUrl(result: MarketCallResult | null) {
  if (!result) return "";
  return readStringField(result.output, "order_url");
}

function resultImageUrl(result: MarketCallResult | null) {
  if (!result) return "";
  return (
    readStringField(result.output, "image_data_url") ||
    readStringField(result.output, "image_url")
  );
}

function resultVideoUrl(result: MarketCallResult | null) {
  if (!result) return "";
  return (
    readStringField(result.output, "video_url") ||
    readStringField(result.output, "result_url")
  );
}

function prettyResult(result: MarketCallResult | null) {
  if (!result) return "";
  return JSON.stringify(result, null, 2);
}

export function MarketServiceUseForm(props: {
  serviceId: number;
  serviceName: string;
  serviceCapability: string;
  servicePriceCents: number;
  currentHumanUserId: number | null;
  isOwnPaidService: boolean;
  exampleInputJson: string;
}) {
  const [requestText, setRequestText] = useState("");
  const [inputJson, setInputJson] = useState("");
  const [maxChargeDollars, setMaxChargeDollars] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MarketCallResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!props.currentHumanUserId) {
      setError("Sign in before using a Market service.");
      return;
    }
    if (props.isOwnPaidService) {
      setError("You own this paid service, so OttoAuth will not let you pay yourself through the Market.");
      return;
    }

    let input: Record<string, unknown> = {};
    try {
      if (inputJson.trim()) {
        const parsed = JSON.parse(inputJson);
        const parsedObject = asObject(parsed);
        if (!parsedObject) {
          throw new Error("Structured input JSON must be an object.");
        }
        input = parsedObject;
      }
      const request = requestText.trim();
      if (request && input.request == null && input.prompt == null) {
        input.request = request;
      }
      const maxChargeCents = optionalDollarsToCents(maxChargeDollars);
      if (maxChargeCents != null) {
        input.max_charge_cents = maxChargeCents;
      }
      if (!Object.keys(input).length) {
        throw new Error("Add a request or structured input before submitting.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid service input.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/market/services/${props.serviceId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          max_price_cents: props.servicePriceCents,
          reason: requestText.trim() || `Use ${props.serviceCapability}`,
          idempotency_key: `human-market-${props.serviceId}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (MarketCallResult & { error?: string })
        | null;
      if (!response.ok) {
        setError(payload?.error || `Service call failed with HTTP ${response.status}.`);
        return;
      }
      setResult(payload ?? { call: { status: "settled" } });
    } finally {
      setSubmitting(false);
    }
  }

  const orderUrl = resultOrderUrl(result);
  const imageUrl = resultImageUrl(result);
  const videoUrl = resultVideoUrl(result);
  const summary = resultSummary(result);

  return (
    <article className="dashboard-card dashboard-card-span-2">
      <div>
        <div className="supported-accounts-title">Use This Service</div>
        <p className="dashboard-muted">
          Humans can submit directly here. OttoAuth will call the provider endpoint,
          handle the service fee through credits, and show the resulting receipt or
          queued order.
        </p>
      </div>

      {!props.currentHumanUserId ? (
        <div className="dashboard-actions">
          <Link className="auth-button primary" href="/login">
            Sign in to use service
          </Link>
        </div>
      ) : (
        <form className="stack-form" onSubmit={handleSubmit}>
          <label className="stack-form">
            <span className="supported-accounts-title">Request</span>
            <textarea
              className="auth-input task-textarea"
              value={requestText}
              onChange={(event) => setRequestText(event.target.value)}
              placeholder={`Tell ${props.serviceName} what you want done...`}
            />
          </label>

          <label className="stack-form">
            <span className="supported-accounts-title">Optional Spend Cap</span>
            <input
              className="auth-input"
              value={maxChargeDollars}
              onChange={(event) => setMaxChargeDollars(event.target.value)}
              placeholder="Example: 25.00"
              inputMode="decimal"
            />
            <span className="dashboard-muted">
              For browser fulfillment services, this becomes <code>input.max_charge_cents</code>.
              The listed service fee is {centsToUsd(props.servicePriceCents)}.
            </span>
          </label>

          <label className="stack-form">
            <span className="supported-accounts-title">Structured Input JSON</span>
            <textarea
              className="auth-input shipping-textarea"
              value={inputJson}
              onChange={(event) => setInputJson(event.target.value)}
              placeholder={props.exampleInputJson || "Optional JSON object, for example: {\"prompt\":\"...\"}"}
            />
            <span className="dashboard-muted">
              Optional. If you provide JSON, the request text is added as <code>request</code> only when <code>request</code> and <code>prompt</code> are missing.
            </span>
          </label>

          <button
            className="auth-button primary"
            type="submit"
            disabled={submitting || props.isOwnPaidService}
          >
            {submitting ? "Submitting..." : "Submit service request"}
          </button>
        </form>
      )}

      {props.isOwnPaidService && (
        <div className="auth-disabled">
          You can edit this service, but you cannot buy your own paid listing from the same account.
        </div>
      )}
      {error && <div className="auth-error">{error}</div>}
      {result && (
        <div className="auth-success">
          {summary}
          {(orderUrl || imageUrl || videoUrl) && (
            <div className="dashboard-actions" style={{ marginTop: 12 }}>
              {orderUrl && (
                <Link className="auth-button primary" href={orderUrl}>
                  Open queued order
                </Link>
              )}
              {imageUrl && (
                <a className="auth-button primary" href={imageUrl} target="_blank" rel="noreferrer">
                  Open image
                </a>
              )}
              {videoUrl && (
                <a className="auth-button primary" href={videoUrl} target="_blank" rel="noreferrer">
                  Open video
                </a>
              )}
            </div>
          )}
        </div>
      )}
      {imageUrl && (
        <div className="live-view-frame" style={{ maxHeight: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="live-view-image" src={imageUrl} alt="Generated Market service output" />
        </div>
      )}
      {videoUrl && (
        <video className="live-view-image" src={videoUrl} controls playsInline />
      )}
      {result && (
        <details>
          <summary className="dashboard-muted">Show raw service result</summary>
          <pre className="dashboard-prewrap">{prettyResult(result)}</pre>
        </details>
      )}
    </article>
  );
}
