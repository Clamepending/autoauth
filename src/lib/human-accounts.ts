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

function normalizeHumanHandleBase(value: string, humanUserId: number) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  const fallback = `user_${humanUserId}`;
  const base = cleaned.length >= 3 ? cleaned : fallback;
  return base.slice(0, 32).replace(/^[_-]+|[_-]+$/g, "") || fallback;
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

function mapHumanCreditClaimRow(row: Record<string, unknown>): HumanCreditClaimRecord {
  return {
    id: Number(row.id),
    claim_public_id: String(row.claim_public_id),
    sender_human_user_id: Number(row.sender_human_user_id),
    recipient_email: String(row.recipient_email),
    amount_cents: Number(row.amount_cents),
    note: String(row.note),
    status: String(row.status),
    claimed_human_user_id:
      row.claimed_human_user_id == null
        ? null
        : Number(row.claimed_human_user_id),
    claimed_at: row.claimed_at == null ? null : String(row.claimed_at),
    expires_at:
      row.expires_at == null || String(row.expires_at).trim() === ""
        ? new Date(
            new Date(String(row.created_at)).getTime() +
              CREDIT_CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString()
        : String(row.expires_at),
    created_at: String(row.created_at),
  };
}

async function findAvailableHumanHandle(
  executor: SqlExecutor,
  params: {
    base: string;
    humanUserId: number;
  },
) {
  const base = normalizeHumanHandleBase(params.base, params.humanUserId);
  const suffixSpace = Math.max(0, 32 - String(params.humanUserId).length - 1);
  const shortBase = base.slice(0, Math.max(3, suffixSpace));

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rawCandidate =
      attempt === 0
        ? base
        : `${shortBase}_${params.humanUserId}${attempt === 1 ? "" : attempt}`;
    const candidate = rawCandidate.slice(0, 32).replace(/^[_-]+|[_-]+$/g, "");
    const existing = await executor.execute({
      sql: `SELECT id FROM human_users
            WHERE handle_lower = ?
              AND id != ?
            LIMIT 1`,
      args: [candidate, params.humanUserId],
    });
    const agentExisting = await executor.execute({
      sql: "SELECT id FROM agents WHERE username_lower = ? LIMIT 1",
      args: [candidate],
    });
    if (!existing.rows?.[0] && !agentExisting.rows?.[0] && !RESERVED_ADDRESS_NAMES.has(candidate)) {
      return candidate;
    }
  }

  return `user_${params.humanUserId}_${randomBytes(2).toString("hex")}`.slice(
    0,
    32,
  );
}

async function ensureHumanHandleWithExecutor(
  executor: SqlExecutor,
  params: {
    humanUserId: number;
    email: string;
    displayName?: string | null;
    currentHandle?: string | null;
  },
) {
  const existing = normalizeHumanHandleLookup(params.currentHandle ?? "");
  if (existing && !RESERVED_ADDRESS_NAMES.has(existing)) {
    const agentExisting = await executor.execute({
      sql: "SELECT id FROM agents WHERE username_lower = ? LIMIT 1",
      args: [existing],
    });
    if (!agentExisting.rows?.[0]) return existing;
  }

  const base = params.displayName?.trim() || params.email.split("@")[0] || "";
  const handle = await findAvailableHumanHandle(executor, {
    base,
    humanUserId: params.humanUserId,
  });
  await executor.execute({
    sql: `UPDATE human_users
          SET handle_lower = ?, handle_display = ?, updated_at = ?
          WHERE id = ?`,
    args: [handle, handle, new Date().toISOString(), params.humanUserId],
  });
  return handle;
}

