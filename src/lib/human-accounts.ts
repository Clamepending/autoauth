import { randomBytes, randomUUID } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { generatePrivateKey, normalizePairingKey } from "@/lib/agent-auth";
import {
  createAgent,
  ensureSchema,
  getAgentByPairingKey,
  getAgentByUsername,
  markAgentPairingKeyConsumed,
  type AgentRecord,
} from "@/lib/db";
import { runSerializedSchemaMigration } from "@/lib/schema-lock";
import { getTursoClient } from "@/lib/turso";

export type HumanUserRecord = {
  id: number;
  email: string;
  email_verified: number;
  google_sub: string | null;
  auth_provider: string;
  handle_lower: string;
  handle_display: string;
  display_name: string | null;
  picture_url: string | null;
  created_at: string;
  updated_at: string;
};

export type HumanAgentLinkRecord = {
  id: number;
  human_user_id: number;
  agent_id: number;
  pairing_key_used: string;
  linked_at: string;
  created_at: string;
  updated_at: string;
};

export type HumanAgentLinkWithAgentRecord = HumanAgentLinkRecord & {
  username_lower: string;
  username_display: string;
  callback_url: string | null;
  description: string | null;
};

export type HumanDevicePairingCodeRecord = {
  id: number;
  human_user_id: number;
  code: string;
  device_label: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreditLedgerRecord = {
  id: number;
  human_user_id: number;
  amount_cents: number;
  entry_type: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata_json: string | null;
  created_at: string;
};

export type HumanCreditTransferRecord = {
  id: number;
  transfer_public_id: string;
  sender_human_user_id: number;
  recipient_human_user_id: number;
  amount_cents: number;
  note: string;
  status: string;
  created_at: string;
};

export type HumanCreditClaimRecord = {
  id: number;
  claim_public_id: string;
  sender_human_user_id: number;
  recipient_email: string;
  amount_cents: number;
  note: string;
  status: "pending" | "claimed" | "expired" | string;
  claimed_human_user_id: number | null;
  claimed_at: string | null;
  expires_at: string;
  created_at: string;
};

export type HumanPaymentRecipient = {
  humanUser: HumanUserRecord;
  matchedBy: "human_handle" | "email" | "agent_username";
  agentUsernameLower?: string | null;
  agentUsernameDisplay?: string | null;
};

export type HumanReferralStats = {
  successful_referrals: number;
  total_bonus_cents: number;
};

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

export const REFERRAL_BONUS_CENTS = 500;
export const MAX_CREDIT_TRANSFER_CENTS = 50000;
export const MAX_CREDIT_TRANSFER_NOTE_LENGTH = 280;
export const CREDIT_CLAIM_EXPIRY_DAYS = 7;
const RESERVED_ADDRESS_NAMES = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "dashboard",
  "docs",
  "help",
  "human",
  "login",
  "logout",
  "orders",
  "ottoauth",
  "pay",
  "root",
  "send",
  "settings",
  "support",
  "system",
  "www",
]);

type SqlExecutor = Pick<Client, "execute"> | Pick<Transaction, "execute">;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDeviceCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeHumanHandleLookup(value: string) {
  const normalized = value.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized)) return null;
  return normalized;
}

export function validateOttoAuthAddress(value: string) {
  const normalized = normalizeHumanHandleLookup(value);
  if (!normalized) {
    return {
      ok: false as const,
      error: "Username must be 3-32 characters and use letters, numbers, underscores, or dashes.",
    };
  }
  if (RESERVED_ADDRESS_NAMES.has(normalized)) {
    return { ok: false as const, error: `@${normalized} is reserved.` };
  }
  return { ok: true as const, value: normalized };
}

