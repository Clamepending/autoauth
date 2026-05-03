"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { HumanUserRecord } from "@/lib/human-accounts";

type ResolvedRecipient = {
  id: number | null;
  handle: string | null;
  email: string | null;
  display_name: string | null;
  picture_url: string | null;
  matched_by: "human_handle" | "email" | "agent_username" | "pending_email";
  agent_username: string | null;
};

type SendResult = {
  transfer: {
    id: string;
    amount_cents: number;
    note: string;
    status: string;
    created_at: string;
    expires_at?: string;
  };
  recipient: {
    handle: string | null;
    email: string | null;
    display_name: string | null;
    picture_url: string | null;
  };
  pending_claim?: boolean;
  email?: {
    ok: boolean;
    provider?: "webhook" | "resend";
    skipped?: "unconfigured";
    error?: string;
  };
  balance_cents: number;
};

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseUsdToCents(value: string) {
  const normalized = value.trim().replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function displayNameForRecipient(recipient: ResolvedRecipient) {
  return (
    recipient.display_name?.trim() ||
    (recipient.handle ? `@${recipient.handle}` : recipient.email || "Recipient")
  );
}

function recipientHandleText(recipient: ResolvedRecipient) {
  return recipient.handle ? `@${recipient.handle}` : recipient.email || "";
}

function resultRecipientLabel(result: SendResult) {
  return result.recipient.handle
    ? `@${result.recipient.handle}`
    : result.recipient.email || "recipient";
}

function RecipientAvatar(props: {
  name: string;
  handle?: string | null;
  pictureUrl?: string | null;
  size?: "sm" | "lg";
}) {
  const fallback = props.handle || props.name;
  const initials = props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || fallback.slice(0, 2).toUpperCase();

  return (
    <div className={`payment-avatar payment-avatar-${props.size ?? "sm"}`}>
      {props.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={props.pictureUrl} alt="" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

export function SendMoneyClient(props: {
  user: HumanUserRecord;
  balanceCents: number;
  initialRecipient?: string;
}) {
  const [recipientInput, setRecipientInput] = useState(
    props.initialRecipient || "",
  );
  const [recipient, setRecipient] = useState<ResolvedRecipient | null>(null);
  const [amountUsd, setAmountUsd] = useState("");
  const [note, setNote] = useState("");
  const [balanceCents, setBalanceCents] = useState(props.balanceCents);
  const [resolving, setResolving] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const amountCents = useMemo(() => parseUsdToCents(amountUsd), [amountUsd]);
  const canReview =
    Boolean(recipient) &&
    Boolean(amountCents) &&
    amountCents != null &&
    amountCents <= balanceCents &&
    note.trim().length > 0 &&
    note.trim().length <= 280;

  async function resolveRecipient(value = recipientInput) {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter an OttoAuth handle, email, profile link, or linked agent username.");
      setRecipient(null);
      return;
    }

    setResolving(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(
        `/api/human/payments/resolve?recipient=${encodeURIComponent(trimmed)}`,
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setRecipient(null);
        setError(payload?.error || "No OttoAuth account matched that recipient.");
        return;
      }
      if (payload?.is_self) {
        setRecipient(null);
        setError("Choose a different OttoAuth account to pay.");
        return;
      }
      setRecipient(payload.recipient as ResolvedRecipient);
    } finally {
      setResolving(false);
    }
  }

  useEffect(() => {
    if (props.initialRecipient) {
      void resolveRecipient(props.initialRecipient);
    }
    // Resolve the deep-link recipient once on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipient) {
      void resolveRecipient();
      return;
    }
    if (!amountCents) {
      setError("Enter an amount to send.");
      return;
    }
    if (amountCents > balanceCents) {
      setError(`You only have ${fmtUsd(balanceCents)} available.`);
      return;
    }
    if (!note.trim()) {
      setError("Add a note before sending.");
      return;
    }
    if (note.trim().length > 280) {
      setError("Notes must be 280 characters or fewer.");
      return;
    }
    setError(null);
    setReviewing(true);
  }

  async function handleSend() {
    if (!recipient || !amountCents) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/human/payments/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: recipientInput,
          amount_cents: amountCents,
          note,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Could not send OttoAuth credits.");
        setReviewing(false);
        return;
      }
      setBalanceCents(Number(payload.balance_cents ?? balanceCents - amountCents));
      setResult(payload as SendResult);
      setReviewing(false);
    } finally {
      setSending(false);
    }
  }

  function resetForAnotherPayment() {
    setRecipientInput("");
    setRecipient(null);
    setAmountUsd("");
    setNote("");
    setReviewing(false);
    setError(null);
    setResult(null);
  }

  return (
    <main className="dashboard-page payment-page-shell">
      <section className="dashboard-shell payment-shell">
        <div className="dashboard-header payment-header">
          <div>
            <h1>Send Money</h1>
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

        {result ? (
          <article className="dashboard-card payment-complete-card">
            <div className="payment-success-mark" aria-hidden="true">
              OK
            </div>
            <div>
              <div className="supported-accounts-title">
                {result.pending_claim ? "Claim created" : "Payment sent"}
              </div>
              <h2 className="dashboard-card-title">
                {fmtUsd(result.transfer.amount_cents)} to{" "}
                {resultRecipientLabel(result)}
              </h2>
              <p className="dashboard-muted">
                {result.transfer.note} - {new Date(result.transfer.created_at).toLocaleString()}
              </p>
              {result.pending_claim && (
                <p className="dashboard-muted">
                  The credits are held for that email address for one week. They will be released when the recipient signs up or signs in with the same email before{" "}
                  {result.transfer.expires_at
                    ? new Date(result.transfer.expires_at).toLocaleString()
                    : "the claim expires"}.
                </p>
              )}
              {result.pending_claim && result.email?.skipped === "unconfigured" && (
                <div className="auth-error">
                  Claim created, but email delivery is not configured on this deployment.
                </div>
              )}
              {result.pending_claim && result.email?.ok === false && (
                <div className="auth-error">
                  Claim created, but the invite email could not be sent: {result.email.error}
                </div>
              )}
            </div>
            <div className="quick-facts-grid">
              <div className="quick-fact-card">
                <div className="quick-fact-label">Remaining balance</div>
                <div className="quick-fact-value">{fmtUsd(result.balance_cents)}</div>
              </div>
              <div className="quick-fact-card">
                <div className="quick-fact-label">Transfer id</div>
                <div className="quick-fact-value mono">{result.transfer.id}</div>
              </div>
            </div>
            <div className="dashboard-actions">
              <button
                type="button"
                className="auth-button primary"
                onClick={resetForAnotherPayment}
              >
                Send another
              </button>
              <Link className="auth-button" href="/dashboard">
                Done
              </Link>
            </div>
          </article>
        ) : reviewing && recipient && amountCents ? (
          <article className="dashboard-card payment-review-card">
            <div className="supported-accounts-title">Review payment</div>
            <div className="payment-review-recipient">
              <RecipientAvatar
                name={displayNameForRecipient(recipient)}
                handle={recipient.handle}
                pictureUrl={recipient.picture_url}
                size="lg"
              />
              <div>
                <strong>{displayNameForRecipient(recipient)}</strong>
                <div className="dashboard-muted mono">{recipientHandleText(recipient)}</div>
                {recipient.agent_username && (
                  <div className="dashboard-muted">
                    Paying linked agent @{recipient.agent_username}
                  </div>
                )}
                {recipient.matched_by === "pending_email" && (
                  <div className="dashboard-muted">
                    OttoAuth will email them to claim this payment.
                  </div>
                )}
              </div>
            </div>
            <div className="payment-review-amount">{fmtUsd(amountCents)}</div>
            <div className="payment-note-preview">{note.trim()}</div>
            {error && <div className="auth-error">{error}</div>}
            <div className="dashboard-actions">
              <button
                type="button"
                className="auth-button primary"
                onClick={handleSend}
                disabled={sending}
              >
                {sending
                  ? "Sending..."
                  : recipient.matched_by === "pending_email"
                    ? `Send ${fmtUsd(amountCents)} invite`
                    : `Pay ${fmtUsd(amountCents)}`}
              </button>
              <button
                type="button"
                className="auth-button"
                onClick={() => setReviewing(false)}
                disabled={sending}
              >
                Edit
              </button>
            </div>
          </article>
        ) : (
          <section className="payment-grid">
            <article className="dashboard-card payment-compose-card">
              <div className="supported-accounts-title">Payment</div>

              <form className="stack-form" onSubmit={handleReview}>
                <label className="stack-form">
                  <span className="supported-accounts-title">To</span>
                  <div className="payment-recipient-input-row">
                    <input
                      className="auth-input"
                      value={recipientInput}
                      onChange={(event) => {
                        setRecipientInput(event.target.value);
                        setRecipient(null);
                        setError(null);
                      }}
                      onBlur={() => {
                        if (recipientInput.trim() && !recipient) {
                          void resolveRecipient();
                        }
                      }}
                      placeholder="@handle, email, linked agent username, or profile link"
                    />
                    <button
                      type="button"
                      className="auth-button"
                      onClick={() => resolveRecipient()}
                      disabled={resolving}
                    >
                      {resolving ? "Finding..." : "Find"}
                    </button>
                  </div>
                </label>

                {recipient && (
                  <div className="payment-recipient-card">
                    <RecipientAvatar
                      name={displayNameForRecipient(recipient)}
                      handle={recipient.handle}
                      pictureUrl={recipient.picture_url}
                    />
                    <div>
                      <strong>{displayNameForRecipient(recipient)}</strong>
                      <div className="dashboard-muted mono">{recipientHandleText(recipient)}</div>
                      {recipient.agent_username && (
                        <div className="dashboard-muted">
                          Linked agent @{recipient.agent_username}
                        </div>
                      )}
                      {recipient.matched_by === "pending_email" && (
                        <div className="dashboard-muted">
                          No OttoAuth account yet. This will send an email invite and hold the credits for one week.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <label className="stack-form">
                  <span className="supported-accounts-title">Amount</span>
                  <div className="payment-amount-input">
                    <span>$</span>
                    <input
                      value={amountUsd}
                      onChange={(event) => {
                        setAmountUsd(event.target.value);
                        setError(null);
                      }}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </div>
                </label>

                <label className="stack-form">
                  <span className="supported-accounts-title">What is it for?</span>
                  <textarea
                    className="auth-input payment-note-input"
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value.slice(0, 280));
                      setError(null);
                    }}
                    placeholder="Add a note"
                  />
                  <span className="dashboard-muted">{note.length}/280</span>
                </label>

                <div className="payment-balance-line">
                  <span>OttoAuth balance</span>
                  <strong>{fmtUsd(balanceCents)}</strong>
                </div>

                {error && <div className="auth-error">{error}</div>}

                <button
                  className="auth-button primary payment-submit-button"
                  type="submit"
                  disabled={!canReview}
                >
                  Review payment
                </button>
              </form>
            </article>

            <article className="dashboard-card payment-profile-card">
              <div className="supported-accounts-title">Your OttoAuth profile</div>
              <div className="payment-recipient-card">
                <RecipientAvatar
                  name={props.user.display_name || props.user.email}
                  handle={props.user.handle_display}
                  pictureUrl={props.user.picture_url}
                />
                <div>
                  <strong>{props.user.display_name || props.user.email}</strong>
                  <div className="dashboard-muted mono">@{props.user.handle_display}</div>
                </div>
              </div>
              <img
                className="payment-qr-image"
                src={`/api/profile/qr?handle=${encodeURIComponent(props.user.handle_lower)}`}
                alt={`QR code for @${props.user.handle_display}`}
              />
              <div className="dashboard-muted">
                Share this profile link or QR code so another OttoAuth account can open your profile and pay you.
              </div>
              <Link
                className="auth-button"
                href={`/u/${encodeURIComponent(props.user.handle_lower)}`}
              >
                Open profile
              </Link>
            </article>
          </section>
        )}
      </section>
    </main>
  );
}