async function backfillHumanHandles(executor: SqlExecutor) {
  const result = await executor.execute({
    sql: `SELECT id, email, display_name, handle_lower
          FROM human_users
          ORDER BY id ASC`,
    args: [],
  });
  for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
    const currentHandle = normalizeHumanHandleLookup(
      row.handle_lower == null ? "" : String(row.handle_lower),
    );
    let needsHandle =
      !currentHandle || RESERVED_ADDRESS_NAMES.has(currentHandle);
    if (currentHandle && !needsHandle) {
      const agentExisting = await executor.execute({
        sql: "SELECT id FROM agents WHERE username_lower = ? LIMIT 1",
        args: [currentHandle],
      });
      needsHandle = Boolean(agentExisting.rows?.[0]);
    }
    if (needsHandle) {
      await ensureHumanHandleWithExecutor(executor, {
        humanUserId: Number(row.id),
        email: String(row.email),
        displayName:
          row.display_name == null ? null : String(row.display_name),
        currentHandle: null,
      });
    }
  }
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

export async function qualifyHumanReferralAfterDeposit(params: {
  referredHumanUserId: number;
  qualifyingReferenceType: string;
  qualifyingReferenceId: string;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();

  const referralResult = await client.execute({
    sql: `SELECT
            r.id,
            r.referrer_human_user_id,
            r.referred_human_user_id,
            r.referrer_reward_cents,
            r.referred_reward_cents,
            r.qualified_at,
            u.email,
            u.display_name
          FROM human_referrals r
          JOIN human_users u ON u.id = r.referred_human_user_id
          WHERE r.referred_human_user_id = ?
          LIMIT 1`,
    args: [params.referredHumanUserId],
  });
  const row = referralResult.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return { status: "no_referral" as const };
  if (row.qualified_at != null) return { status: "already_qualified" as const };

  const referralId = Number(row.id);
  const referrerHumanUserId = Number(row.referrer_human_user_id);
  const referredHumanUserId = Number(row.referred_human_user_id);
  const referrerRewardCents = Number(row.referrer_reward_cents);
  const referredRewardCents = Number(row.referred_reward_cents);
  const referredLabel =
    (row.display_name == null ? "" : String(row.display_name).trim()) ||
    String(row.email);

  // Issue grants via vibe-id BEFORE marking qualified. If the qualified_at
  // write fails after grants succeed, the next call will re-enter, re-issue
  // the same idempotent grants (vibe-id dedupes), and succeed at the
  // qualified_at write.
  await addCreditLedgerEntry({
    humanUserId: referrerHumanUserId,
    amountCents: referrerRewardCents,
    entryType: "referral_bonus",
    description: `Referral bonus after ${referredLabel}'s first deposit`,
    referenceType: "human_referral",
    referenceId: String(referredHumanUserId),
  });
  await addCreditLedgerEntry({
    humanUserId: referredHumanUserId,
    amountCents: referredRewardCents,
    entryType: "referred_deposit_bonus",
    description: "Referral bonus after your first deposit",
    referenceType: "human_referral",
    referenceId: String(referredHumanUserId),
  });

  await client.execute({
    sql: `UPDATE human_referrals
          SET qualified_at = ?, qualifying_reference_type = ?, qualifying_reference_id = ?
          WHERE id = ?
            AND qualified_at IS NULL`,
    args: [
      new Date().toISOString(),
      params.qualifyingReferenceType,
      params.qualifyingReferenceId,
      referralId,
    ],
  });

  return { status: "qualified" as const };
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
  const humanUsersTableInfo = await client.execute({
    sql: "PRAGMA table_info(human_users)",
    args: [],
  });
  const humanUserColumns = (humanUsersTableInfo.rows ?? []) as unknown as {
    name: string;
  }[];
  if (!humanUserColumns.some((c) => c.name === "handle_lower")) {
    await client.execute("ALTER TABLE human_users ADD COLUMN handle_lower TEXT");
  }
  if (!humanUserColumns.some((c) => c.name === "handle_display")) {
    await client.execute("ALTER TABLE human_users ADD COLUMN handle_display TEXT");
  }
  await backfillHumanHandles(client);
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

  await client.execute(
    `CREATE TABLE IF NOT EXISTS human_credit_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_public_id TEXT NOT NULL UNIQUE,
      sender_human_user_id INTEGER NOT NULL,
      recipient_email TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL,
      claimed_human_user_id INTEGER,
      claimed_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  const humanCreditClaimsTableInfo = await client.execute({
    sql: "PRAGMA table_info(human_credit_claims)",
    args: [],
  });
  const humanCreditClaimColumns = (humanCreditClaimsTableInfo.rows ?? []) as unknown as {
    name: string;
  }[];
  if (!humanCreditClaimColumns.some((c) => c.name === "expires_at")) {
    await client.execute("ALTER TABLE human_credit_claims ADD COLUMN expires_at TEXT");
    const claimsMissingExpiry = await client.execute({
      sql: `SELECT id, created_at
            FROM human_credit_claims
            WHERE expires_at IS NULL OR expires_at = ''`,
      args: [],
    });
    for (const row of (claimsMissingExpiry.rows ?? []) as Record<string, unknown>[]) {
      const createdAtMs = new Date(String(row.created_at)).getTime();
      const expiresAt = new Date(
        (Number.isFinite(createdAtMs) ? createdAtMs : Date.now()) +
          CREDIT_CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      await client.execute({
        sql: "UPDATE human_credit_claims SET expires_at = ? WHERE id = ?",
        args: [expiresAt, Number(row.id)],
      });
    }
  }
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_credit_claims_email_status ON human_credit_claims(recipient_email, status)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_credit_claims_email_status_expiry ON human_credit_claims(recipient_email, status, expires_at)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_credit_claims_sender ON human_credit_claims(sender_human_user_id, created_at)",
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS human_referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_human_user_id INTEGER NOT NULL,
      referred_human_user_id INTEGER NOT NULL UNIQUE,
      referrer_reward_cents INTEGER NOT NULL,
      referred_reward_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      qualified_at TEXT,
      qualifying_reference_type TEXT,
      qualifying_reference_id TEXT
    )`,
  );
  const humanReferralsTableInfo = await client.execute({
    sql: "PRAGMA table_info(human_referrals)",
    args: [],
  });
  const humanReferralColumns = (humanReferralsTableInfo.rows ?? []) as unknown as {
    name: string;
  }[];
  const hadQualifiedAt = humanReferralColumns.some((c) => c.name === "qualified_at");
  if (!hadQualifiedAt) {
    await client.execute("ALTER TABLE human_referrals ADD COLUMN qualified_at TEXT");
  }
  if (!humanReferralColumns.some((c) => c.name === "qualifying_reference_type")) {
    await client.execute(
      "ALTER TABLE human_referrals ADD COLUMN qualifying_reference_type TEXT",
    );
  }
  if (!humanReferralColumns.some((c) => c.name === "qualifying_reference_id")) {
    await client.execute(
      "ALTER TABLE human_referrals ADD COLUMN qualifying_reference_id TEXT",
    );
  }
  if (!hadQualifiedAt) {
    await client.execute(
      `UPDATE human_referrals
        SET qualified_at = created_at
        WHERE qualified_at IS NULL`,
    );
  }
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_referrals_referrer ON human_referrals(referrer_human_user_id)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_human_referrals_referred ON human_referrals(referred_human_user_id)",
  );

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
/// create a fresh local row with starter credits.
export async function ensureHumanForVibeIdUser(params: {
  vibeIdUserId: number;
  email: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  googleSub?: string | null;
  humanUserIdHint?: number;
}): Promise<HumanUserRecord> {
  await ensureHumanAccountSchema();
  const client = getTursoClient();

  const existingByVibeId = await findHumanByVibeIdUserId(params.vibeIdUserId);
  if (existingByVibeId) return existingByVibeId;

  if (params.humanUserIdHint != null) {
    await setVibeIdUserIdForHuman(params.humanUserIdHint, params.vibeIdUserId);
    const linked = await getHumanUserById(params.humanUserIdHint);
    if (linked) return linked;
  }

  // Look up by email — covers the case where the user existed locally
  // (e.g. signed in via the legacy Google flow) but isn't yet linked.
  const existingByEmail = await getHumanUserByEmail(params.email);
  if (existingByEmail) {
    await setVibeIdUserIdForHuman(existingByEmail.id, params.vibeIdUserId);
    const refreshed = await getHumanUserById(existingByEmail.id);
    if (refreshed) return refreshed;
  }

  // Brand-new user: create a local row linked to vibe-id. Credit grants
  // (signup bonuses etc.) are vibe-id's responsibility.
  const now = new Date().toISOString();
  const insertResult = await client.execute({
    sql: `INSERT INTO human_users
          (email, email_verified, google_sub, auth_provider, display_name, picture_url, vibe_id_user_id, created_at, updated_at)
          VALUES (?, 1, ?, 'vibe-id', ?, ?, ?, ?, ?)`,
    args: [
      normalizeEmail(params.email),
      params.googleSub?.trim() || null,
      params.displayName?.trim() || null,
      params.pictureUrl?.trim() || null,
      params.vibeIdUserId,
      now,
      now,
    ],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  const newHumanUserId = rawId != null ? Number(rawId) : 0;
  if (!newHumanUserId) throw new Error("Failed to create human row for vibe-id user.");

  const created = await getHumanUserById(newHumanUserId);
  if (!created) throw new Error("Failed to load newly-created human row.");

  // Pull in any pending email-claim credits this email was promised
  // before they signed up.
  await claimPendingHumanCreditClaimsForUser(created.id).catch((error) => {
    console.error(
      `[ensureHumanForVibeIdUser] claimPendingHumanCreditClaimsForUser failed for human ${created.id}:`,
      error,
    );
  });

  return created;
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

export async function getHumanUserByHandle(handle: string) {
  await ensureHumanAccountSchema();
  const normalized = normalizeHumanHandleLookup(handle);
  if (!normalized) return null;
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM human_users WHERE handle_lower = ? LIMIT 1",
    args: [normalized],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapHumanUser(row) : null;
}

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
  const client = getTursoClient();
  const humanResult = await client.execute({
    sql: `SELECT id FROM human_users
          WHERE handle_lower = ?
            AND id != ?
          LIMIT 1`,
    args: [handle, options?.excludeHumanUserId ?? 0],
  });
  if (humanResult.rows?.[0]) {
    return { ok: true as const, available: false, value: handle, reason: "human_handle" as const };
  }
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

  const handleResult = await client.execute({
    sql: "SELECT * FROM human_users WHERE handle_lower = ? LIMIT 1",
    args: [lookup],
  });
  const handleRow = handleResult.rows?.[0] as Record<string, unknown> | undefined;
  if (handleRow) {
    return {
      humanUser: mapHumanUser(handleRow),
      matchedBy: "human_handle",
    };
  }

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

export async function createPendingHumanCreditClaim(params: {
  senderHumanUserId: number;
  recipientEmail: string;
  amountCents: number;
  note: string;
}) {
  await ensureHumanAccountSchema();
  await expireExpiredHumanCreditClaims();
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
  if (normalizeEmail(sender.email) === recipientEmail) {
    throw new Error("Choose a different email address to pay.");
  }

  const existingRecipient = await getHumanUserByEmail(recipientEmail);
  if (existingRecipient) {
    throw new Error("That email already has an OttoAuth account.");
  }

  const senderVibeId = await getVibeIdUserIdForHuman(sender.id);
  if (senderVibeId == null) {
    throw new Error("Sender is not linked to vibe-id; sign out and back in to relink.");
  }

  // Insert the claim row first so we have a stable claim_public_id to
  // use as the vibe-id idempotency key. If the vibe-id charge fails, we
  // delete the row so the sender can retry without an orphan claim.
  const claimPublicId = `claim_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + CREDIT_CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const client = getTursoClient();
  const insertResult = await client.execute({
    sql: `INSERT INTO human_credit_claims
          (claim_public_id, sender_human_user_id, recipient_email, amount_cents, note, status, claimed_human_user_id, claimed_at, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
    args: [
      claimPublicId,
      sender.id,
      recipientEmail,
      amountCents,
      note,
      expiresAt,
      createdAt,
    ],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  const claimId = rawId != null ? Number(rawId) : 0;
  if (!claimId) throw new Error("Credit claim creation failed.");

  const reason = note
    ? `Pending claim to ${recipientEmail}: ${note}`
    : `Pending claim to ${recipientEmail}`;
  const vibeIdClient = await import("@/lib/vibe-id-client");
  const chargeResult = await vibeIdClient.chargeCreditsForUserId({
    vibeIdUserId: senderVibeId,
    amountCents,
    reason,
    idempotencyKey: `autoauth:claim_sent:${claimPublicId}`,
    project: "ottoauth",
  });
  if (!chargeResult.ok) {
    // Roll back the orphan claim row so the sender can retry.
    await client.execute({
      sql: "DELETE FROM human_credit_claims WHERE id = ?",
      args: [claimId],
    });
    if (chargeResult.status === 402 || chargeResult.error.includes("insufficient")) {
      const balanceUsd = chargeResult.balance != null
        ? `($${(chargeResult.balance / 100).toFixed(2)} available)`
        : "";
      throw new Error(
        `This transfer exceeds your current credit balance ${balanceUsd}.`.trim(),
      );
    }
    throw new Error(`vibe-id /v1/charge failed (${chargeResult.status}): ${chargeResult.error}`);
  }

  return {
    claim: {
      id: claimId,
      claim_public_id: claimPublicId,
      sender_human_user_id: sender.id,
      recipient_email: recipientEmail,
      amount_cents: amountCents,
      note,
      status: "pending",
      claimed_human_user_id: null,
      claimed_at: null,
      expires_at: expiresAt,
      created_at: createdAt,
    } satisfies HumanCreditClaimRecord,
    sender,
    senderBalanceCents: chargeResult.balance,
  };
}

type ExpiredHumanCreditClaimsResult = {
  expired: HumanCreditClaimRecord[];
  totalRefundedCents: number;
};

let expireExpiredHumanCreditClaimsPromise: Promise<ExpiredHumanCreditClaimsResult> | null = null;

export async function expireExpiredHumanCreditClaims() {
  expireExpiredHumanCreditClaimsPromise ??= expireExpiredHumanCreditClaimsNow().finally(() => {
    expireExpiredHumanCreditClaimsPromise = null;
  });
  return expireExpiredHumanCreditClaimsPromise;
}

async function expireExpiredHumanCreditClaimsNow(): Promise<ExpiredHumanCreditClaimsResult> {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const expired: HumanCreditClaimRecord[] = [];

  const now = new Date().toISOString();
  const result = await client.execute({
    sql: `SELECT *
          FROM human_credit_claims
          WHERE status = 'pending'
            AND expires_at <= ?
          ORDER BY expires_at ASC
          LIMIT 100`,
    args: [now],
  });

  const vibeIdClient = await import("@/lib/vibe-id-client");

  for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
    const claim = mapHumanCreditClaimRow(row);

    // Refund the sender via vibe-id BEFORE flipping the claim status.
    // If the grant succeeds and the status flip fails, the next run will
    // re-enter here, re-issue the same idempotent grant (vibe-id dedupes),
    // then succeed at the status flip.
    const senderVibeId = await getVibeIdUserIdForHuman(claim.sender_human_user_id);
    if (senderVibeId == null) {
      console.error(
        `[expireExpiredHumanCreditClaims] sender ${claim.sender_human_user_id} not linked to vibe-id; skipping refund of claim ${claim.claim_public_id}`,
      );
      continue;
    }

    const refundResult = await vibeIdClient.grantCreditsToUser({
      vibeIdUserId: senderVibeId,
      amountCents: claim.amount_cents,
      reason: `Expired claim refund (${claim.recipient_email})`,
      idempotencyKey: `autoauth:claim_expired_refund:${claim.claim_public_id}`,
    });
    if (!refundResult.ok) {
      console.error(
        `[expireExpiredHumanCreditClaims] refund failed for claim ${claim.claim_public_id}: ${refundResult.status} ${refundResult.error}`,
      );
      continue;
    }

    const updateResult = await client.execute({
      sql: `UPDATE human_credit_claims
            SET status = 'expired'
            WHERE id = ?
              AND status = 'pending'
              AND expires_at <= ?`,
      args: [claim.id, now],
    });
    if (updateResult.rowsAffected > 0) {
      expired.push({ ...claim, status: "expired" });
    }
  }

  return {
    expired,
    totalRefundedCents: expired.reduce(
      (total, claim) => total + claim.amount_cents,
      0,
    ),
  };
}

export async function claimPendingHumanCreditClaimsForUser(humanUserId: number) {
  await ensureHumanAccountSchema();
  await expireExpiredHumanCreditClaims();
  const user = await getHumanUserById(humanUserId);
  if (!user) throw new Error("Human account not found.");
  const recipientEmail = normalizeEmail(user.email);
  const recipientVibeId = await getVibeIdUserIdForHuman(user.id);
  if (recipientVibeId == null) {
    // Recipient hasn't been linked yet — they'll claim on next sign-in.
    return { claimed: [], totalClaimedCents: 0 };
  }

  const client = getTursoClient();
  const claimed: HumanCreditClaimRecord[] = [];
  const now = new Date().toISOString();
  const pendingResult = await client.execute({
    sql: `SELECT *
          FROM human_credit_claims
          WHERE recipient_email = ?
            AND status = 'pending'
            AND expires_at > ?
          ORDER BY created_at ASC`,
    args: [recipientEmail, now],
  });

  const vibeIdClient = await import("@/lib/vibe-id-client");

  for (const row of (pendingResult.rows ?? []) as Record<string, unknown>[]) {
    const claim = mapHumanCreditClaimRow(row);
    const sender = await getHumanUserById(claim.sender_human_user_id);

    // Grant via vibe-id BEFORE flipping status. Idempotent on retry.
    const grantResult = await vibeIdClient.grantCreditsToUser({
      vibeIdUserId: recipientVibeId,
      amountCents: claim.amount_cents,
      reason: sender
        ? `Claimed credits from @${sender.handle_display}`
        : "Claimed OttoAuth credits",
      idempotencyKey: `autoauth:claim_received:${claim.claim_public_id}`,
    });
    if (!grantResult.ok) {
      console.error(
        `[claimPendingHumanCreditClaimsForUser] grant failed for claim ${claim.claim_public_id}: ${grantResult.status} ${grantResult.error}`,
      );
      continue;
    }

    const claimedAt = new Date().toISOString();
    const updateResult = await client.execute({
      sql: `UPDATE human_credit_claims
            SET status = 'claimed', claimed_human_user_id = ?, claimed_at = ?
            WHERE id = ?
              AND status = 'pending'
              AND expires_at > ?`,
      args: [user.id, claimedAt, claim.id, claimedAt],
    });
    if (updateResult.rowsAffected > 0) {
      claimed.push({
        ...claim,
        status: "claimed",
        claimed_human_user_id: user.id,
        claimed_at: claimedAt,
      });
    }
  }

  return {
    claimed,
    totalClaimedCents: claimed.reduce(
      (total, claim) => total + claim.amount_cents,
      0,
    ),
  };
}

export async function getHumanReferralStats(
  humanUserId: number,
): Promise<HumanReferralStats> {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT
            COUNT(*) AS successful_referrals,
            COALESCE(SUM(referrer_reward_cents), 0) AS total_bonus_cents
          FROM human_referrals
          WHERE referrer_human_user_id = ?
            AND qualified_at IS NOT NULL`,
    args: [humanUserId],
  });
  const row = result.rows?.[0] as
    | {
        successful_referrals?: number | bigint | string;
        total_bonus_cents?: number | bigint | string;
      }
    | undefined;

  return {
    successful_referrals:
      row?.successful_referrals != null
        ? Number(row.successful_referrals)
        : 0,
    total_bonus_cents:
      row?.total_bonus_cents != null ? Number(row.total_bonus_cents) : 0,
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