export function normalizePaymentRecipientInput(value: string) {
  let candidate = value.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const to = url.searchParams.get("to")?.trim();
    if (to) {
      candidate = to;
    } else {
      const pathParts = url.pathname.split("/").filter(Boolean);
      const userIndex = pathParts.findIndex((part) => part === "u");
      if (userIndex >= 0 && pathParts[userIndex + 1]) {
        candidate = decodeURIComponent(pathParts[userIndex + 1]);
      }
    }
  } catch {
    const profileMatch = candidate.match(/\/u\/([^/?#\s]+)/);
    if (profileMatch?.[1]) {
      candidate = decodeURIComponent(profileMatch[1]);
    }
  }

  candidate = candidate.trim();
  if (!candidate) return null;
  if (candidate.includes("@") && candidate.includes(".")) {
    return normalizeEmail(candidate);
  }
  return normalizeHumanHandleLookup(candidate);
}

function displayToken(raw: string) {
  const groups = raw.match(/.{1,4}/g);
  return groups ? groups.join("-") : raw;
}

function randomDisplayToken(byteLength = 10) {
  return displayToken(randomBytes(byteLength).toString("hex").toUpperCase());
}

function normalizeGeneratedAgentUsernameBase(value: string, humanUserId: number) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  const base = cleaned.length >= 3 ? cleaned : `agent_${humanUserId}`;
  return base.slice(0, 21).replace(/^[_-]+|[_-]+$/g, "") || `agent_${humanUserId}`;
}

function fallbackHumanHandle(row: Record<string, unknown>) {
  return `user_${Number(row.id) || 0}`;
}

function mapHumanUser(row: Record<string, unknown>): HumanUserRecord {
  const fallbackHandle = fallbackHumanHandle(row);
  const handleLower =
    row.handle_lower == null || String(row.handle_lower).trim() === ""
      ? fallbackHandle
      : String(row.handle_lower);
  return {
    id: Number(row.id),
    email: String(row.email),
    email_verified: Number(row.email_verified ?? 0),
    google_sub: row.google_sub == null ? null : String(row.google_sub),
    auth_provider: String(row.auth_provider),
    handle_lower: handleLower,
    handle_display:
      row.handle_display == null || String(row.handle_display).trim() === ""
        ? handleLower
        : String(row.handle_display),
    display_name: row.display_name == null ? null : String(row.display_name),
    picture_url: row.picture_url == null ? null : String(row.picture_url),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function parseHumanReferralCode(
  value: string | number | null | undefined,
) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const normalized = value?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }
  return Number(normalized);
}

export async function ensureHumanAccountSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = ensureHumanAccountSchemaOnce().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function ensureHumanAccountSchemaOnce() {
  if (schemaReady) return;
  await ensureSchema();
  await runSerializedSchemaMigration(ensureHumanAccountSchemaMigration);
}

async function ensureHumanAccountSchemaMigration() {
  if (schemaReady) return;
  const client = getTursoClient();

  await client.execute(
    `CREATE TABLE IF NOT EXISTS human_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      google_sub TEXT UNIQUE,
      auth_provider TEXT NOT NULL,
      handle_lower TEXT,
      handle_display TEXT,
      display_name TEXT,
      picture_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  // handle_lower / handle_display are populated from vibe-id on each
  // sign-in via syncHumanRowFromVibeIdUser. The columns exist purely as
  // a cache; vibe-id is the authoritative source. We keep the unique
  // index so a stale local cache can't accidentally duplicate handles.
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_human_users_handle_lower ON human_users(handle_lower)",
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS human_agent_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      human_user_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL UNIQUE,
      pairing_key_used TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_agent_links_human_id ON human_agent_links(human_user_id)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_human_agent_links_pair ON human_agent_links(human_user_id, agent_id)",
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS human_agent_mandate_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      human_agent_link_id INTEGER NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'unrestricted',
      max_per_order_cents INTEGER,
      max_daily_cents INTEGER,
      max_weekly_cents INTEGER,
      max_monthly_cents INTEGER,
      require_approval_over_cents INTEGER,
      allowed_domains_json TEXT NOT NULL DEFAULT '[]',
      blocked_domains_json TEXT NOT NULL DEFAULT '[]',
      blocked_categories_json TEXT NOT NULL DEFAULT '[]',
      approval_rules_json TEXT NOT NULL DEFAULT '[]',
      natural_language_mandate TEXT,
      active_revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_agent_mandate_policies_link ON human_agent_mandate_policies(human_agent_link_id)",
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS human_agent_mandate_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      human_agent_link_id INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      policy_snapshot_json TEXT NOT NULL,
      created_by_human_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_human_agent_mandate_revisions_link_revision
      ON human_agent_mandate_revisions(human_agent_link_id, revision)`,
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS human_device_pairing_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      human_user_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      device_label TEXT,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_device_pairing_codes_human_id ON human_device_pairing_codes(human_user_id)",
  );

  // human_credit_claims and human_referrals are now owned by vibe-id.
  // Their CREATE TABLE blocks have been removed; the legacy local rows
  // are dropped via scripts/vibe-id-migration/phase4-drop-local-claims-referrals.mjs
  // after deploy.

  // vibe_id_user_id — link from a local human_users row to its vibe-id
  // counterpart. Populated either by the migration script (one-time copy
  // for existing rows) or by the vibe-id sign-in callback (for new rows
  // created post-migration). NULL until linked, so pre-migration code
  // paths that read by humanUserId continue to work.
  const humanUsersAddedColumns = await client.execute({
    sql: "PRAGMA table_info(human_users)",
    args: [],
  });
  const humanUsersColumnNames = ((humanUsersAddedColumns.rows ?? []) as unknown as { name: string }[]).map(
    (column) => column.name,
  );
  if (!humanUsersColumnNames.includes("vibe_id_user_id")) {
    await client.execute("ALTER TABLE human_users ADD COLUMN vibe_id_user_id INTEGER");
  }
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_human_users_vibe_id_user_id ON human_users(vibe_id_user_id) WHERE vibe_id_user_id IS NOT NULL",
  );

  schemaReady = true;
}

// ---------------------------------------------------------------------------
// vibe-id linkage — bridge between local human_users.id and the vibe-id
// users.id. Phase 1 of the vibe-id migration: every signed-in user has both,
// linked by this column. See MIGRATION_TO_VIBE_ID.md for the bigger picture.
// ---------------------------------------------------------------------------

export async function setVibeIdUserIdForHuman(humanUserId: number, vibeIdUserId: number) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  await client.execute({
    sql: "UPDATE human_users SET vibe_id_user_id = ? WHERE id = ?",
    args: [vibeIdUserId, humanUserId],
  });
}

export async function getVibeIdUserIdForHuman(humanUserId: number): Promise<number | null> {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT vibe_id_user_id FROM human_users WHERE id = ?",
    args: [humanUserId],
  });
  const row = (result.rows ?? [])[0] as { vibe_id_user_id?: number | bigint | null } | undefined;
  if (!row || row.vibe_id_user_id == null) return null;
  return Number(row.vibe_id_user_id);
}

export async function findHumanByVibeIdUserId(vibeIdUserId: number): Promise<HumanUserRecord | null> {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM human_users WHERE vibe_id_user_id = ? LIMIT 1",
    args: [vibeIdUserId],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapHumanUser(row) : null;
}

