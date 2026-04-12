import { createHash, randomBytes } from "node:crypto";
import { normalizePairingKey } from "@/lib/agent-auth";
import {
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

let schemaReady = false;

const STARTER_CREDIT_CENTS = 2000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDeviceCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function displayToken(raw: string) {
  const groups = raw.match(/.{1,4}/g);
  return groups ? groups.join("-") : raw;
}

function randomDisplayToken(byteLength = 10) {
  return displayToken(randomBytes(byteLength).toString("hex").toUpperCase());
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function mapHumanUser(row: Record<string, unknown>): HumanUserRecord {
  return {
    id: Number(row.id),
    email: String(row.email),
    email_verified: Number(row.email_verified ?? 0),
    google_sub: row.google_sub == null ? null : String(row.google_sub),
    auth_provider: String(row.auth_provider),
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
      display_name TEXT,
      picture_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
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
    return { user, created: false as const };
  }

  const insertResult = await client.execute({
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
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  const userId = rawId != null ? Number(rawId) : 0;
  if (!userId) throw new Error("Failed to create human user.");
  await addCreditLedgerEntry({
    humanUserId: userId,
    amountCents: STARTER_CREDIT_CENTS,
    entryType: "starter_credit",
    description: "Starter credits",
  });
  const user = await getHumanUserById(userId);
  if (!user) throw new Error("Failed to load created human user.");
  return { user, created: true as const };
}

export async function upsertHumanUserDev(params: {
  email: string;
  displayName?: string | null;
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
    return { user, created: false as const };
  }

  const insertResult = await client.execute({
    sql: `INSERT INTO human_users
          (email, email_verified, google_sub, auth_provider, display_name, picture_url, created_at, updated_at)
          VALUES (?, 1, NULL, 'dev', ?, NULL, ?, ?)`,
    args: [email, params.displayName?.trim() || email, now, now],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  const userId = rawId != null ? Number(rawId) : 0;
  if (!userId) throw new Error("Failed to create dev user.");
  await addCreditLedgerEntry({
    humanUserId: userId,
    amountCents: STARTER_CREDIT_CENTS,
    entryType: "starter_credit",
    description: "Starter credits",
  });
  const user = await getHumanUserById(userId);
  if (!user) throw new Error("Failed to load created dev user.");
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
  const now = new Date().toISOString();
  await client.execute({
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

export async function getHumanCreditBalance(humanUserId: number) {
  await ensureHumanAccountSchema();
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
