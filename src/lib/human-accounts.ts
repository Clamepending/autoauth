import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { generatePrivateKey, normalizePairingKey } from "@/lib/agent-auth";
import {
  createAgent,
  ensureSchema,
  getAgentByPairingKey,
  markAgentPairingKeyConsumed,
  type AgentRecord,
} from "@/lib/db";
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

export type HumanSessionRecord = {
  id: number;
  human_user_id: number;
  session_token_hash: string;
  expires_at: string;
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

const STARTER_CREDIT_CENTS = 2000;
export const REFERRAL_BONUS_CENTS = 500;
export const MAX_CREDIT_TRANSFER_CENTS = 50000;
export const MAX_CREDIT_TRANSFER_NOTE_LENGTH = 280;
export const CREDIT_CLAIM_EXPIRY_DAYS = 7;

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

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
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

function mapLedgerRow(row: Record<string, unknown>): CreditLedgerRecord {
  return {
    id: Number(row.id),
    human_user_id: Number(row.human_user_id),
    amount_cents: Number(row.amount_cents),
    entry_type: String(row.entry_type),
    description: row.description == null ? null : String(row.description),
    reference_type: row.reference_type == null ? null : String(row.reference_type),
    reference_id: row.reference_id == null ? null : String(row.reference_id),
    metadata_json: row.metadata_json == null ? null : String(row.metadata_json),
    created_at: String(row.created_at),
  };
}

function mapHumanCreditTransferRow(
  row: Record<string, unknown>,
): HumanCreditTransferRecord {
  return {
    id: Number(row.id),
    transfer_public_id: String(row.transfer_public_id),
    sender_human_user_id: Number(row.sender_human_user_id),
    recipient_human_user_id: Number(row.recipient_human_user_id),
    amount_cents: Number(row.amount_cents),
    note: String(row.note),
    status: String(row.status),
    created_at: String(row.created_at),
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
    if (!existing.rows?.[0]) return candidate;
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
  if (existing) return existing;

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
          WHERE handle_lower IS NULL
             OR handle_lower = ''
          ORDER BY id ASC`,
    args: [],
  });
  for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
    await ensureHumanHandleWithExecutor(executor, {
      humanUserId: Number(row.id),
      email: String(row.email),
      displayName:
        row.display_name == null ? null : String(row.display_name),
      currentHandle:
        row.handle_lower == null ? null : String(row.handle_lower),
    });
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

async function addCreditLedgerEntryWithExecutor(
  executor: SqlExecutor,
  params: {
    humanUserId: number;
    amountCents: number;
    entryType: string;
    description?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const now = new Date().toISOString();
  await executor.execute({
    sql: `INSERT INTO credit_ledger
          (human_user_id, amount_cents, entry_type, description, reference_type, reference_id, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      params.humanUserId,
      Math.trunc(params.amountCents),
      params.entryType.trim(),
      params.description ?? null,
      params.referenceType ?? null,
      params.referenceId ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now,
    ],
  });
}