/// Get-or-create a local human_users row for a vibe-id user. Called by the
/// vibe-id sign-in callback for new users (they have a vibe-id account but
/// no autoauth row yet) and by the migration script for existing users.
///
/// If `humanUserIdHint` is set, link THAT row to the given vibe-id user id
/// (used by the migration script to preserve existing local ids). Otherwise,
/// look up by email or create a fresh local row.
///
/// Email-claim credits are auto-accepted by vibe-id at /auth/exchange time,
/// so autoauth doesn't need to call into the claim flow here.
export async function ensureHumanForVibeIdUser(params: {
  vibeIdUserId: number;
  email: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  googleSub?: string | null;
  handleLower?: string | null;
  handleDisplay?: string | null;
  humanUserIdHint?: number;
}): Promise<HumanUserRecord> {
  await ensureHumanAccountSchema();
  const client = getTursoClient();

  const existingByVibeId = await findHumanByVibeIdUserId(params.vibeIdUserId);
  if (existingByVibeId) {
    await syncHumanRowFromVibeIdUser(existingByVibeId.id, params);
    return (await getHumanUserById(existingByVibeId.id)) ?? existingByVibeId;
  }

  if (params.humanUserIdHint != null) {
    await setVibeIdUserIdForHuman(params.humanUserIdHint, params.vibeIdUserId);
    await syncHumanRowFromVibeIdUser(params.humanUserIdHint, params);
    const linked = await getHumanUserById(params.humanUserIdHint);
    if (linked) return linked;
  }

  // Look up by email — covers the case where the user existed locally
  // (e.g. signed in via the legacy Google flow) but isn't yet linked.
  const existingByEmail = await getHumanUserByEmail(params.email);
  if (existingByEmail) {
    await setVibeIdUserIdForHuman(existingByEmail.id, params.vibeIdUserId);
    await syncHumanRowFromVibeIdUser(existingByEmail.id, params);
    const refreshed = await getHumanUserById(existingByEmail.id);
    if (refreshed) return refreshed;
  }

  // Brand-new user: create a local row linked to vibe-id. Credit grants
  // (signup bonuses, pending email claims) are vibe-id's responsibility.
  const now = new Date().toISOString();
  const insertResult = await client.execute({
    sql: `INSERT INTO human_users
          (email, email_verified, google_sub, auth_provider, display_name, picture_url, vibe_id_user_id, handle_lower, handle_display, created_at, updated_at)
          VALUES (?, 1, ?, 'vibe-id', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      normalizeEmail(params.email),
      params.googleSub?.trim() || null,
      params.displayName?.trim() || null,
      params.pictureUrl?.trim() || null,
      params.vibeIdUserId,
      params.handleLower?.trim() || null,
      params.handleDisplay?.trim() || params.handleLower?.trim() || null,
      now,
      now,
    ],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  const newHumanUserId = rawId != null ? Number(rawId) : 0;
  if (!newHumanUserId) throw new Error("Failed to create human row for vibe-id user.");

  const created = await getHumanUserById(newHumanUserId);
  if (!created) throw new Error("Failed to load newly-created human row.");
  return created;
}

/// Sync vibe-id-owned profile fields (email, display_name, picture_url,
/// handle_lower, handle_display) into the local cache row if any of them
/// have drifted. This keeps the OttoAuth dashboard rendering fast (no
/// vibe-id roundtrip per page) while still letting vibe-id be the source
/// of truth — when the user updates their profile in vibe-id, the next
/// OttoAuth sign-in pulls the change forward.
async function syncHumanRowFromVibeIdUser(
  humanUserId: number,
  vibeIdFields: {
    email: string;
    displayName?: string | null;
    pictureUrl?: string | null;
    handleLower?: string | null;
    handleDisplay?: string | null;
  },
): Promise<void> {
  const client = getTursoClient();
  const updates: Array<{ column: string; value: string | null }> = [];
  const current = await client.execute({
    sql: "SELECT email, display_name, picture_url, handle_lower, handle_display FROM human_users WHERE id = ?",
    args: [humanUserId],
  });
  const row = current.rows?.[0] as {
    email?: string;
    display_name?: string | null;
    picture_url?: string | null;
    handle_lower?: string | null;
    handle_display?: string | null;
  } | undefined;
  if (!row) return;

  const desiredEmail = normalizeEmail(vibeIdFields.email);
  if (row.email !== desiredEmail) updates.push({ column: "email", value: desiredEmail });
  const desiredDisplay = vibeIdFields.displayName?.trim() || null;
  if ((row.display_name ?? null) !== desiredDisplay) updates.push({ column: "display_name", value: desiredDisplay });
  const desiredPicture = vibeIdFields.pictureUrl?.trim() || null;
  if ((row.picture_url ?? null) !== desiredPicture) updates.push({ column: "picture_url", value: desiredPicture });
  const desiredHandle = vibeIdFields.handleLower?.trim() || null;
  if (desiredHandle && row.handle_lower !== desiredHandle) updates.push({ column: "handle_lower", value: desiredHandle });
  const desiredHandleDisplay = vibeIdFields.handleDisplay?.trim() || desiredHandle || null;
  if (desiredHandleDisplay && row.handle_display !== desiredHandleDisplay) updates.push({ column: "handle_display", value: desiredHandleDisplay });

  if (updates.length === 0) return;
  const setClause = updates.map((u) => `${u.column} = ?`).join(", ");
  await client.execute({
    sql: `UPDATE human_users SET ${setClause}, updated_at = ? WHERE id = ?`,
    args: [...updates.map((u) => u.value), new Date().toISOString(), humanUserId],
  });
}

/// Map a vibe-id ledger entry (from /v1/users/:id/ledger) to autoauth's
/// CreditLedgerRecord shape so existing callers keep working unchanged.
/// vibe-id doesn't have reference_type/reference_id/metadata — those are
/// autoauth-only constructs. We try to recover them from the
/// `idempotency_key` (which we encode as `autoauth:<entry_type>:<ref_type>:<ref_id>`).
function mapVibeIdLedgerEntryToAutoauthShape(
  entry: Record<string, unknown>,
  humanUserId: number,
): CreditLedgerRecord {
  const idempotencyKey = String(entry.idempotency_key ?? "");
  const idempotencyParts = idempotencyKey.startsWith("autoauth:")
    ? idempotencyKey.slice("autoauth:".length).split(":")
    : [];
  const entryType = String(entry.reason ?? "").split(":")[0] || idempotencyParts[0] || "credit";
  const referenceType = idempotencyParts[1] ?? null;
  const referenceId = idempotencyParts[2] ?? null;
  // vibe-id stores created_at as unix seconds; autoauth uses ISO strings.
  const createdAtSeconds = Number(entry.created_at ?? 0);
  const createdAtIso = createdAtSeconds > 0
    ? new Date(createdAtSeconds * 1000).toISOString()
    : new Date().toISOString();
  return {
    id: Number(entry.id ?? 0),
    human_user_id: humanUserId,
    amount_cents: Number(entry.amount ?? 0),
    entry_type: entryType,
    description: typeof entry.reason === "string" ? entry.reason : null,
    reference_type: referenceType,
    reference_id: referenceId,
    metadata_json: null,
    created_at: createdAtIso,
  };
}

export async function getHumanUserById(id: number) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM human_users WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapHumanUser(row) : null;
}

export async function getHumanUserByEmail(email: string) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM human_users WHERE email = ? LIMIT 1",
    args: [normalizeEmail(email)],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapHumanUser(row) : null;
}

export async function ensureOttoAuthInternalHumanUser() {
  await ensureHumanAccountSchema();
  const configuredId = Number(process.env.OTTOAUTH_INTERNAL_HUMAN_USER_ID ?? "");
  if (Number.isInteger(configuredId) && configuredId > 0) {
    const configured = await getHumanUserById(configuredId);
    if (configured) return configured;
  }

  const email = normalizeEmail(
    process.env.OTTOAUTH_INTERNAL_HUMAN_EMAIL || "ottoauth-internal@ottoauth.local",
  );
  const existing = await getHumanUserByEmail(email);
  if (existing) return existing;

  const client = getTursoClient();
  const now = new Date().toISOString();
  const insertResult = await client.execute({
    sql: `INSERT INTO human_users
          (email, email_verified, google_sub, auth_provider, display_name, picture_url, created_at, updated_at)
          VALUES (?, 1, NULL, 'system', 'OttoAuth Internal', NULL, ?, ?)`,
    args: [email, now, now],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  let userId = rawId != null ? Number(rawId) : 0;
  if (userId === 0) {
    const fallback = await client.execute({
      sql: "SELECT id FROM human_users WHERE email = ? LIMIT 1",
      args: [email],
    });
    userId = Number((fallback.rows?.[0] as { id?: number | string } | undefined)?.id ?? 0);
  }
  const user = userId > 0 ? await getHumanUserById(userId) : null;
  if (!user) throw new Error("Failed to create OttoAuth internal human user.");
  return user;
}

/// Add a credit ledger entry. Writes go to vibe-id (the global ledger,
/// the source of truth). Idempotency key is derived from the reference
/// when present so retries are safe.
///
/// Throws if the human is not linked to a vibe-id user — that's a
/// migration gap and we want it to fail loudly rather than silently
/// drop the credit movement.
export async function addCreditLedgerEntry(params: {
  humanUserId: number;
  amountCents: number;
  entryType: string;
  description?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await ensureHumanAccountSchema();

  const vibeIdUserId = await getVibeIdUserIdForHuman(params.humanUserId);
  if (vibeIdUserId == null) {
    throw new Error(
      `addCreditLedgerEntry: human_user_id=${params.humanUserId} has no vibe_id_user_id. Run scripts/vibe-id-migration/migrate-balances-to-vibe-id.ts --apply before charging this user.`,
    );
  }

  const idempotencyKey = params.referenceType && params.referenceId
    ? `autoauth:${params.entryType}:${params.referenceType}:${params.referenceId}`
    : `autoauth:${params.entryType}:human-${params.humanUserId}:${params.amountCents}:${(params.description ?? "").slice(0, 40)}`;
  const reason = params.description?.trim() || params.entryType;

  const vibeIdClient = await import("@/lib/vibe-id-client");
  if (params.amountCents > 0) {
    const grantResult = await vibeIdClient.grantCreditsToUser({
      vibeIdUserId,
      amountCents: params.amountCents,
      reason,
      idempotencyKey,
    });
    if (!grantResult.ok) {
      throw new Error(`vibe-id /v1/grant failed (${grantResult.status}): ${grantResult.error}`);
    }
  } else if (params.amountCents < 0) {
    const chargeResult = await vibeIdClient.chargeCreditsForUserId({
      vibeIdUserId,
      amountCents: Math.abs(params.amountCents),
      reason,
      idempotencyKey,
      project: "ottoauth",
    });
    if (!chargeResult.ok) {
      throw new Error(`vibe-id /v1/charge failed (${chargeResult.status}): ${chargeResult.error}`);
    }
  } // amount == 0: skip (no-op)
}

/// Read the user's current credit balance from vibe-id. Throws if the
/// user isn't linked to vibe-id or if vibe-id is unreachable.
export async function getHumanCreditBalance(humanUserId: number) {
  await ensureHumanAccountSchema();
  await expireExpiredHumanCreditClaims();
  const vibeIdUserId = await getVibeIdUserIdForHuman(humanUserId);
  if (vibeIdUserId == null) {
    throw new Error(
      `getHumanCreditBalance: human_user_id=${humanUserId} has no vibe_id_user_id. Run the vibe-id migration for this user.`,
    );
  }
  const vibeIdClient = await import("@/lib/vibe-id-client");
  const balance = await vibeIdClient.getCreditsBalanceForVibeUser(vibeIdUserId);
  if (!balance.ok) {
    throw new Error(`vibe-id /v1/users/${vibeIdUserId}/credits failed: ${balance.status} ${balance.error}`);
  }
  return balance.balanceCents;
}

/// List recent ledger entries from vibe-id, mapped to autoauth's
/// CreditLedgerRecord shape so existing callers don't change.
export async function listCreditLedgerEntries(humanUserId: number, limit = 25) {
  await ensureHumanAccountSchema();
  await expireExpiredHumanCreditClaims();
  const cappedLimit = Math.max(1, Math.min(limit, 200));
  const vibeIdUserId = await getVibeIdUserIdForHuman(humanUserId);
  if (vibeIdUserId == null) {
    throw new Error(
      `listCreditLedgerEntries: human_user_id=${humanUserId} has no vibe_id_user_id. Run the vibe-id migration for this user.`,
    );
  }
  const vibeIdClient = await import("@/lib/vibe-id-client");
  const ledger = await vibeIdClient.listCreditsLedgerForVibeUser(vibeIdUserId, cappedLimit);
  if (!ledger.ok) {
    throw new Error(`vibe-id /v1/users/${vibeIdUserId}/ledger failed: ${ledger.status} ${ledger.error}`);
  }
  return ledger.entries.map((rawEntry) =>
    mapVibeIdLedgerEntryToAutoauthShape(rawEntry as Record<string, unknown>, humanUserId),
  );
}

/// Look up a local human row by their @handle. Goes through vibe-id (the
/// authoritative source for handles) → vibe_id_user_id → local row.
export async function getHumanUserByHandle(handle: string) {
  await ensureHumanAccountSchema();
  const normalized = normalizeHumanHandleLookup(handle);
  if (!normalized) return null;
  const vibeIdClient = await import("@/lib/vibe-id-client");
  const vibeUser = await vibeIdClient.findVibeUserByHandle(normalized);
  if (!vibeUser) return null;
  return findHumanByVibeIdUserId(vibeUser.id);
}

/// Check whether an @address is available for use. The handle namespace
/// is shared between vibe-id users (the authoritative source) and OttoAuth
/// agents (local-only sk-oa-* keys). Both must be free for the address to
/// be available.
export async function getOttoAuthAddressAvailability(
  requested: string,
  options?: { excludeHumanUserId?: number | null },
) {
  await ensureHumanAccountSchema();
  const validation = validateOttoAuthAddress(requested);
  if (!validation.ok) {
    return { ok: false as const, available: false, error: validation.error };
  }
  const handle = validation.value;

  // Check vibe-id: is this handle taken by a different user?
  const vibeIdClient = await import("@/lib/vibe-id-client");
  const vibeUser = await vibeIdClient.findVibeUserByHandle(handle);
  if (vibeUser) {
    // If we're checking on behalf of a specific autoauth user, allow them
    // to "claim" their own current handle.
    if (options?.excludeHumanUserId != null) {
      const linked = await getVibeIdUserIdForHuman(options.excludeHumanUserId);
      if (linked === vibeUser.id) {
        return { ok: true as const, available: true, value: handle };
      }
    }
    return { ok: true as const, available: false, value: handle, reason: "human_handle" as const };
  }

  // Check OttoAuth agents: agent usernames share the namespace.
  const agent = await getAgentByUsername(handle);
  if (agent) {
    return { ok: true as const, available: false, value: handle, reason: "agent_username" as const };
  }

  return { ok: true as const, available: true, value: handle };
}

export async function resolveHumanPaymentRecipient(
  recipientInput: string,
): Promise<HumanPaymentRecipient | null> {
  await ensureHumanAccountSchema();
  const lookup = normalizePaymentRecipientInput(recipientInput);
  if (!lookup) return null;

  const client = getTursoClient();

  // Email lookup: local first (cache hit) since email is mirrored from
  // vibe-id during sign-in.
  if (lookup.includes("@")) {
    const emailResult = await client.execute({
      sql: "SELECT * FROM human_users WHERE email = ? LIMIT 1",
      args: [lookup],
    });
    const emailRow = emailResult.rows?.[0] as Record<string, unknown> | undefined;
    if (emailRow) {
      return {
        humanUser: mapHumanUser(emailRow),
        matchedBy: "email",
      };
    }
  }

  // Handle lookup: vibe-id is authoritative.
  const vibeIdClient = await import("@/lib/vibe-id-client");
  const vibeUser = await vibeIdClient.findVibeUserByHandle(lookup);
  if (vibeUser) {
    const localRow = await findHumanByVibeIdUserId(vibeUser.id);
    if (localRow) {
      return { humanUser: localRow, matchedBy: "human_handle" };
    }
  }

  // Agent-username lookup: local agents.username_lower → linked human.
  const agentResult = await client.execute({
    sql: `SELECT
            u.*,
            a.username_lower AS agent_username_lower,
            a.username_display AS agent_username_display
          FROM agents a
          JOIN human_agent_links l ON l.agent_id = a.id
          JOIN human_users u ON u.id = l.human_user_id
          WHERE a.username_lower = ?
          LIMIT 1`,
    args: [lookup],
  });
  const agentRow = agentResult.rows?.[0] as Record<string, unknown> | undefined;
  if (!agentRow) return null;

  return {
    humanUser: mapHumanUser(agentRow),
    matchedBy: "agent_username",
    agentUsernameLower:
      agentRow.agent_username_lower == null
        ? null
        : String(agentRow.agent_username_lower),
    agentUsernameDisplay:
      agentRow.agent_username_display == null
        ? null
        : String(agentRow.agent_username_display),
  };
}

export function validateCreditTransferAmountCents(amountCents: number) {
  if (!Number.isInteger(amountCents)) {
    return "A whole-number credit amount is required.";
  }
  if (amountCents < 1) {
    return "Enter an amount greater than $0.00.";
  }
  if (amountCents > MAX_CREDIT_TRANSFER_CENTS) {
    return `A single transfer cannot exceed $${(MAX_CREDIT_TRANSFER_CENTS / 100).toFixed(2)}.`;
  }
  return null;
}

export function validateCreditTransferNote(note: string) {
  const normalized = note.trim();
  if (!normalized) {
    return "Add a note before sending.";
  }
  if (normalized.length > MAX_CREDIT_TRANSFER_NOTE_LENGTH) {
    return `Notes must be ${MAX_CREDIT_TRANSFER_NOTE_LENGTH} characters or fewer.`;
  }
  return null;
}

export async function sendHumanCreditTransfer(params: {
  senderHumanUserId: number;
  recipientHumanUserId: number;
  amountCents: number;
  note: string;
}) {
  await ensureHumanAccountSchema();
  const amountCents = Math.trunc(params.amountCents);
  const amountError = validateCreditTransferAmountCents(amountCents);
  if (amountError) throw new Error(amountError);
  const note = params.note.trim();
  const noteError = validateCreditTransferNote(note);
  if (noteError) throw new Error(noteError);
  if (params.senderHumanUserId === params.recipientHumanUserId) {
    throw new Error("Choose a different OttoAuth account to pay.");
  }

  const sender = await getHumanUserById(params.senderHumanUserId);
  if (!sender) throw new Error("Sender account not found.");
  const recipient = await getHumanUserById(params.recipientHumanUserId);
  if (!recipient) throw new Error("Recipient account not found.");

  const senderVibeId = await getVibeIdUserIdForHuman(sender.id);
  if (senderVibeId == null) {
    throw new Error("Sender is not linked to vibe-id; sign out and back in to relink.");
  }
  const recipientVibeId = await getVibeIdUserIdForHuman(recipient.id);
  if (recipientVibeId == null) {
    throw new Error("Recipient is not linked to vibe-id yet.");
  }

  const transferPublicId = `tr_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const reason = note
    ? `Sent to @${recipient.handle_display}: ${note}`
    : `Sent to @${recipient.handle_display}`;

  const vibeIdClient = await import("@/lib/vibe-id-client");
  const transferResult = await vibeIdClient.transferCreditsBetweenUsers({
    fromVibeIdUserId: senderVibeId,
    toVibeIdUserId: recipientVibeId,
    amountCents,
    reason,
    idempotencyKey: `autoauth:transfer:${transferPublicId}`,
  });
  if (!transferResult.ok) {
    if (transferResult.error.includes("insufficient")) {
      throw new Error(
        "This transfer exceeds your current credit balance.",
      );
    }
    throw new Error(`vibe-id /v1/transfer failed (${transferResult.status}): ${transferResult.error}`);
  }

  return {
    transfer: {
      id: 0,
      transfer_public_id: transferPublicId,
      sender_human_user_id: sender.id,
      recipient_human_user_id: recipient.id,
      amount_cents: amountCents,
      note,
      status: "completed",
      created_at: createdAt,
    } satisfies HumanCreditTransferRecord,
    sender,
    recipient,
    senderBalanceCents: transferResult.fromBalance,
  };
}

/// Create a pending email-claim. The actual debit + holding state lives
/// in vibe-id — autoauth just shapes the response so existing callers
/// (the /api/human/payments/send route + claim email template) keep
/// working without changes.
export async function createPendingHumanCreditClaim(params: {
  senderHumanUserId: number;
  recipientEmail: string;
  amountCents: number;
  note: string;
}) {
  await ensureHumanAccountSchema();
  const amountCents = Math.trunc(params.amountCents);
  const amountError = validateCreditTransferAmountCents(amountCents);
  if (amountError) throw new Error(amountError);
  const note = params.note.trim();
  const noteError = validateCreditTransferNote(note);
  if (noteError) throw new Error(noteError);
  const recipientEmail = normalizeEmail(params.recipientEmail);
  if (!recipientEmail || !recipientEmail.includes("@")) {
    throw new Error("Enter a valid recipient email.");
  }

  const sender = await getHumanUserById(params.senderHumanUserId);
  if (!sender) throw new Error("Sender account not found.");
  const senderVibeId = await getVibeIdUserIdForHuman(sender.id);
  if (senderVibeId == null) {
    throw new Error("Sender is not linked to vibe-id; sign out and back in to relink.");
  }

  const vibeIdClient = await import("@/lib/vibe-id-client");
  const result = await vibeIdClient.createPendingClaim({
    senderVibeIdUserId: senderVibeId,
    recipientEmail,
    amountCents,
    note,
  });
  if (!result.ok) {
    if (result.status === 402 || result.error.includes("insufficient")) {
      throw new Error("This transfer exceeds your current credit balance.");
    }
    if (result.status === 409 && result.error.includes("already_has_vibe_id_account")) {
      throw new Error("That email already has an OttoAuth account.");
    }
    if (result.status === 400 && result.error.includes("self")) {
      throw new Error("Choose a different email address to pay.");
    }
    throw new Error(`vibe-id /v1/claims failed (${result.status}): ${result.error}`);
  }

  // Map vibe-id's claim shape (unix-seconds timestamps + sender_user_id)
  // to the existing HumanCreditClaimRecord shape so callers don't change.
  return {
    claim: {
      id: 0, // synthetic — vibe-id-side has its own id; not exposed by callers
      claim_public_id: result.claim.claim_public_id,
      sender_human_user_id: sender.id,
      recipient_email: result.claim.recipient_email,
      amount_cents: result.claim.amount_cents,
      note: result.claim.note,
      status: "pending",
      claimed_human_user_id: null,
      claimed_at: null,
      expires_at: new Date(result.claim.expires_at * 1000).toISOString(),
      created_at: new Date(result.claim.created_at * 1000).toISOString(),
    } satisfies HumanCreditClaimRecord,
    sender,
    senderBalanceCents: result.sender_balance,
  };
}

/// Run the email-claim expiry sweep. Refunds senders for claims that
/// passed expires_at without being accepted. Delegates to vibe-id.
export async function expireExpiredHumanCreditClaims() {
  const vibeIdClient = await import("@/lib/vibe-id-client");
  const result = await vibeIdClient.expireDueClaims();
  if (!result.ok) {
    console.error(`[expireExpiredHumanCreditClaims] vibe-id /v1/claims/expire-due failed: ${result.status} ${result.error}`);
    return { expired: [] as HumanCreditClaimRecord[], totalRefundedCents: 0 };
  }
  // Caller (getHumanCreditBalance / listCreditLedgerEntries) only uses
  // totalRefundedCents indirectly to decide whether to refresh — they
  // don't iterate `expired`. We synthesize a thin record list from the
  // vibe-id response for any caller that does want detail.
  return {
    expired: [] as HumanCreditClaimRecord[],
    totalRefundedCents: result.expired.reduce((sum, c) => sum + c.refunded_cents, 0),
  };
}

/// Read referral stats for a user. Source of truth is vibe-id —
/// referrals are a cross-project primitive now.
export async function getHumanReferralStats(
  humanUserId: number,
): Promise<HumanReferralStats> {
  await ensureHumanAccountSchema();
  const vibeIdUserId = await getVibeIdUserIdForHuman(humanUserId);
  if (vibeIdUserId == null) {
    return { successful_referrals: 0, total_bonus_cents: 0 };
  }
  const vibeIdClient = await import("@/lib/vibe-id-client");
  const stats = await vibeIdClient.getReferralStatsForVibeUser(vibeIdUserId);
  if (!stats.ok) {
    console.error(`[getHumanReferralStats] vibe-id read failed for vibe_id_user_id=${vibeIdUserId}: ${stats.status} ${stats.error}`);
    return { successful_referrals: 0, total_bonus_cents: 0 };
  }
  return {
    successful_referrals: stats.qualified_referrals,
    total_bonus_cents: stats.total_bonus_cents,
  };
}

export async function getHumanLinkForAgentUsername(usernameLower: string) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT
            l.*,
            u.email,
            u.display_name
          FROM human_agent_links l
          JOIN agents a ON a.id = l.agent_id
          JOIN human_users u ON u.id = l.human_user_id
          WHERE a.username_lower = ?
          LIMIT 1`,
    args: [usernameLower.trim().toLowerCase()],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    human_user_id: Number(row.human_user_id),
    agent_id: Number(row.agent_id),
    pairing_key_used: String(row.pairing_key_used),
    linked_at: String(row.linked_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    email: String(row.email),
    display_name: row.display_name == null ? null : String(row.display_name),
  };
}

export async function getLinkedAgentsForHuman(humanUserId: number): Promise<HumanAgentLinkWithAgentRecord[]> {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT
            l.id,
            l.human_user_id,
            l.agent_id,
            l.pairing_key_used,
            l.linked_at,
            l.created_at,
            l.updated_at,
            a.username_lower,
            a.username_display,
            a.callback_url,
            a.description
          FROM human_agent_links l
          JOIN agents a ON a.id = l.agent_id
          WHERE l.human_user_id = ?
          ORDER BY l.created_at DESC`,
    args: [humanUserId],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    human_user_id: Number(row.human_user_id),
    agent_id: Number(row.agent_id),
    pairing_key_used: String(row.pairing_key_used),
    linked_at: String(row.linked_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    username_lower: String(row.username_lower),
    username_display: String(row.username_display),
    callback_url: row.callback_url == null ? null : String(row.callback_url),
    description: row.description == null ? null : String(row.description),
  }));
}

