import { ensureSchema } from "@/lib/db";
import { getTursoClient } from "@/lib/turso";

export type ComputerUseDeviceRecord = {
  device_id: string;
  auth_token: string;
  browser_token: string | null;
  paired_at: string;
  updated_at: string;
};

export type ComputerUseTaskStatus = "queued" | "delivered" | "completed" | "failed";

export type ComputerUseTaskRecord = {
  id: string;
  deviceId: string;
  type: "open_url";
  url: string;
  createdAt: string;
  status: ComputerUseTaskStatus;
  deliveredAt: string | null;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  source: "mock_send" | "computeruse_tasks" | "direct_mock_queue";
  agentUsername: string | null;
  taskPrompt: string | null;
  runId: string | null;
  updatedAt: string;
};

let cuTransportSchemaReady = false;

async function ensureComputerUseTransportSchema() {
  if (cuTransportSchemaReady) return;
  await ensureSchema();
  const client = getTursoClient();

  await client.execute(
    `CREATE TABLE IF NOT EXISTS computeruse_devices (
      device_id TEXT PRIMARY KEY,
      auth_token TEXT NOT NULL,
      browser_token TEXT,
      paired_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_cu_devices_browser_token ON computeruse_devices(browser_token)"
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS computeruse_tasks (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      agent_username TEXT,
      task_prompt TEXT,
      run_id TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )`
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_cu_tasks_device_status_created ON computeruse_tasks(device_id, status, created_at)"
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_cu_tasks_run_id ON computeruse_tasks(run_id)"
  );

  cuTransportSchemaReady = true;
}

function randomToken(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
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

function mapTaskRow(row: Record<string, unknown>): ComputerUseTaskRecord {
  return {
    id: String(row.id),
    deviceId: String(row.device_id),
    type: "open_url",
    url: String(row.url),
    createdAt: String(row.created_at),
    status: String(row.status) as ComputerUseTaskStatus,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    result: parseJsonObject(row.result_json),
    error: row.error ? String(row.error) : null,
    source: (String(row.source) as ComputerUseTaskRecord["source"]) ?? "direct_mock_queue",
    agentUsername: row.agent_username ? String(row.agent_username) : null,
    taskPrompt: row.task_prompt ? String(row.task_prompt) : null,
    runId: row.run_id ? String(row.run_id) : null,
    updatedAt: String(row.updated_at),
  };
}

function mapDeviceRow(row: Record<string, unknown>): ComputerUseDeviceRecord {
  return {
    device_id: String(row.device_id),
    auth_token: String(row.auth_token),
    browser_token: row.browser_token ? String(row.browser_token) : null,
    paired_at: String(row.paired_at),
    updated_at: String(row.updated_at),
  };
}

export async function pairComputerUseDevice(deviceId: string) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const normalized = deviceId.trim() || "local-device-1";
  const existing = await getComputerUseDeviceById(normalized);
  const now = new Date().toISOString();
  const authToken = randomToken("mockdev");

  await client.execute({
    sql: `INSERT INTO computeruse_devices (device_id, auth_token, browser_token, paired_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            auth_token = excluded.auth_token,
            updated_at = excluded.updated_at`,
    args: [
      normalized,
      authToken,
      existing?.browser_token ?? null,
      existing?.paired_at ?? now,
      now,
    ],
  });

  const updated = await getComputerUseDeviceById(normalized);
  if (!updated) throw new Error("Failed to pair device");
  return updated;
}

export async function getComputerUseDeviceById(deviceId: string) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM computeruse_devices WHERE device_id = ? LIMIT 1",
    args: [deviceId.trim()],
  });
  const row = result.rows?.[0] as unknown as Record<string, unknown> | undefined;
  return row ? mapDeviceRow(row) : null;
}

export async function getComputerUseDeviceByBrowserToken(browserToken: string) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM computeruse_devices WHERE browser_token = ? LIMIT 1",
    args: [browserToken.trim()],
  });
  const row = result.rows?.[0] as unknown as Record<string, unknown> | undefined;
  return row ? mapDeviceRow(row) : null;
}

