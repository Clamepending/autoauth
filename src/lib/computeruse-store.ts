import { ensureSchema } from "@/lib/db";
import { ensureComputerUseRegistrationSchema } from "@/lib/computeruse-registrations";
import { getTursoClient } from "@/lib/turso";

export type ComputerUseDeviceRecord = {
  device_id: string;
  auth_token: string;
  browser_token: string | null;
  human_user_id: number | null;
  label: string | null;
  marketplace_enabled: boolean;
  last_seen_at: string | null;
  paired_at: string;
  updated_at: string;
};

export type ComputerUseTaskStatus = "queued" | "delivered" | "completed" | "failed";
export type ComputerUseTaskType = "open_url" | "start_local_agent_goal";

export type ComputerUseTaskRecord = {
  id: string;
  deviceId: string;
  type: ComputerUseTaskType;
  url: string | null;
  goal: string | null;
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

export type FulfillmentAgentRecord = {
  device_id: string;
  browser_token_present: boolean;
  paired_at: string;
  device_updated_at: string;
  agent_username_lower: string | null;
  agent_username_display: string | null;
  registration_updated_at: string | null;
};

let cuTransportSchemaReady = false;

export async function ensureComputerUseTransportSchema() {
  if (cuTransportSchemaReady) return;
  await ensureSchema();
  const client = getTursoClient();

  await client.execute(
    `CREATE TABLE IF NOT EXISTS computeruse_devices (
      device_id TEXT PRIMARY KEY,
      auth_token TEXT NOT NULL,
      browser_token TEXT,
      human_user_id INTEGER,
      label TEXT,
      marketplace_enabled INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      paired_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  const deviceTableInfo = await client.execute({
    sql: "PRAGMA table_info(computeruse_devices)",
    args: [],
  });
  const deviceColumns = (deviceTableInfo.rows ?? []) as unknown as { name: string }[];
  if (!deviceColumns.some((c) => c.name === "human_user_id")) {
    await client.execute("ALTER TABLE computeruse_devices ADD COLUMN human_user_id INTEGER");
  }
  if (!deviceColumns.some((c) => c.name === "label")) {
    await client.execute("ALTER TABLE computeruse_devices ADD COLUMN label TEXT");
  }
  if (!deviceColumns.some((c) => c.name === "marketplace_enabled")) {
    await client.execute(
      "ALTER TABLE computeruse_devices ADD COLUMN marketplace_enabled INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!deviceColumns.some((c) => c.name === "last_seen_at")) {
    await client.execute("ALTER TABLE computeruse_devices ADD COLUMN last_seen_at TEXT");
  }
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_cu_devices_browser_token ON computeruse_devices(browser_token)"
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_cu_devices_human_user_id ON computeruse_devices(human_user_id)"
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_cu_devices_marketplace ON computeruse_devices(marketplace_enabled, last_seen_at)"
  );

  await client.execute(
    `CREATE TABLE IF NOT EXISTS computeruse_tasks (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT,
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
  const type = String(row.type || "open_url") as ComputerUseTaskType;
  const taskPrompt = row.task_prompt ? String(row.task_prompt) : null;
  return {
    id: String(row.id),
    deviceId: String(row.device_id),
    type,
    url: row.url == null || String(row.url) === "" ? null : String(row.url),
    goal: type === "start_local_agent_goal" ? taskPrompt : null,
    createdAt: String(row.created_at),
    status: String(row.status) as ComputerUseTaskStatus,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    result: parseJsonObject(row.result_json),
    error: row.error ? String(row.error) : null,
    source: (String(row.source) as ComputerUseTaskRecord["source"]) ?? "direct_mock_queue",
    agentUsername: row.agent_username ? String(row.agent_username) : null,
    taskPrompt,
    runId: row.run_id ? String(row.run_id) : null,
    updatedAt: String(row.updated_at),
  };
}

function mapDeviceRow(row: Record<string, unknown>): ComputerUseDeviceRecord {
  return {
    device_id: String(row.device_id),
    auth_token: String(row.auth_token),
    browser_token: row.browser_token ? String(row.browser_token) : null,
    human_user_id:
      row.human_user_id == null || row.human_user_id === ""
        ? null
        : Number(row.human_user_id),
    label: row.label == null ? null : String(row.label),
    marketplace_enabled: Boolean(Number(row.marketplace_enabled ?? 0)),
    last_seen_at: row.last_seen_at == null ? null : String(row.last_seen_at),
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
    sql: `INSERT INTO computeruse_devices (device_id, auth_token, browser_token, human_user_id, label, paired_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            auth_token = excluded.auth_token,
            updated_at = excluded.updated_at`,
    args: [
      normalized,
      authToken,
      existing?.browser_token ?? null,
      existing?.human_user_id ?? null,
      existing?.label ?? null,
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

export async function listFulfillmentAgentsForAdmin(): Promise<FulfillmentAgentRecord[]> {
  await ensureComputerUseTransportSchema();
  await ensureComputerUseRegistrationSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT
            d.device_id,
            d.browser_token,
            d.paired_at,
            d.updated_at AS device_updated_at,
            r.agent_username_lower,
            a.username_display AS agent_username_display,
            r.updated_at AS registration_updated_at
          FROM computeruse_devices d
          LEFT JOIN computeruse_agent_device_registrations r
            ON r.device_id = d.device_id
          LEFT JOIN agents a
            ON a.username_lower = r.agent_username_lower
          ORDER BY COALESCE(r.updated_at, d.updated_at) DESC, d.device_id ASC`,
    args: [],
  });

  return ((result.rows ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    device_id: String(row.device_id),
    browser_token_present: Boolean(row.browser_token),
    paired_at: String(row.paired_at),
    device_updated_at: String(row.device_updated_at),
    agent_username_lower:
      row.agent_username_lower == null ? null : String(row.agent_username_lower),
    agent_username_display:
      row.agent_username_display == null ? null : String(row.agent_username_display),
    registration_updated_at:
      row.registration_updated_at == null ? null : String(row.registration_updated_at),
  }));
}

export async function claimComputerUseDeviceForHuman(params: {
  deviceId: string;
  humanUserId: number;
  label?: string | null;
}) {
  await ensureComputerUseTransportSchema();
  const existing = await getComputerUseDeviceById(params.deviceId);
  const client = getTursoClient();
  const now = new Date().toISOString();
  const enabledValue =
    existing && existing.human_user_id != null
      ? (existing.marketplace_enabled ? 1 : 0)
      : 1;
  await client.execute({
    sql: `UPDATE computeruse_devices
          SET human_user_id = ?, label = COALESCE(?, label), marketplace_enabled = ?, updated_at = ?
          WHERE device_id = ?`,
    args: [
      params.humanUserId,
      params.label?.trim() || null,
      enabledValue,
      now,
      params.deviceId.trim(),
    ],
  });
  return getComputerUseDeviceById(params.deviceId);
}

export async function listComputerUseDevicesForHuman(humanUserId: number) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM computeruse_devices
          WHERE human_user_id = ?
          ORDER BY updated_at DESC, device_id ASC`,
    args: [humanUserId],
  });
  return ((result.rows ?? []) as unknown as Record<string, unknown>[]).map(mapDeviceRow);
}

export async function getDefaultComputerUseDeviceForHuman(humanUserId: number) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM computeruse_devices
          WHERE human_user_id = ?
            AND marketplace_enabled = 1
          ORDER BY updated_at DESC, paired_at DESC
          LIMIT 1`,
    args: [humanUserId],
  });
  const row = result.rows?.[0] as unknown as Record<string, unknown> | undefined;
  return row ? mapDeviceRow(row) : null;
}

export async function touchComputerUseDeviceSeen(deviceId: string) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE computeruse_devices
          SET last_seen_at = ?, updated_at = ?
          WHERE device_id = ?`,
    args: [now, now, deviceId.trim()],
  });
  return getComputerUseDeviceById(deviceId);
}

export async function setComputerUseDeviceMarketplaceEnabled(params: {
  deviceId: string;
  humanUserId: number;
  enabled: boolean;
}) {
  await ensureComputerUseTransportSchema();
  const device = await getComputerUseDeviceById(params.deviceId);
  if (!device) {
    throw new Error("Device not found.");
  }
  if (device.human_user_id !== params.humanUserId) {
    throw new Error("You do not own this device.");
  }
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE computeruse_devices
          SET marketplace_enabled = ?, updated_at = ?
          WHERE device_id = ?`,
    args: [params.enabled ? 1 : 0, now, params.deviceId.trim()],
  });
  return getComputerUseDeviceById(params.deviceId);
}

export async function removeComputerUseDeviceForHuman(params: {
  deviceId: string;
  humanUserId: number;
}) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const device = await getComputerUseDeviceById(params.deviceId);
  if (!device) {
    throw new Error("Device not found.");
  }
  if (device.human_user_id !== params.humanUserId) {
    throw new Error("You do not own this device.");
  }

  const activeTaskCountResult = await client.execute({
    sql: `SELECT COUNT(*) AS count
          FROM computeruse_tasks
          WHERE device_id = ?
            AND status IN ('queued', 'delivered')`,
    args: [params.deviceId.trim()],
  });
  const activeTaskCountRow = activeTaskCountResult.rows?.[0] as
    | { count?: number | bigint | string }
    | undefined;
  const activeTaskCount =
    activeTaskCountRow?.count != null ? Number(activeTaskCountRow.count) : 0;
  if (activeTaskCount > 0) {
    throw new Error("This device still has an active OttoAuth task. Wait for it to finish before removing it.");
  }

  await client.execute({
    sql: "DELETE FROM computeruse_devices WHERE device_id = ?",
    args: [params.deviceId.trim()],
  });

  return device;
}

export async function listMarketplaceComputerUseDevices(params?: {
  excludeHumanUserId?: number | null;
  onlySeenSinceMinutes?: number;
  limit?: number;
}) {
  await ensureComputerUseTransportSchema();
  const client = getTursoClient();
  const limit = Math.max(1, Math.min(params?.limit ?? 50, 200));
  const onlySeenSinceMinutes = Math.max(1, Math.min(params?.onlySeenSinceMinutes ?? 10, 1440));
  const cutoff = new Date(Date.now() - onlySeenSinceMinutes * 60 * 1000).toISOString();
  const excludeHumanUserId = params?.excludeHumanUserId ?? null;
  const result = await client.execute({
    sql: `SELECT * FROM computeruse_devices
          WHERE human_user_id IS NOT NULL
            AND marketplace_enabled = 1
            AND last_seen_at IS NOT NULL
            AND last_seen_at >= ?
            AND (? IS NULL OR human_user_id != ?)
          ORDER BY last_seen_at DESC, updated_at DESC, paired_at DESC
          LIMIT ?`,
    args: [cutoff, excludeHumanUserId, excludeHumanUserId, limit],
  });
  return ((result.rows ?? []) as unknown as Record<string, unknown>[]).map(mapDeviceRow);
}

export async function selectComputerUseDeviceForHumanTask(params: {
  requesterHumanUserId: number;
  fulfillmentMode?: "auto" | "own_device" | "marketplace";
}) {
  const mode = params.fulfillmentMode ?? "auto";
  const ownDevice =
    mode === "marketplace"
      ? null
      : await getDefaultComputerUseDeviceForHuman(params.requesterHumanUserId);

  const ownDeviceSeenRecently =
    ownDevice?.last_seen_at != null &&
    Date.now() - new Date(ownDevice.last_seen_at).getTime() <= 10 * 60 * 1000;

  if (ownDevice && mode === "own_device") {
    return {
      selection: "own_device" as const,
      device: ownDevice,
    };
  }

  if (ownDevice && ownDeviceSeenRecently) {
    return {
      selection: "own_device" as const,
      device: ownDevice,
    };
  }

  if (mode === "own_device") {
    return null;
  }

  const marketplaceDevices = await listMarketplaceComputerUseDevices({
    excludeHumanUserId: params.requesterHumanUserId,
    onlySeenSinceMinutes: 10,
    limit: 1,
  });
  const marketplaceDevice = marketplaceDevices[0] ?? null;
  if (!marketplaceDevice) return null;
  return {
    selection: "marketplace" as const,
    device: marketplaceDevice,
  };
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
    goal: null,
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

export async function enqueueComputerUseLocalAgentGoalTask(params: {
  goal: string;
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
  const goal = params.goal.trim();
  const task: ComputerUseTaskRecord = {
    id,
    deviceId: params.deviceId.trim() || "local-device-1",
    type: "start_local_agent_goal",
    url: null,
    goal,
    createdAt: now,
    status: "queued",
    deliveredAt: null,
    completedAt: null,
    result: null,
    error: null,
    source: params.source ?? "computeruse_tasks",
    agentUsername: params.agentUsername?.trim().toLowerCase() || null,
    taskPrompt: params.taskPrompt?.trim() || goal,
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
      "", // existing schema rows historically require a url; empty string keeps compatibility
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
  // Keep wait-task requests short-lived so idle fulfillers do not pin a Fluid
  // function open. Clients are responsible for backing off between checks.
  const claimed = await claimNextComputerUseTaskForDevice(params.deviceId);
  if (!claimed) {
    return null;
  }
  return {
    ...claimed,
    waitedMs: 0,
  };
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