export async function removeLinkedAgentForHuman(params: {
  humanUserId: number;
  linkId: number;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT
            l.id,
            l.human_user_id,
            l.agent_id,
            l.pairing_key_used,
            l.linked_at,
            l.created_at,
            l.updated_at,
            a.username_lower,
            a.username_display,
            a.callback_url,
            a.description
          FROM human_agent_links l
          JOIN agents a ON a.id = l.agent_id
          WHERE l.id = ?
          LIMIT 1`,
    args: [params.linkId],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Linked agent not found.");
  }
  if (Number(row.human_user_id) !== params.humanUserId) {
    throw new Error("You do not own this linked agent.");
  }

  await client.execute({
    sql: "DELETE FROM human_agent_links WHERE id = ?",
    args: [params.linkId],
  });

  return {
    id: Number(row.id),
    human_user_id: Number(row.human_user_id),
    agent_id: Number(row.agent_id),
    pairing_key_used: String(row.pairing_key_used),
    linked_at: String(row.linked_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    username_lower: String(row.username_lower),
    username_display: String(row.username_display),
    callback_url: row.callback_url == null ? null : String(row.callback_url),
    description: row.description == null ? null : String(row.description),
  } satisfies HumanAgentLinkWithAgentRecord;
}

export async function linkAgentToHumanByPairingKey(params: {
  humanUserId: number;
  pairingKey: string;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const normalized = normalizePairingKey(params.pairingKey);
  if (!normalized) {
    throw new Error("Pairing key is required.");
  }

  const agent = await getAgentByPairingKey(normalized);
  if (!agent) {
    throw new Error("Pairing key not found.");
  }

  const existingLinkResult = await client.execute({
    sql: "SELECT * FROM human_agent_links WHERE agent_id = ? LIMIT 1",
    args: [agent.id],
  });
  const existingLink = existingLinkResult.rows?.[0] as Record<string, unknown> | undefined;
  if (existingLink) {
    if (Number(existingLink.human_user_id) === params.humanUserId) {
      return {
        agent,
        status: "already_linked" as const,
      };
    }
    throw new Error("This agent is already linked to another human account.");
  }

  if (agent.pairing_key_consumed_at) {
    throw new Error("This pairing key has already been used.");
  }

  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO human_agent_links
          (human_user_id, agent_id, pairing_key_used, linked_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [params.humanUserId, agent.id, normalized, now, now, now],
  });
  await markAgentPairingKeyConsumed(agent.id);

  return {
    agent,
    status: "linked" as const,
  };
}

export async function createHumanGeneratedAgentApiKey(params: {
  humanUserId: number;
  agentName?: string | null;
}) {
  await ensureHumanAccountSchema();

  const client = getTursoClient();
  const now = new Date().toISOString();
  const label = params.agentName?.trim() || "AI agent";
  const usernameBase = normalizeGeneratedAgentUsernameBase(label, params.humanUserId);
  const privateKey = generatePrivateKey();
  let createdAgent: AgentRecord | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffix = randomBytes(3).toString("hex");
    const usernameLower = `${usernameBase.slice(0, 25)}_${suffix}`.slice(0, 32);
    const availability = await getOttoAuthAddressAvailability(usernameLower);
    if (!availability.ok || !availability.available) continue;
    try {
      createdAgent = await createAgent({
        usernameLower,
        usernameDisplay: usernameLower,
        privateKey,
        pairingKey: null,
        callbackUrl: null,
        description: label.slice(0, 100),
      });
      break;
    } catch (error) {
      if (attempt === 5) {
        throw error;
      }
    }
  }

  if (!createdAgent) {
    throw new Error("Could not generate an agent API key.");
  }

  await client.execute({
    sql: `INSERT INTO human_agent_links
          (human_user_id, agent_id, pairing_key_used, linked_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      params.humanUserId,
      createdAgent.id,
      "HUMAN_GENERATED_API_KEY",
      now,
      now,
      now,
    ],
  });

  return {
    agent: createdAgent,
    privateKey,
  };
}