export async function setComputerUseDeviceBrowserToken(params: {
  deviceId: string;
  browserToken: string;
}) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE computeruse_devices
          SET browser_token = ?, updated_at = ?
          WHERE device_id = ?`,
    args: [params.browserToken.trim(), now, params.deviceId.trim()],
  });
  return getComputerUseDeviceById(params.deviceId);
}

export async function verifyComputerUseDeviceToken(params: {
  deviceId: string;
  authHeader?: string | null;
}) {
  const device = await getComputerUseDeviceById(params.deviceId);
  if (!device) return { ok: false as const, reason: "unpaired" };

  const raw = (params.authHeader ?? "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) {
    return { ok: false as const, reason: "missing_token" };
  }
  const token = raw.slice(7).trim();
  if (!token || token !== device.auth_token) {
    return { ok: false as const, reason: "invalid_token" };
  }
  return { ok: true as const, device };
}

export async function enqueueComputerUseOpenUrlTask(params: {
  url: string;
  deviceId: string;
  id?: string;
  source?: ComputerUseTaskRecord["source"];
  agentUsername?: string | null;
  taskPrompt?: string | null;
  runId?: string | null;
}) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const id = params.id?.trim() || `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const task: ComputerUseTaskRecord = {
    id,
    deviceId: params.deviceId.trim() || "local-device-1",
    type: "open_url",
    url: params.url,
    createdAt: now,
    status: "queued",
    deliveredAt: null,
    completedAt: null,
    result: null,
    error: null,
    source: params.source ?? "direct_mock_queue",
    agentUsername: params.agentUsername?.trim().toLowerCase() || null,
    taskPrompt: params.taskPrompt?.trim() || null,
    runId: params.runId?.trim() || null,
    updatedAt: now,
  };

  await client.execute({
    sql: `INSERT INTO computeruse_tasks
      (id, device_id, type, url, status, source, agent_username, task_prompt, run_id, result_json, error, created_at, delivered_at, completed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      task.id,
      task.deviceId,
      task.type,
      task.url,
      task.status,
      task.source,
      task.agentUsername,
      task.taskPrompt,
      task.runId,
      null,
      null,
      task.createdAt,
      null,
      null,
      task.updatedAt,
    ],
  });

  const queueSize = await getQueuedComputerUseTaskCount();
  return { task, queueSize };
}

export async function getQueuedComputerUseTaskCount() {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT COUNT(*) AS count FROM computeruse_tasks WHERE status = 'queued'",
    args: [],
  });
  const row = result.rows?.[0] as unknown as { count?: number | bigint | string } | undefined;
  return row?.count != null ? Number(row.count) : 0;
}

export async function claimNextComputerUseTaskForDevice(deviceId: string) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const update = await client.execute({
    sql: `UPDATE computeruse_tasks
          SET status = 'delivered', delivered_at = ?, updated_at = ?
          WHERE id = (
            SELECT id
            FROM computeruse_tasks
            WHERE status = 'queued'
              AND (device_id = ? OR device_id = '*')
            ORDER BY created_at ASC
            LIMIT 1
          )
          RETURNING *`,
    args: [now, now, deviceId.trim()],
  });
  const row = update.rows?.[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return null;
  const task = mapTaskRow(row);
  const queueSize = await getQueuedComputerUseTaskCount();
  return { task, queueSize };
}

export async function waitForComputerUseTaskForDevice(params: {
  deviceId: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const timeoutMs = Math.max(100, Math.min(params.timeoutMs ?? 25000, 30000));
  const intervalMs = Math.max(100, Math.min(params.intervalMs ?? 500, 2000));
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const claimed = await claimNextComputerUseTaskForDevice(params.deviceId);
    if (claimed) {
      return {
        ...claimed,
        waitedMs: Date.now() - started,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export async function getComputerUseTaskById(taskId: string) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM computeruse_tasks WHERE id = ? LIMIT 1",
    args: [taskId.trim()],
  });
  const row = result.rows?.[0] as unknown as Record<string, unknown> | undefined;
  return row ? mapTaskRow(row) : null;
}

export async function updateComputerUseTaskResult(params: {
  taskId: string;
  status: "completed" | "failed";
  result?: Record<string, unknown> | null;
  error?: string | null;
}) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const existing = await getComputerUseTaskById(params.taskId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const nextError =
    params.status === "failed"
      ? params.error?.trim() || existing.error || "Task failed"
      : params.error?.trim() || null;
  await client.execute({
    sql: `UPDATE computeruse_tasks
          SET status = ?, completed_at = ?, result_json = ?, error = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      params.status,
      now,
      params.result ? JSON.stringify(params.result) : null,
      nextError,
      now,
      params.taskId.trim(),
    ],
  });
  return getComputerUseTaskById(params.taskId);
}
