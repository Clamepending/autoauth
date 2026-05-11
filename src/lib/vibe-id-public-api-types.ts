// AUTO-GENERATED from vibe-id/worker/src/public-api-types.ts
// DO NOT EDIT DIRECTLY — run scripts/sync-vibe-id-types.sh to refresh.
//
// Source: /Users/mark/Desktop/projects/vibe-id/worker/src/public-api-types.ts
// Synced: 2026-05-11T07:17:32Z

// vibe-id public API types — the canonical shapes of every payload that
// crosses the wire from vibe-id to a per-project worker.
//
// These types are mirrored in each project's vibe-id client (autoauth has
// them in src/lib/vibe-id-client.ts as a manual copy). When you change a
// shape here, search the consuming repos for the matching type name and
// update them too — typecheck on the project side catches the rest.
//
// LONG TERM: publish this file as `@vibe-research/sdk-types` on npm and
// have each project depend on it. For now, manual sync.
//
// Versioning rule:
//   - Adding a field on a response: safe (consumers ignore unknown fields).
//   - Removing or renaming a field: BREAKING. Bump VIBE_ID_PUBLIC_API_VERSION
//     and coordinate the rollout across project workers.

export const VIBE_ID_PUBLIC_API_VERSION = "2026-05-11";

// ----------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------

/** Shape returned by /auth/me, /v1/users/by-handle, /v1/users/upsert-by-google-subject. */
export interface VibeIdUserPublic {
  id: number;
  email: string;
  display_name: string | null;
  picture_url: string | null;
  daily_cap_cents: number | null;
  /** Lowercase canonical handle. Auto-assigned on signup, mutable via PUT /handle. */
  handle_lower: string | null;
  /** Case-preserving display form. Always rendered prefixed with @. */
  handle_display: string | null;
}

/** Shape returned by /auth/me. */
export interface VibeIdMeResponse {
  user: VibeIdUserPublic;
  /** The vibe-id project the install token belongs to. */
  project: string;
  /** Current balance in cents. */
  credits_balance: number;
  daily_cap_cents: number | null;
  spent_today_cents: number | null;
  spent_today_by_project_cents: Record<string, number> | null;
  usage_today_by_project: Record<string, Record<string, number>>;
}

// ----------------------------------------------------------------------------
// Credits — grant, charge, transfer
// ----------------------------------------------------------------------------

/** Response from /credits and /v1/users/:id/credits. */
export interface VibeIdBalanceResponse {
  user_id: number;
  /** Current balance in cents. */
  balance: number;
  currency: "credits";
}

/** Response from /credits/charge. */
export interface VibeIdChargeResponse {
  charged_amount: number;
  balance: number;
  already_charged: boolean;
  ledger_entry_id: number | null;
}

/** Response from /credits/topup. */
export interface VibeIdTopupResponse {
  checkout_session_id: string;
  checkout_url: string;
  amount_cents: number;
}

/** Response from /v1/grant (positive amount). */
export interface VibeIdGrantResponse {
  ok: true;
  balance: number;
}

/** Response from /v1/transfer. */
export interface VibeIdTransferResponse {
  ok: true;
  from_balance: number;
  to_balance: number;
}

/** Ledger entry from /v1/users/:id/ledger. */
export interface VibeIdLedgerEntry {
  id: number;
  /** Cents. Positive = grant, negative = charge. */
  amount: number;
  reason: string;
  /** Project that triggered the entry, or null for grants/admin. */
  project_id: string | null;
  idempotency_key: string | null;
  /** Unix seconds. */
  created_at: number;
}

/** Response from /v1/users/:id/ledger. */
export interface VibeIdLedgerResponse {
  entries: VibeIdLedgerEntry[];
}

// ----------------------------------------------------------------------------
// Email claims
// ----------------------------------------------------------------------------

export type VibeIdClaimStatus = "pending" | "claimed" | "expired";

/** Claim row returned by /v1/claims (create), /v1/users/:id/claims-pending. */
export interface VibeIdClaim {
  claim_public_id: string;
  sender_user_id: number;
  recipient_email: string;
  amount_cents: number;
  note: string;
  status: VibeIdClaimStatus;
  claimed_user_id: number | null;
  /** Unix seconds when accepted. */
  claimed_at: number | null;
  /** Unix seconds. */
  expires_at: number;
  /** Unix seconds. */
  created_at: number;
}

/** Response from POST /v1/claims. */
export interface VibeIdCreateClaimResponse {
  ok: true;
  claim: VibeIdClaim;
  sender_balance: number;
}

/** Response from POST /v1/claims/expire-due. */
export interface VibeIdExpireDueClaimsResponse {
  ok: true;
  expired: Array<{ claim_public_id: string; refunded_cents: number }>;
}

// ----------------------------------------------------------------------------
// Referrals
// ----------------------------------------------------------------------------

/** Response from GET /v1/users/:id/referrals. */
export interface VibeIdReferralStatsResponse {
  user_id: number;
  total_referrals: number;
  qualified_referrals: number;
  total_bonus_cents: number;
}

// ----------------------------------------------------------------------------
// Handles
// ----------------------------------------------------------------------------

/** Response from PUT /handle and PUT /v1/users/:id/handle. */
export interface VibeIdHandleSetResponse {
  ok: true;
  handle_lower: string;
  handle_display: string;
}

/** Response from GET /handle. */
export interface VibeIdHandleGetResponse {
  handle_lower: string | null;
  handle_display: string | null;
}

/** Response from GET /handle/availability/:handle. */
export interface VibeIdHandleAvailabilityResponse {
  ok: boolean;
  available: boolean;
  value?: string;
  error?: string;
  note?: "your_current_handle";
}

// ----------------------------------------------------------------------------
// Audit
// ----------------------------------------------------------------------------

export type VibeIdAuditAction =
  | "signup"
  | "handle_change"
  | "referral_created"
  | "referral_qualified"
  | "claim_created"
  | "claim_accepted"
  | "claim_expired"
  | "admin_grant"
  | "stripe_topup";

/** Audit log entry from /admin/audit-log. */
export interface VibeIdAuditEntry {
  id: number;
  action: VibeIdAuditAction;
  actor_kind: "user" | "internal" | "admin" | "system";
  actor_user_id: number | null;
  target_user_id: number | null;
  project_id: string | null;
  metadata: Record<string, unknown>;
  /** Unix seconds. */
  created_at: number;
}