async function createPendingReferralWithExecutor(
  executor: SqlExecutor,
  params: {
    referrerHumanUserId: number | null;
    referredHumanUserId: number;
  },
) {
  if (
    !params.referrerHumanUserId ||
    params.referrerHumanUserId === params.referredHumanUserId
  ) {
    return;
  }

  const referrerResult = await executor.execute({
    sql: `SELECT id
          FROM human_users
          WHERE id = ?
          LIMIT 1`,
    args: [params.referrerHumanUserId],
  });
  if (!referrerResult.rows?.[0]) {
    return;
  }

  await executor.execute({
    sql: `INSERT OR IGNORE INTO human_referrals
          (referrer_human_user_id, referred_human_user_id, referrer_reward_cents, referred_reward_cents, created_at, qualified_at, qualifying_reference_type, qualifying_reference_id)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    args: [
      params.referrerHumanUserId,
      params.referredHumanUserId,
      REFERRAL_BONUS_CENTS,
      REFERRAL_BONUS_CENTS,
      new Date().toISOString(),
    ],
  });
}

export async function qualifyHumanReferralAfterDeposit(params: {
  referredHumanUserId: number;
  qualifyingReferenceType: string;
  qualifyingReferenceId: string;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const transaction = await client.transaction("write");

  try {
    const referralResult = await transaction.execute({
      sql: `SELECT
              r.id,
              r.referrer_human_user_id,
              r.referred_human_user_id,
              r.referrer_reward_cents,
              r.referred_reward_cents,
              r.created_at,
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
    if (!row) {
      await transaction.commit();
      return { status: "no_referral" as const };
    }

    if (row.qualified_at != null) {
      await transaction.commit();
      return { status: "already_qualified" as const };
    }

    const referralId = Number(row.id);
    const referrerHumanUserId = Number(row.referrer_human_user_id);
    const referredHumanUserId = Number(row.referred_human_user_id);
    const referrerRewardCents = Number(row.referrer_reward_cents);
    const referredRewardCents = Number(row.referred_reward_cents);
    const qualifiedAt = new Date().toISOString();
    const referredLabel =
      (row.display_name == null ? "" : String(row.display_name).trim()) ||
      String(row.email);

    const updateResult = await transaction.execute({
      sql: `UPDATE human_referrals
            SET qualified_at = ?, qualifying_reference_type = ?, qualifying_reference_id = ?
            WHERE id = ?
              AND qualified_at IS NULL`,
      args: [
        qualifiedAt,
        params.qualifyingReferenceType,
        params.qualifyingReferenceId,
        referralId,
      ],
    });

    if (updateResult.rowsAffected === 0) {
      await transaction.commit();
      return { status: "already_qualified" as const };
    }

    await addCreditLedgerEntryWithExecutor(transaction, {
      humanUserId: referrerHumanUserId,
      amountCents: referrerRewardCents,
      entryType: "referral_bonus",
      description: `Referral bonus after ${referredLabel}'s first deposit`,
      referenceType: "human_referral",
      referenceId: String(referredHumanUserId),
      metadata: {
        referred_human_user_id: referredHumanUserId,
        qualifying_reference_type: params.qualifyingReferenceType,
        qualifying_reference_id: params.qualifyingReferenceId,
      },
    });

    await addCreditLedgerEntryWithExecutor(transaction, {
      humanUserId: referredHumanUserId,
      amountCents: referredRewardCents,
      entryType: "referred_deposit_bonus",
      description: "Referral bonus after your first deposit",
      referenceType: "human_referral",
      referenceId: String(referredHumanUserId),
      metadata: {
        referrer_human_user_id: referrerHumanUserId,
        qualifying_reference_type: params.qualifyingReferenceType,
        qualifying_reference_id: params.qualifyingReferenceId,
      },
    });

    await transaction.commit();
    return { status: "qualified" as const };
  } finally {
    transaction.close();
  }
}

export async function ensureHumanAccountSchema() {
  if (schemaReady) return;
  await ensureSchema();
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
    `CREATE TABLE IF NOT EXISTS human_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      human_user_id INTEGER NOT NULL,
      session_token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_sessions_user_id ON human_sessions(human_user_id)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_sessions_expires_at ON human_sessions(expires_at)",
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
    `CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      human_user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      description TEXT,
      reference_type TEXT,
      reference_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_credit_ledger_human_id ON credit_ledger(human_user_id)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_credit_ledger_reference ON credit_ledger(reference_type, reference_id)",
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS human_credit_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_public_id TEXT NOT NULL UNIQUE,
      sender_human_user_id INTEGER NOT NULL,
      recipient_human_user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_credit_transfers_sender ON human_credit_transfers(sender_human_user_id, created_at)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_human_credit_transfers_recipient ON human_credit_transfers(recipient_human_user_id, created_at)",
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

  schemaReady = true;
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

export async function upsertHumanUserFromGoogle(params: {
  email: string;
  googleSub: string;
  emailVerified?: boolean;
  displayName?: string | null;
  pictureUrl?: string | null;
  referralCode?: string | number | null;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const email = normalizeEmail(params.email);
  const now = new Date().toISOString();

  const existingResult = await client.execute({
    sql: `SELECT * FROM human_users
          WHERE google_sub = ? OR email = ?
          LIMIT 1`,
    args: [params.googleSub.trim(), email],
  });
  const existingRow = existingResult.rows?.[0] as Record<string, unknown> | undefined;

  if (existingRow) {
    const existing = mapHumanUser(existingRow);
    await client.execute({
      sql: `UPDATE human_users
            SET email = ?, email_verified = ?, google_sub = ?, auth_provider = 'google',
                display_name = ?, picture_url = ?, updated_at = ?
            WHERE id = ?`,
      args: [
        email,
        params.emailVerified ? 1 : 0,
        params.googleSub.trim(),
        params.displayName?.trim() || existing.display_name,
        params.pictureUrl?.trim() || existing.picture_url,
        now,
        existing.id,
      ],
    });
    const user = await getHumanUserById(existing.id);
    if (!user) throw new Error("Failed to update human user.");
    await claimPendingHumanCreditClaimsForUser(user.id);
    return { user, created: false as const };
  }

  const transaction = await client.transaction("write");
  let userId = 0;
  try {
    const insertResult = await transaction.execute({
      sql: `INSERT INTO human_users
            (email, email_verified, google_sub, auth_provider, display_name, picture_url, created_at, updated_at)
            VALUES (?, ?, ?, 'google', ?, ?, ?, ?)`,
      args: [
        email,
        params.emailVerified ? 1 : 0,
        params.googleSub.trim(),
        params.displayName?.trim() || null,
        params.pictureUrl?.trim() || null,
        now,
        now,
      ],
    });
    const rawId = (insertResult as { lastInsertRowid?: bigint | number })
      .lastInsertRowid;
    userId = rawId != null ? Number(rawId) : 0;
    if (!userId) throw new Error("Failed to create human user.");
    await ensureHumanHandleWithExecutor(transaction, {
      humanUserId: userId,
      email,
      displayName: params.displayName,
    });
    await addCreditLedgerEntryWithExecutor(transaction, {
      humanUserId: userId,
      amountCents: STARTER_CREDIT_CENTS,
      entryType: "starter_credit",
      description: "Starter credits",
    });
    await createPendingReferralWithExecutor(transaction, {
      referrerHumanUserId: parseHumanReferralCode(params.referralCode),
      referredHumanUserId: userId,
    });
    await transaction.commit();
  } finally {
    transaction.close();
  }

  const user = await getHumanUserById(userId);
  if (!user) throw new Error("Failed to load created human user.");
  await claimPendingHumanCreditClaimsForUser(user.id);
  return { user, created: true as const };
}

export async function upsertHumanUserDev(params: {
  email: string;
  displayName?: string | null;
  referralCode?: string | number | null;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const email = normalizeEmail(params.email);
  const now = new Date().toISOString();
  const existing = await getHumanUserByEmail(email);
  if (existing) {
    await client.execute({
      sql: `UPDATE human_users
            SET display_name = ?, auth_provider = 'dev', updated_at = ?
            WHERE id = ?`,
      args: [params.displayName?.trim() || existing.display_name, now, existing.id],
    });
    const user = await getHumanUserById(existing.id);
    if (!user) throw new Error("Failed to update dev user.");
    await claimPendingHumanCreditClaimsForUser(user.id);
    return { user, created: false as const };
  }

  const transaction = await client.transaction("write");
  let userId = 0;
  try {
    const insertResult = await transaction.execute({
      sql: `INSERT INTO human_users
            (email, email_verified, google_sub, auth_provider, display_name, picture_url, created_at, updated_at)
            VALUES (?, 1, NULL, 'dev', ?, NULL, ?, ?)`,
      args: [email, params.displayName?.trim() || email, now, now],
    });
    const rawId = (insertResult as { lastInsertRowid?: bigint | number })
      .lastInsertRowid;
    userId = rawId != null ? Number(rawId) : 0;
    if (!userId) throw new Error("Failed to create dev user.");
    await ensureHumanHandleWithExecutor(transaction, {
      humanUserId: userId,
      email,
      displayName: params.displayName,
    });
    await addCreditLedgerEntryWithExecutor(transaction, {
      humanUserId: userId,
      amountCents: STARTER_CREDIT_CENTS,
      entryType: "starter_credit",
      description: "Starter credits",
    });
    await createPendingReferralWithExecutor(transaction, {
      referrerHumanUserId: parseHumanReferralCode(params.referralCode),
      referredHumanUserId: userId,
    });
    await transaction.commit();
  } finally {
    transaction.close();
  }

  const user = await getHumanUserById(userId);
  if (!user) throw new Error("Failed to load created dev user.");
  await claimPendingHumanCreditClaimsForUser(user.id);
  return { user, created: true as const };
}

export async function createHumanSession(params: {
  humanUserId: number;
  ttlDays?: number;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const now = new Date();
  const expires = new Date(now.getTime() + (params.ttlDays ?? 30) * 24 * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(sessionToken);
  const nowIso = now.toISOString();

  await client.execute({
    sql: `INSERT INTO human_sessions
          (human_user_id, session_token_hash, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [params.humanUserId, tokenHash, expires.toISOString(), nowIso, nowIso],
  });

  return {
    sessionToken,
    expiresAt: expires.toISOString(),
  };
}

export async function getHumanUserBySessionToken(sessionToken: string) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT
            s.id AS session_id,
            s.expires_at,
            u.*
          FROM human_sessions s
          JOIN human_users u ON u.id = s.human_user_id
          WHERE s.session_token_hash = ?
          LIMIT 1`,
    args: [hashSessionToken(sessionToken)],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const expiresAt = String(row.expires_at);
  if (new Date(expiresAt).getTime() <= Date.now()) {
    await deleteHumanSession(sessionToken);
    return null;
  }
  return mapHumanUser(row);
}

export async function deleteHumanSession(sessionToken: string) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  await client.execute({
    sql: "DELETE FROM human_sessions WHERE session_token_hash = ?",
    args: [hashSessionToken(sessionToken)],
  });
}

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
  const client = getTursoClient();
  await addCreditLedgerEntryWithExecutor(client, params);
}

export async function findCreditLedgerEntry(params: {
  humanUserId: number;
  entryType?: string | null;
  referenceType: string;
  referenceId: string;
}) {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM credit_ledger
          WHERE human_user_id = ?
            AND reference_type = ?
            AND reference_id = ?
            ${params.entryType ? "AND entry_type = ?" : ""}
          ORDER BY created_at DESC
          LIMIT 1`,
    args: params.entryType
      ? [params.humanUserId, params.referenceType, params.referenceId, params.entryType]
      : [params.humanUserId, params.referenceType, params.referenceId],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapLedgerRow(row) : null;
}

export async function getHumanCreditBalance(humanUserId: number) {
  await ensureHumanAccountSchema();
  await expireExpiredHumanCreditClaims();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT COALESCE(SUM(amount_cents), 0) AS balance_cents FROM credit_ledger WHERE human_user_id = ?",
    args: [humanUserId],
  });
  const row = result.rows?.[0] as { balance_cents?: number | bigint | string } | undefined;
  return row?.balance_cents != null ? Number(row.balance_cents) : 0;
}

export async function listCreditLedgerEntries(humanUserId: number, limit = 25) {
  await ensureHumanAccountSchema();
  await expireExpiredHumanCreditClaims();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM credit_ledger
          WHERE human_user_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [humanUserId, Math.max(1, Math.min(limit, 200))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapLedgerRow);
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

  const client = getTursoClient();
  const transaction = await client.transaction("write");

  try {
    const senderResult = await transaction.execute({
      sql: "SELECT * FROM human_users WHERE id = ? LIMIT 1",
      args: [params.senderHumanUserId],
    });
    const recipientResult = await transaction.execute({
      sql: "SELECT * FROM human_users WHERE id = ? LIMIT 1",
      args: [params.recipientHumanUserId],
    });
    const balanceResult = await transaction.execute({
      sql: "SELECT COALESCE(SUM(amount_cents), 0) AS balance_cents FROM credit_ledger WHERE human_user_id = ?",
      args: [params.senderHumanUserId],
    });
    const senderRow = senderResult.rows?.[0] as Record<string, unknown> | undefined;
    const recipientRow = recipientResult.rows?.[0] as
      | Record<string, unknown>
      | undefined;
    if (!senderRow) throw new Error("Sender account not found.");
    if (!recipientRow) throw new Error("Recipient account not found.");

    const sender = mapHumanUser(senderRow);
    const recipient = mapHumanUser(recipientRow);
    const balanceRow = balanceResult.rows?.[0] as
      | { balance_cents?: number | bigint | string }
      | undefined;
    const senderBalanceCents =
      balanceRow?.balance_cents != null ? Number(balanceRow.balance_cents) : 0;
    if (senderBalanceCents < amountCents) {
      throw new Error(
        `This transfer exceeds your current credit balance ($${(senderBalanceCents / 100).toFixed(2)} available).`,
      );
    }

    const transferPublicId = `tr_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const insertResult = await transaction.execute({
      sql: `INSERT INTO human_credit_transfers
            (transfer_public_id, sender_human_user_id, recipient_human_user_id, amount_cents, note, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
      args: [
        transferPublicId,
        sender.id,
        recipient.id,
        amountCents,
        note,
        createdAt,
      ],
    });
    const rawId = (insertResult as { lastInsertRowid?: bigint | number })
      .lastInsertRowid;
    let transferId = rawId != null ? Number(rawId) : 0;
    if (!transferId) {
      const fallback = await transaction.execute({
        sql: "SELECT id FROM human_credit_transfers WHERE transfer_public_id = ? LIMIT 1",
        args: [transferPublicId],
      });
      transferId = Number(
        (fallback.rows?.[0] as Record<string, unknown> | undefined)?.id ?? 0,
      );
    }
    if (!transferId) throw new Error("Credit transfer creation failed.");

    const metadata = {
      note,
      sender_human_user_id: sender.id,
      sender_handle: sender.handle_lower,
      recipient_human_user_id: recipient.id,
      recipient_handle: recipient.handle_lower,
      transfer_public_id: transferPublicId,
    };

    await addCreditLedgerEntryWithExecutor(transaction, {
      humanUserId: sender.id,
      amountCents: -amountCents,
      entryType: "credit_transfer_sent",
      description: `Sent credits to @${recipient.handle_display}`,
      referenceType: "human_credit_transfer",
      referenceId: transferPublicId,
      metadata,
    });
    await addCreditLedgerEntryWithExecutor(transaction, {
      humanUserId: recipient.id,
      amountCents,
      entryType: "credit_transfer_received",
      description: `Received credits from @${sender.handle_display}`,
      referenceType: "human_credit_transfer",
      referenceId: transferPublicId,
      metadata,
    });

    const transferResult = await transaction.execute({
      sql: "SELECT * FROM human_credit_transfers WHERE id = ? LIMIT 1",
      args: [transferId],
    });
    const transferRow = transferResult.rows?.[0] as
      | Record<string, unknown>
      | undefined;
    if (!transferRow) throw new Error("Credit transfer creation failed.");

    await transaction.commit();
    return {
      transfer: mapHumanCreditTransferRow(transferRow),
      sender,
      recipient,
      senderBalanceCents: senderBalanceCents - amountCents,
    };
  } finally {
    transaction.close();
  }
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

  const client = getTursoClient();
  const transaction = await client.transaction("write");

  try {
    const senderResult = await transaction.execute({
      sql: "SELECT * FROM human_users WHERE id = ? LIMIT 1",
      args: [params.senderHumanUserId],
    });
    const senderRow = senderResult.rows?.[0] as Record<string, unknown> | undefined;
    if (!senderRow) throw new Error("Sender account not found.");
    const sender = mapHumanUser(senderRow);
    if (normalizeEmail(sender.email) === recipientEmail) {
      throw new Error("Choose a different email address to pay.");
    }

    const existingRecipient = await transaction.execute({
      sql: "SELECT id FROM human_users WHERE email = ? LIMIT 1",
      args: [recipientEmail],
    });
    if (existingRecipient.rows?.[0]) {
      throw new Error("That email already has an OttoAuth account.");
    }

    const balanceResult = await transaction.execute({
      sql: "SELECT COALESCE(SUM(amount_cents), 0) AS balance_cents FROM credit_ledger WHERE human_user_id = ?",
      args: [sender.id],
    });
    const balanceRow = balanceResult.rows?.[0] as
      | { balance_cents?: number | bigint | string }
      | undefined;
    const senderBalanceCents =
      balanceRow?.balance_cents != null ? Number(balanceRow.balance_cents) : 0;
    if (senderBalanceCents < amountCents) {
      throw new Error(
        `This transfer exceeds your current credit balance ($${(senderBalanceCents / 100).toFixed(2)} available).`,
      );
    }

    const claimPublicId = `claim_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + CREDIT_CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const insertResult = await transaction.execute({
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
    const rawId = (insertResult as { lastInsertRowid?: bigint | number })
      .lastInsertRowid;
    let claimId = rawId != null ? Number(rawId) : 0;
    if (!claimId) {
      const fallback = await transaction.execute({
        sql: "SELECT id FROM human_credit_claims WHERE claim_public_id = ? LIMIT 1",
        args: [claimPublicId],
      });
      claimId = Number(
        (fallback.rows?.[0] as Record<string, unknown> | undefined)?.id ?? 0,
      );
    }
    if (!claimId) throw new Error("Credit claim creation failed.");

    await addCreditLedgerEntryWithExecutor(transaction, {
      humanUserId: sender.id,
      amountCents: -amountCents,
      entryType: "credit_claim_sent",
      description: `Sent credits to ${recipientEmail} (pending claim)`,
      referenceType: "human_credit_claim",
      referenceId: claimPublicId,
      metadata: {
        note,
        sender_human_user_id: sender.id,
        sender_handle: sender.handle_lower,
        recipient_email: recipientEmail,
        claim_public_id: claimPublicId,
        expires_at: expiresAt,
      },
    });

    const claimResult = await transaction.execute({
      sql: "SELECT * FROM human_credit_claims WHERE id = ? LIMIT 1",
      args: [claimId],
    });
    const claimRow = claimResult.rows?.[0] as Record<string, unknown> | undefined;
    if (!claimRow) throw new Error("Credit claim creation failed.");

    await transaction.commit();
    return {
      claim: mapHumanCreditClaimRow(claimRow),
      sender,
      senderBalanceCents: senderBalanceCents - amountCents,
    };
  } finally {
    transaction.close();
  }
}

export async function expireExpiredHumanCreditClaims() {
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  const transaction = await client.transaction("write");
  const expired: HumanCreditClaimRecord[] = [];

  try {
    const now = new Date().toISOString();
    const result = await transaction.execute({
      sql: `SELECT *
            FROM human_credit_claims
            WHERE status = 'pending'
              AND expires_at <= ?
            ORDER BY expires_at ASC
            LIMIT 100`,
      args: [now],
    });

    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const claim = mapHumanCreditClaimRow(row);
      const updateResult = await transaction.execute({
        sql: `UPDATE human_credit_claims
              SET status = 'expired'
              WHERE id = ?
                AND status = 'pending'
                AND expires_at <= ?`,
        args: [claim.id, now],
      });
      if (updateResult.rowsAffected === 0) continue;

      await addCreditLedgerEntryWithExecutor(transaction, {
        humanUserId: claim.sender_human_user_id,
        amountCents: claim.amount_cents,
        entryType: "credit_claim_expired_refund",
        description: `Expired claim refunded from ${claim.recipient_email}`,
        referenceType: "human_credit_claim",
        referenceId: claim.claim_public_id,
        metadata: {
          note: claim.note,
          recipient_email: claim.recipient_email,
          claim_public_id: claim.claim_public_id,
          expires_at: claim.expires_at,
        },
      });
      expired.push({
        ...claim,
        status: "expired",
      });
    }

    await transaction.commit();
    return {
      expired,
      totalRefundedCents: expired.reduce(
        (total, claim) => total + claim.amount_cents,
        0,
      ),
    };
  } finally {
    transaction.close();
  }
}

export async function claimPendingHumanCreditClaimsForUser(humanUserId: number) {
  await ensureHumanAccountSchema();
  await expireExpiredHumanCreditClaims();
  const user = await getHumanUserById(humanUserId);
  if (!user) throw new Error("Human account not found.");
  const recipientEmail = normalizeEmail(user.email);
  const client = getTursoClient();
  const transaction = await client.transaction("write");
  const claimed: HumanCreditClaimRecord[] = [];

  try {
    const now = new Date().toISOString();
    const result = await transaction.execute({
      sql: `SELECT *
            FROM human_credit_claims
            WHERE recipient_email = ?
              AND status = 'pending'
              AND expires_at > ?
            ORDER BY created_at ASC`,
      args: [recipientEmail, now],
    });

    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const claim = mapHumanCreditClaimRow(row);
      const claimedAt = new Date().toISOString();
      const updateResult = await transaction.execute({
        sql: `UPDATE human_credit_claims
              SET status = 'claimed', claimed_human_user_id = ?, claimed_at = ?
              WHERE id = ?
                AND status = 'pending'
                AND expires_at > ?`,
        args: [user.id, claimedAt, claim.id, claimedAt],
      });
      if (updateResult.rowsAffected === 0) continue;

      const senderResult = await transaction.execute({
        sql: "SELECT * FROM human_users WHERE id = ? LIMIT 1",
        args: [claim.sender_human_user_id],
      });
      const senderRow = senderResult.rows?.[0] as
        | Record<string, unknown>
        | undefined;
      const sender = senderRow ? mapHumanUser(senderRow) : null;

      await addCreditLedgerEntryWithExecutor(transaction, {
        humanUserId: user.id,
        amountCents: claim.amount_cents,
        entryType: "credit_claim_received",
        description: sender
          ? `Claimed credits from @${sender.handle_display}`
          : "Claimed OttoAuth credits",
        referenceType: "human_credit_claim",
        referenceId: claim.claim_public_id,
        metadata: {
          note: claim.note,
          sender_human_user_id: claim.sender_human_user_id,
          sender_handle: sender?.handle_lower ?? null,
          recipient_email: recipientEmail,
          claimed_human_user_id: user.id,
          claim_public_id: claim.claim_public_id,
        },
      });
      claimed.push({
        ...claim,
        status: "claimed",
        claimed_human_user_id: user.id,
        claimed_at: claimedAt,
      });
    }

    await transaction.commit();
    return {
      claimed,
      totalClaimedCents: claimed.reduce(
        (total, claim) => total + claim.amount_cents,
        0,
      ),
    };
  } finally {
    transaction.close();
  }
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