const HOSTED_CHECKOUT_PAIRING_KEY = "OTTOAUTH_HOSTED_CHECKOUT";

export async function getOrCreateHumanHostedCheckoutAgent(params: {
  humanUserId: number;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const existing = await client.execute({
    sql: `SELECT
            a.id,
            a.username_lower,
            a.username_display,
            a.private_key,
            a.pairing_key,
            a.pairing_key_created_at,
            a.pairing_key_consumed_at,
            a.callback_url,
            a.description,
            a.created_at,
            a.updated_at
          FROM human_agent_links l
          JOIN agents a ON a.id = l.agent_id
          WHERE l.human_user_id = ? AND l.pairing_key_used = ?
          LIMIT 1`,
    args: [params.humanUserId, HOSTED_CHECKOUT_PAIRING_KEY],
  });
  const existingAgent = existing.rows?.[0] as unknown as AgentRecord | undefined;
  if (existingAgent) return existingAgent;

  const privateKey = generatePrivateKey();
  const now = new Date().toISOString();
  let createdAgent: AgentRecord | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomBytes(3).toString("hex");
    const usernameLower = `checkout_${params.humanUserId}_${suffix}`.slice(0, 32);
    if (await getAgentByUsername(usernameLower)) continue;
    try {
      createdAgent = await createAgent({
        usernameLower,
        usernameDisplay: usernameLower,
        privateKey,
        pairingKey: null,
        callbackUrl: null,
        description: "OttoAuth hosted checkout",
      });
      break;
    } catch (error) {
      if (attempt === 7) throw error;
    }
  }

  if (!createdAgent) {
    throw new Error("Could not create hosted checkout agent.");
  }

  try {
    await client.execute({
      sql: `INSERT INTO human_agent_links
            (human_user_id, agent_id, pairing_key_used, linked_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        params.humanUserId,
        createdAgent.id,
        HOSTED_CHECKOUT_PAIRING_KEY,
        now,
        now,
        now,
      ],
    });
  } catch (error) {
    const raced = await client.execute({
      sql: `SELECT
              a.id,
              a.username_lower,
              a.username_display,
              a.private_key,
              a.pairing_key,
              a.pairing_key_created_at,
              a.pairing_key_consumed_at,
              a.callback_url,
              a.description,
              a.created_at,
              a.updated_at
            FROM human_agent_links l
            JOIN agents a ON a.id = l.agent_id
            WHERE l.human_user_id = ? AND l.pairing_key_used = ?
            LIMIT 1`,
      args: [params.humanUserId, HOSTED_CHECKOUT_PAIRING_KEY],
    });
    const racedAgent = raced.rows?.[0] as unknown as AgentRecord | undefined;
    if (racedAgent) return racedAgent;
    throw error;
  }

  return createdAgent;
}

export async function createHumanDevicePairingCode(params: {
  humanUserId: number;
  deviceLabel?: string | null;
  ttlMinutes?: number;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.ttlMinutes ?? 10) * 60 * 1000);
  const code = randomDisplayToken(6);
  const nowIso = now.toISOString();

  await client.execute({
    sql: `INSERT INTO human_device_pairing_codes
          (human_user_id, code, device_label, expires_at, consumed_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    args: [
      params.humanUserId,
      normalizeDeviceCode(code),
      params.deviceLabel?.trim() || null,
      expiresAt.toISOString(),
      nowIso,
      nowIso,
    ],
  });

  return {
    code,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getActiveHumanDevicePairingCodes(humanUserId: number) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM human_device_pairing_codes
          WHERE human_user_id = ?
            AND consumed_at IS NULL
            AND expires_at > ?
          ORDER BY created_at DESC`,
    args: [humanUserId, new Date().toISOString()],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    human_user_id: Number(row.human_user_id),
    code: displayToken(String(row.code)),
    device_label: row.device_label == null ? null : String(row.device_label),
    expires_at: String(row.expires_at),
    consumed_at: row.consumed_at == null ? null : String(row.consumed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  })) as HumanDevicePairingCodeRecord[];
}

export async function consumeHumanDevicePairingCode(code: string) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const normalized = normalizeDeviceCode(code);
  if (!normalized) return null;

  const result = await client.execute({
    sql: `SELECT * FROM human_device_pairing_codes
          WHERE code = ?
          LIMIT 1`,
    args: [normalized],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const humanUser = await getHumanUserById(Number(row.human_user_id));
  if (!humanUser) {
    throw new Error("Human account not found for device pairing code.");
  }
  if (row.consumed_at != null) {
    return { status: "consumed" as const, record: row, humanUser };
  }
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    return { status: "expired" as const, record: row, humanUser };
  }

  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE human_device_pairing_codes
          SET consumed_at = ?, updated_at = ?
          WHERE id = ?`,
    args: [now, now, Number(row.id)],
  });

  return {
    status: "consumed_now" as const,
    humanUser,
    code: displayToken(normalized),
  };
}

export async function previewHumanDevicePairingCode(code: string) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const normalized = normalizeDeviceCode(code);
  if (!normalized) return null;

  const result = await client.execute({
    sql: `SELECT * FROM human_device_pairing_codes
          WHERE code = ?
          LIMIT 1`,
    args: [normalized],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const humanUser = await getHumanUserById(Number(row.human_user_id));
  if (!humanUser) {
    throw new Error("Human account not found for device pairing code.");
  }
  if (row.consumed_at != null) {
    return { status: "consumed" as const, record: row, humanUser };
  }
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    return { status: "expired" as const, record: row, humanUser };
  }
  return {
    status: "valid" as const,
    humanUser,
    code: displayToken(normalized),
  };
}

export async function getHumanUserForAgent(agent: AgentRecord) {
  const link = await getHumanLinkForAgentUsername(agent.username_lower);
  if (!link) return null;
  return getHumanUserById(link.human_user_id);
}
