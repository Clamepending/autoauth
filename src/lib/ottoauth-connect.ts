import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import type { AgentRecord } from "@/lib/db";
import { createHumanGeneratedAgentApiKey, ensureHumanAccountSchema } from "@/lib/human-accounts";
import { parseAllowedSdkReturnUrl, normalizeSdkAppId, normalizeSdkAppName } from "@/lib/ottoauth-sdk";
import { getTursoClient } from "@/lib/turso";

export const SDK_INSTALL_SCOPES = [
  "files:write",
  "quotes:read",
  "offers:read",
  "checkout.sessions:create",
  "orders:create",
  "orders:read",
] as const;

export type SdkInstallScope = (typeof SDK_INSTALL_SCOPES)[number];

export type SdkConnectSessionStatus =
  | "pending"
  | "approved"
  | "consuming"
  | "consumed"
  | "canceled"
  | "expired";

export type SdkConnectSessionRecord = {
  id: string;
  app_id: string;
  app_name: string;
  install_id: string;
  redirect_url: string;
  scopes_json: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: "S256";
  status: SdkConnectSessionStatus;
  human_user_id: number | null;
  agent_id: number | null;
  code_hash: string | null;
  expires_at: string;
  code_expires_at: string | null;
  approved_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SdkAppInstallTokenRecord = {
  id: string;
  human_user_id: number;
  agent_id: number;
  app_id: string;
  app_name: string;
  install_id: string;
  scopes_json: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

let connectSchemaReady = false;

function nowIso() {
  return new Date().toISOString();
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function makeConnectSessionId() {
  return `cn_${randomBytes(18).toString("hex")}`;
}

function makeAuthCode() {
  return `oc_${randomBytes(32).toString("hex")}`;
}

function makeInstallTokenId() {
  return `instok_${randomBytes(16).toString("hex")}`;
}

function sessionExpiry() {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString();
}

function codeExpiry() {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function mapConnectSessionRow(row: Record<string, unknown>): SdkConnectSessionRecord {
  return {
    id: String(row.id),
    app_id: String(row.app_id),
    app_name: String(row.app_name),
    install_id: String(row.install_id),
    redirect_url: String(row.redirect_url),
    scopes_json: String(row.scopes_json || "[]"),
    state: row.state == null ? null : String(row.state),
    code_challenge: String(row.code_challenge),
    code_challenge_method: "S256",
    status: String(row.status || "pending") as SdkConnectSessionStatus,
    human_user_id:
      row.human_user_id == null || row.human_user_id === ""
        ? null
        : Number(row.human_user_id),
    agent_id: row.agent_id == null || row.agent_id === "" ? null : Number(row.agent_id),
    code_hash: row.code_hash == null ? null : String(row.code_hash),
    expires_at: String(row.expires_at),
    code_expires_at: row.code_expires_at == null ? null : String(row.code_expires_at),
    approved_at: row.approved_at == null ? null : String(row.approved_at),
    consumed_at: row.consumed_at == null ? null : String(row.consumed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapInstallTokenRow(row: Record<string, unknown>): SdkAppInstallTokenRecord {
  return {
    id: String(row.id),
    human_user_id: Number(row.human_user_id),
    agent_id: Number(row.agent_id),
    app_id: String(row.app_id),
    app_name: String(row.app_name),
    install_id: String(row.install_id),
    scopes_json: String(row.scopes_json || "[]"),
    token_hash: String(row.token_hash),
    created_at: String(row.created_at),
    last_used_at: row.last_used_at == null ? null : String(row.last_used_at),
    revoked_at: row.revoked_at == null ? null : String(row.revoked_at),
  };
}

export async function ensureSdkConnectSchema() {
  if (connectSchemaReady) return;
  await ensureHumanAccountSchema();
  const client = getTursoClient();
  await client.execute(
    `CREATE TABLE IF NOT EXISTS sdk_connect_sessions (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      install_id TEXT NOT NULL,
      redirect_url TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      state TEXT,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256',
      status TEXT NOT NULL,
      human_user_id INTEGER,
      agent_id INTEGER,
      code_hash TEXT,
      expires_at TEXT NOT NULL,
      code_expires_at TEXT,
      approved_at TEXT,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_sdk_connect_sessions_status ON sdk_connect_sessions(status, expires_at)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sdk_connect_sessions_code ON sdk_connect_sessions(code_hash) WHERE code_hash IS NOT NULL",
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS sdk_app_install_tokens (
      id TEXT PRIMARY KEY,
      human_user_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      app_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      install_id TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_sdk_install_tokens_agent ON sdk_app_install_tokens(agent_id)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_sdk_install_tokens_human_app ON sdk_app_install_tokens(human_user_id, app_id, install_id)",
  );
  connectSchemaReady = true;
}

export function normalizeSdkInstallId(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || `install-${randomBytes(8).toString("hex")}`;
}

export function normalizeSdkInstallScopes(value: unknown): SdkInstallScope[] {
  const allowed = new Set<string>(SDK_INSTALL_SCOPES);
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  const scopes = raw
    .filter((scope): scope is string => typeof scope === "string")
    .map((scope) => scope.trim())
    .filter((scope) => allowed.has(scope)) as SdkInstallScope[];
  const defaults: SdkInstallScope[] = [
    "files:write",
    "quotes:read",
    "checkout.sessions:create",
  ];
  return Array.from(new Set(scopes.length ? scopes : defaults));
}

export function parseScopesJson(value: string): SdkInstallScope[] {
  try {
    return normalizeSdkInstallScopes(JSON.parse(value));
  } catch {
    return [];
  }
}

export function sdkInstallHasScope(
  install: SdkAppInstallTokenRecord | null | undefined,
  scope: SdkInstallScope,
) {
  if (!install) return true;
  return parseScopesJson(install.scopes_json).includes(scope);
}

export function sdkInstallScopeResponse(scope: SdkInstallScope) {
  return NextResponse.json(
    {
      error: `This OttoAuth install token does not have the ${scope} scope.`,
      code: "ottoauth_install_scope_denied",
      required_scope: scope,
    },
    { status: 403 },
  );
}

export function connectUrl(session: SdkConnectSessionRecord, baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/connect/${encodeURIComponent(session.id)}`;
}

export async function createSdkConnectSession(params: {
  payload: Record<string, unknown>;
  baseUrl: string;
}) {
  const appId = normalizeSdkAppId(params.payload.app_id ?? params.payload.appId);
  const appName = normalizeSdkAppName(
    params.payload.app_name ?? params.payload.appName,
    appId,
  );
  const installId = normalizeSdkInstallId(params.payload.install_id ?? params.payload.installId);
  const redirectUrl = parseAllowedSdkReturnUrl(
    typeof params.payload.redirect_url === "string"
      ? params.payload.redirect_url
      : typeof params.payload.redirectUrl === "string"
        ? params.payload.redirectUrl
        : null,
  );
  if (!redirectUrl) {
    throw new Error("redirect_url must be http(s), localhost, or an allowed SDK return origin.");
  }
  const codeChallenge =
    typeof params.payload.code_challenge === "string"
      ? params.payload.code_challenge.trim()
      : typeof params.payload.codeChallenge === "string"
        ? params.payload.codeChallenge.trim()
        : "";
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(codeChallenge)) {
    throw new Error("code_challenge is required and must be a base64url PKCE challenge.");
  }
  const method =
    typeof params.payload.code_challenge_method === "string"
      ? params.payload.code_challenge_method.trim().toUpperCase()
      : typeof params.payload.codeChallengeMethod === "string"
        ? params.payload.codeChallengeMethod.trim().toUpperCase()
        : "S256";
  if (method !== "S256") {
    throw new Error("Only S256 code_challenge_method is supported.");
  }
  const state =
    typeof params.payload.state === "string" && params.payload.state.trim()
      ? params.payload.state.trim().slice(0, 400)
      : null;
  const scopes = normalizeSdkInstallScopes(params.payload.scopes);
  const now = nowIso();
  const id = makeConnectSessionId();
  await ensureSdkConnectSchema();
  await getTursoClient().execute({
    sql: `INSERT INTO sdk_connect_sessions
          (id, app_id, app_name, install_id, redirect_url, scopes_json, state,
           code_challenge, code_challenge_method, status, human_user_id,
           agent_id, code_hash, expires_at, code_expires_at, approved_at,
           consumed_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'S256', 'pending', NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, ?)`,
    args: [
      id,
      appId,
      appName,
      installId,
      redirectUrl.href,
      JSON.stringify(scopes),
      state,
      codeChallenge,
      sessionExpiry(),
      now,
      now,
    ],
  });
  const session = await getSdkConnectSessionById(id);
  if (!session) throw new Error("Connect session creation failed.");
  return session;
}

export async function getSdkConnectSessionById(sessionId: string) {
  await ensureSdkConnectSchema();
  const result = await getTursoClient().execute({
    sql: "SELECT * FROM sdk_connect_sessions WHERE id = ? LIMIT 1",
    args: [sessionId.trim()],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapConnectSessionRow(row) : null;
}

export async function getFreshSdkConnectSessionById(sessionId: string) {
  const session = await getSdkConnectSessionById(sessionId);
  if (!session) return null;
  if (session.status === "pending" && new Date(session.expires_at).getTime() <= Date.now()) {
    const now = nowIso();
    await getTursoClient().execute({
      sql: "UPDATE sdk_connect_sessions SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'",
      args: [now, session.id],
    });
    return getSdkConnectSessionById(session.id);
  }
  return session;
}

export async function approveSdkConnectSession(params: {
  sessionId: string;
  humanUserId: number;
}) {
  const session = await getFreshSdkConnectSessionById(params.sessionId);
  if (!session) throw new Error("Connect session not found.");
  if (session.status !== "pending") {
    throw new Error(`Connect session is ${session.status}.`);
  }
  const code = makeAuthCode();
  const now = nowIso();
  await getTursoClient().execute({
    sql: `UPDATE sdk_connect_sessions
          SET status = 'approved',
              human_user_id = ?,
              code_hash = ?,
              code_expires_at = ?,
              approved_at = ?,
              updated_at = ?
          WHERE id = ? AND status = 'pending'`,
    args: [params.humanUserId, hashToken(code), codeExpiry(), now, now, session.id],
  });
  const redirectUrl = new URL(session.redirect_url);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("install_id", session.install_id);
  redirectUrl.searchParams.set("app_id", session.app_id);
  if (session.state) redirectUrl.searchParams.set("state", session.state);
  return { redirectUrl: redirectUrl.href };
}

export async function cancelSdkConnectSession(params: {
  sessionId: string;
}) {
  const session = await getFreshSdkConnectSessionById(params.sessionId);
  if (!session) throw new Error("Connect session not found.");
  const now = nowIso();
  await getTursoClient().execute({
    sql: "UPDATE sdk_connect_sessions SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('pending', 'approved')",
    args: [now, session.id],
  });
  const redirectUrl = new URL(session.redirect_url);
  redirectUrl.searchParams.set("error", "access_denied");
  redirectUrl.searchParams.set("install_id", session.install_id);
  if (session.state) redirectUrl.searchParams.set("state", session.state);
  return { redirectUrl: redirectUrl.href };
}

function challengeFromVerifier(verifier: string) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export async function exchangeSdkConnectCode(params: {
  code: string;
  codeVerifier: string;
  installId: string;
}) {
  const code = params.code.trim();
  const codeVerifier = params.codeVerifier.trim();
  const installId = normalizeSdkInstallId(params.installId);
  if (!code || !codeVerifier) {
    throw new Error("code and code_verifier are required.");
  }
  await ensureSdkConnectSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM sdk_connect_sessions WHERE code_hash = ? LIMIT 1",
    args: [hashToken(code)],
  });
  const sessionRow = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!sessionRow) throw new Error("Invalid or expired connect code.");
  const session = mapConnectSessionRow(sessionRow);
  if (session.status !== "approved" || session.consumed_at) {
    throw new Error("Connect code has already been used.");
  }
  if (session.install_id !== installId) {
    throw new Error("Connect code install_id mismatch.");
  }
  if (!session.human_user_id) {
    throw new Error("Connect session is missing its human account.");
  }
  if (!session.code_expires_at || new Date(session.code_expires_at).getTime() <= Date.now()) {
    throw new Error("Connect code expired.");
  }
  if (!constantTimeEqual(challengeFromVerifier(codeVerifier), session.code_challenge)) {
    throw new Error("Invalid code_verifier.");
  }

  const now = nowIso();
  const lock = await client.execute({
    sql: `UPDATE sdk_connect_sessions
          SET status = 'consuming', updated_at = ?
          WHERE id = ? AND status = 'approved' AND consumed_at IS NULL`,
    args: [now, session.id],
  });
  if ((lock.rowsAffected ?? 0) === 0) {
    throw new Error("Connect code has already been used.");
  }

  const generated = await createHumanGeneratedAgentApiKey({
    humanUserId: session.human_user_id,
    agentName: `${session.app_name} install`,
  });
  const tokenRecord: SdkAppInstallTokenRecord = {
    id: makeInstallTokenId(),
    human_user_id: session.human_user_id,
    agent_id: generated.agent.id,
    app_id: session.app_id,
    app_name: session.app_name,
    install_id: session.install_id,
    scopes_json: session.scopes_json,
    token_hash: hashToken(generated.privateKey),
    created_at: nowIso(),
    last_used_at: null,
    revoked_at: null,
  };
  await client.execute({
    sql: `INSERT INTO sdk_app_install_tokens
          (id, human_user_id, agent_id, app_id, app_name, install_id,
           scopes_json, token_hash, created_at, last_used_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    args: [
      tokenRecord.id,
      tokenRecord.human_user_id,
      tokenRecord.agent_id,
      tokenRecord.app_id,
      tokenRecord.app_name,
      tokenRecord.install_id,
      tokenRecord.scopes_json,
      tokenRecord.token_hash,
      tokenRecord.created_at,
    ],
  });
  const consumedAt = nowIso();
  await client.execute({
    sql: `UPDATE sdk_connect_sessions
          SET status = 'consumed',
              agent_id = ?,
              consumed_at = ?,
              updated_at = ?
          WHERE id = ?`,
    args: [generated.agent.id, consumedAt, consumedAt, session.id],
  });

  return {
    accessToken: generated.privateKey,
    agent: generated.agent,
    install: tokenRecord,
    scopes: parseScopesJson(session.scopes_json),
  };
}

export async function getActiveSdkInstallForBearer(params: {
  agentId: number;
  token: string;
}) {
  await ensureSdkConnectSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT * FROM sdk_app_install_tokens
          WHERE agent_id = ?
            AND token_hash = ?
            AND revoked_at IS NULL
          LIMIT 1`,
    args: [params.agentId, hashToken(params.token)],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const install = mapInstallTokenRow(row);
  await getTursoClient().execute({
    sql: "UPDATE sdk_app_install_tokens SET last_used_at = ? WHERE id = ?",
    args: [nowIso(), install.id],
  });
  return install;
}

export function formatConnectSessionForApi(
  session: SdkConnectSessionRecord,
  baseUrl: string,
) {
  return {
    id: session.id,
    object: "connect.session",
    status: session.status,
    connect_url: connectUrl(session, baseUrl),
    app: {
      id: session.app_id,
      name: session.app_name,
    },
    install_id: session.install_id,
    redirect_url: session.redirect_url,
    scopes: parseScopesJson(session.scopes_json),
    expires_at: session.expires_at,
    created_at: session.created_at,
  };
}

export function formatInstallTokenForApi(params: {
  accessToken: string;
  agent: AgentRecord;
  install: SdkAppInstallTokenRecord;
  scopes: SdkInstallScope[];
}) {
  return {
    ok: true,
    token_type: "Bearer",
    access_token: params.accessToken,
    install_id: params.install.install_id,
    app: {
      id: params.install.app_id,
      name: params.install.app_name,
    },
    agent: {
      id: params.agent.id,
      username: params.agent.username_display,
      username_lower: params.agent.username_lower,
    },
    scopes: params.scopes,
  };
}
