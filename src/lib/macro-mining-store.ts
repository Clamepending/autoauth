import { ensureSchema } from "@/lib/db";
import { getTursoClient } from "@/lib/turso";

export type MacroTraceRecord = {
  id: number;
  domain: string;
  trace_json: string;
  device_id: string | null;
  created_at: string;
};

export type MacroStatus = "candidate" | "active" | "deprecated";

export type MacroRegistryRecord = {
  id: string;
  domain: string;
  macro_json: string;
  confidence: number;
  success_count: number;
  failure_count: number;
  status: MacroStatus;
  created_at: string;
  updated_at: string;
};

export type MacroMiningRunRecord = {
  id: number;
  domain: string;
  started_at: string;
  completed_at: string | null;
  traces_used: number;
  macros_found: number;
};

const MAX_TRACES_PER_DOMAIN = 100;
const DEPRECATION_MIN_EXECUTIONS = 20;
const DEPRECATION_THRESHOLD = 0.4;

let schemaReady = false;

export async function ensureMacroMiningSchema() {
  if (schemaReady) return;
  await ensureSchema();
  const client = getTursoClient();

  await client.execute(
    `CREATE TABLE IF NOT EXISTS macro_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      trace_json TEXT NOT NULL,
      device_id TEXT,
      created_at TEXT NOT NULL
    )`
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_macro_traces_domain ON macro_traces(domain, created_at)"
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS macro_registry (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      macro_json TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_macro_registry_domain_status ON macro_registry(domain, status)"
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS macro_mining_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      traces_used INTEGER NOT NULL DEFAULT 0,
      macros_found INTEGER NOT NULL DEFAULT 0
    )`
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_macro_mining_runs_domain ON macro_mining_runs(domain, started_at)"
  );

  schemaReady = true;
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

export async function insertTrace(
  domain: string,
  traceJson: string,
  deviceId?: string | null,
): Promise<void> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();

  await client.execute({
    sql: `INSERT INTO macro_traces (domain, trace_json, device_id, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [domain, traceJson, deviceId ?? null, now],
  });

  await client.execute({
    sql: `DELETE FROM macro_traces
          WHERE domain = ? AND id NOT IN (
            SELECT id FROM macro_traces
            WHERE domain = ?
            ORDER BY created_at DESC
            LIMIT ?
          )`,
    args: [domain, domain, MAX_TRACES_PER_DOMAIN],
  });
}

export async function getTracesForDomain(
  domain: string,
  limit = MAX_TRACES_PER_DOMAIN,
): Promise<MacroTraceRecord[]> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM macro_traces
          WHERE domain = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [domain, limit],
  });
  return (result.rows ?? []) as unknown as MacroTraceRecord[];
}

export async function getTraceCountSinceLastMine(domain: string): Promise<number> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();

  const runResult = await client.execute({
    sql: `SELECT completed_at FROM macro_mining_runs
          WHERE domain = ? AND completed_at IS NOT NULL
          ORDER BY completed_at DESC
          LIMIT 1`,
    args: [domain],
  });
  const lastRun = runResult.rows?.[0] as unknown as { completed_at: string } | undefined;
  const since = lastRun?.completed_at ?? "1970-01-01T00:00:00Z";

  const countResult = await client.execute({
    sql: `SELECT COUNT(*) AS cnt FROM macro_traces
          WHERE domain = ? AND created_at > ?`,
    args: [domain, since],
  });
  const row = countResult.rows?.[0] as unknown as { cnt: number | bigint } | undefined;
  return row?.cnt != null ? Number(row.cnt) : 0;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export async function upsertMinedMacros(
  domain: string,
  macros: Array<{ id: string; macroJson: string; confidence: number }>,
): Promise<void> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();

  for (const m of macros) {
    await client.execute({
      sql: `INSERT INTO macro_registry (id, domain, macro_json, confidence, success_count, failure_count, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, 0, 'active', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              macro_json = excluded.macro_json,
              confidence = excluded.confidence,
              status = CASE WHEN macro_registry.status = 'deprecated' THEN 'active' ELSE macro_registry.status END,
              updated_at = excluded.updated_at`,
      args: [m.id, domain, m.macroJson, m.confidence, now, now],
    });
  }

  if (macros.length > 0) {
    const ids = macros.map((m) => m.id);
    const placeholders = ids.map(() => "?").join(", ");
    await client.execute({
      sql: `UPDATE macro_registry
            SET status = 'deprecated', updated_at = ?
            WHERE domain = ? AND status = 'active' AND id NOT IN (${placeholders})`,
      args: [now, domain, ...ids],
    });
  }
}

export async function getActiveMacrosForDomain(
  domain: string,
): Promise<MacroRegistryRecord[]> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM macro_registry
          WHERE domain = ? AND status = 'active'
          ORDER BY confidence DESC`,
    args: [domain],
  });
  return (result.rows ?? []) as unknown as MacroRegistryRecord[];
}

export async function recordMacroOutcome(
  macroId: string,
  success: boolean,
): Promise<void> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const col = success ? "success_count" : "failure_count";
  await client.execute({
    sql: `UPDATE macro_registry
          SET ${col} = ${col} + 1, updated_at = ?
          WHERE id = ?`,
    args: [now, macroId],
  });
}

export async function deprecateUnderperformingMacros(): Promise<number> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const result = await client.execute({
    sql: `UPDATE macro_registry
          SET status = 'deprecated', updated_at = ?
          WHERE status = 'active'
            AND (success_count + failure_count) >= ?
            AND CAST(success_count AS REAL) / (success_count + failure_count) < ?`,
    args: [now, DEPRECATION_MIN_EXECUTIONS, DEPRECATION_THRESHOLD],
  });
  return result.rowsAffected ?? 0;
}

// ---------------------------------------------------------------------------
// Mining runs
// ---------------------------------------------------------------------------

export async function startMiningRun(domain: string): Promise<number> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const result = await client.execute({
    sql: `INSERT INTO macro_mining_runs (domain, started_at, traces_used, macros_found)
          VALUES (?, ?, 0, 0)`,
    args: [domain, now],
  });
  const rawId = (result as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  return rawId != null ? Number(rawId) : 0;
}

export async function completeMiningRun(
  runId: number,
  tracesUsed: number,
  macrosFound: number,
): Promise<void> {
  await ensureMacroMiningSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE macro_mining_runs
          SET completed_at = ?, traces_used = ?, macros_found = ?
          WHERE id = ?`,
    args: [now, tracesUsed, macrosFound, runId],
  });
}
