import { ensureSchema } from "@/lib/db";
import { getTursoClient } from "@/lib/turso";
import type { ComputerUseTaskRecord } from "@/lib/computeruse-store";

export type ComputerUseRunStatus =
  | "queued"
  | "waiting_for_device"
  | "running"
  | "completed"
  | "failed";

export type ComputerUseRunRecord = {
  id: string;
  agent_username: string;
  device_id: string;
  task_prompt: string;
  status: ComputerUseRunStatus;
  current_task_id: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type ComputerUseRunEvent = {
  id: string;
  run_id: string;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
};

let schemaReady = false;

function makeId(prefix: "run" | "runevt") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureComputerUseRunSchema() {
  if (schemaReady) return;
  await ensureSchema();
  const client = getTursoClient();
  await client.execute(
    `CREATE TABLE IF NOT EXISTS computeruse_runs (
      id TEXT PRIMARY KEY,
      agent_username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      task_prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      current_task_id TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_cu_runs_agent_username ON computeruse_runs(agent_username)"
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_cu_runs_status ON computeruse_runs(status)"
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS computeruse_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_cu_run_events_run_id ON computeruse_run_events(run_id)"
  );
  schemaReady = true;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && value) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function mapRunRow(row: Record<string, unknown>): ComputerUseRunRecord {
  return {
    id: String(row.id),
    agent_username: String(row.agent_username),
    device_id: String(row.device_id),
    task_prompt: String(row.task_prompt),
    status: String(row.status) as ComputerUseRunStatus,
    current_task_id: row.current_task_id ? String(row.current_task_id) : null,
    result: parseJsonObject(row.result_json),
    error: row.error ? String(row.error) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapRunEventRow(row: Record<string, unknown>): ComputerUseRunEvent {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    type: String(row.type),
    created_at: String(row.created_at),
    data: parseJsonObject(row.data_json) ?? {},
  };
}

export async function createComputerUseRun(params: {
  agentUsername: string;
  deviceId: string;
  taskPrompt: string;
}) {
  await ensureComputerUseRunSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const run: ComputerUseRunRecord = {
    id: makeId("run"),
    agent_username: params.agentUsername.trim().toLowerCase(),
    device_id: params.deviceId.trim(),
    task_prompt: params.taskPrompt.trim(),
    status: "queued",
    current_task_id: null,
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  await client.execute({
    sql: `INSERT INTO computeruse_runs
      (id, agent_username, device_id, task_prompt, status, current_task_id, result_json, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id,
      run.agent_username,
      run.device_id,
      run.task_prompt,
      run.status,
      null,
      null,
      null,
      run.created_at,
      run.updated_at,
    ],
  });
  return run;
}

export async function getComputerUseRunById(runId: string) {
  await ensureComputerUseRunSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM computeruse_runs WHERE id = ? LIMIT 1",
    args: [runId.trim()],
  });
  const row = result.rows?.[0] as unknown as Record<string, unknown> | undefined;
  return row ? mapRunRow(row) : null;
}

export async function appendComputerUseRunEvent(params: {
  runId: string;
  type: string;
  data?: Record<string, unknown>;
}) {
  await ensureComputerUseRunSchema();
  const run = await getComputerUseRunById(params.runId);
  if (!run) return null;
  const client = getTursoClient();
  const event: ComputerUseRunEvent = {
    id: makeId("runevt"),
    run_id: run.id,
    type: params.type.trim(),
    created_at: new Date().toISOString(),
    data: params.data ?? {},
  };
  await client.execute({
    sql: `INSERT INTO computeruse_run_events (id, run_id, type, data_json, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [event.id, event.run_id, event.type, JSON.stringify(event.data), event.created_at],
  });
  return event;
}

export async function listComputerUseRunEvents(params: {
  runId: string;
  limit?: number;
}) {
  await ensureComputerUseRunSchema();
  const client = getTursoClient();
  const limit = Math.max(1, Math.min(params.limit ?? 100, 1000));
  const result = await client.execute({
    sql: `SELECT * FROM computeruse_run_events
          WHERE run_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [params.runId.trim(), limit],
  });
  const rows = (result.rows ?? []) as unknown as Record<string, unknown>[];
  return rows.map(mapRunEventRow);
}

async function updateRun(params: {
  runId: string;
  status?: ComputerUseRunStatus;
  currentTaskId?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}) {
  await ensureComputerUseRunSchema();
  const existing = await getComputerUseRunById(params.runId);
  if (!existing) return null;
  const client = getTursoClient();
  const now = new Date().toISOString();
  const next = {
    ...existing,
    status: params.status ?? existing.status,
    current_task_id:
      typeof params.currentTaskId === "undefined"
        ? existing.current_task_id
        : params.currentTaskId,
    result:
      typeof params.result === "undefined" ? existing.result : params.result,
    error:
      typeof params.error === "undefined" ? existing.error : params.error,
    updated_at: now,
  };
  await client.execute({
    sql: `UPDATE computeruse_runs
          SET status = ?, current_task_id = ?, result_json = ?, error = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      next.status,
      next.current_task_id,
      next.result ? JSON.stringify(next.result) : null,
      next.error,
      next.updated_at,
      next.id,
    ],
  });
  return next;
}

export async function markComputerUseRunWaitingForTask(params: {
  runId: string;
  taskId: string;
}) {
  return updateRun({
    runId: params.runId,
    status: "waiting_for_device",
    currentTaskId: params.taskId.trim(),
  });
}

export async function markComputerUseRunRunning(params: {
  runId: string;
  taskId: string;
}) {
  return updateRun({
    runId: params.runId,
    status: "running",
    currentTaskId: params.taskId.trim(),
  });
}

export async function markComputerUseRunFromTaskResult(task: ComputerUseTaskRecord) {
  const runId = task.runId?.trim();
  if (!runId) return null;
  return updateRun({
    runId,
    status: task.status === "failed" ? "failed" : "completed",
    currentTaskId: task.id,
    result: task.result ?? null,
    error: task.error ?? null,
  });
}

export async function markComputerUseRunFinalState(params: {
  runId: string;
  taskId?: string | null;
  status: ComputerUseRunStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
}) {
  return updateRun({
    runId: params.runId,
    status: params.status,
    currentTaskId:
      typeof params.taskId === "undefined" ? undefined : (params.taskId ?? null),
    result: typeof params.result === "undefined" ? undefined : (params.result ?? null),
    error: typeof params.error === "undefined" ? undefined : (params.error ?? null),
  });
}

export async function clearComputerUseRunsForTests() {
  await ensureComputerUseRunSchema();
  const client = getTursoClient();
  await client.execute("DELETE FROM computeruse_run_events");
  await client.execute("DELETE FROM computeruse_runs");
}
