export type MockOpenUrlTask = {
  id: string;
  deviceId: string;
  type: "open_url";
  url: string;
  createdAt: string;
};

export type MockTaskStatus = "queued" | "delivered" | "completed" | "failed";

export type MockComputerUseTaskRecord = MockOpenUrlTask & {
  status: MockTaskStatus;
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

type MockQueueStore = {
  queue: string[];
  taskRecords: Record<string, MockComputerUseTaskRecord>;
  devices: Record<
    string,
    {
      deviceId: string;
      token: string;
      agentPairToken: string | null;
      agentPairTokenUpdatedAt: string | null;
      registeredAgentUsername: string | null;
      registeredAt: string | null;
      pairedAt: string;
      updatedAt: string;
    }
  >;
};

declare global {
  // eslint-disable-next-line no-var
  var __ottoauthMockComputerUseQueue: MockQueueStore | undefined;
}

function getStore(): MockQueueStore {
  if (!global.__ottoauthMockComputerUseQueue) {
    global.__ottoauthMockComputerUseQueue = {
      queue: [],
      taskRecords: {},
      devices: {},
    };
  }
  return global.__ottoauthMockComputerUseQueue;
}

export function parseHttpUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

export function normalizeMockDeviceId(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

export function makeMockTaskId() {
  return `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueueMockOpenUrlTask(params: {
  url: string;
  deviceId: string;
  id?: string;
  source?: MockComputerUseTaskRecord["source"];
  agentUsername?: string | null;
  taskPrompt?: string | null;
  runId?: string | null;
}) {
  const now = new Date().toISOString();
  const task: MockComputerUseTaskRecord = {
    id: params.id?.trim() || makeMockTaskId(),
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

  const store = getStore();
  store.taskRecords[task.id] = task;
  store.queue.push(task.id);
  return { task, queueSize: store.queue.length };
}

export function dequeueMockTaskForDevice(deviceId: string) {
  const store = getStore();
  const idx = store.queue.findIndex((taskId) => {
    const task = store.taskRecords[taskId];
    return task && (task.deviceId === deviceId || task.deviceId === "*");
  });
  if (idx < 0) return null;

  const [taskId] = store.queue.splice(idx, 1);
  const task = store.taskRecords[taskId];
  if (!task) return null;

  const now = new Date().toISOString();
  task.status = "delivered";
  task.deliveredAt = now;
  task.updatedAt = now;

  return { task, queueSize: store.queue.length };
}

export function getMockQueueSize() {
  return getStore().queue.length;
}

export function takeMockTaskForDevice(deviceId: string) {
  return dequeueMockTaskForDevice(deviceId);
}

export async function waitForMockTaskForDevice(params: {
  deviceId: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const timeoutMs = Math.max(100, Math.min(params.timeoutMs ?? 25000, 30000));
  const intervalMs = Math.max(100, Math.min(params.intervalMs ?? 500, 2000));
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const dequeued = dequeueMockTaskForDevice(params.deviceId);
    if (dequeued) {
      return {
        ...dequeued,
        waitedMs: Date.now() - started,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

export function getMockTaskById(taskId: string) {
  const id = taskId.trim();
  if (!id) return null;
  return getStore().taskRecords[id] ?? null;
}

export function updateMockTaskResult(params: {
  taskId: string;
  status: "completed" | "failed";
  result?: Record<string, unknown> | null;
  error?: string | null;
}) {
  const task = getMockTaskById(params.taskId);
  if (!task) return null;

  const now = new Date().toISOString();
  task.status = params.status;
  task.completedAt = now;
  task.updatedAt = now;
  task.result = params.result ?? null;
  task.error = params.error?.trim() || null;
  if (params.status === "failed" && !task.error) {
    task.error = "Task failed";
  }
  return task;
}

export function listMockTasks(params?: {
  deviceId?: string;
  agentUsername?: string;
  limit?: number;
}) {
  const store = getStore();
  const limit = Math.max(1, Math.min(params?.limit ?? 50, 500));
  const deviceId = params?.deviceId?.trim();
  const agentUsername = params?.agentUsername?.trim().toLowerCase();

  const filtered = Object.values(store.taskRecords).filter((task) => {
    if (deviceId && task.deviceId !== deviceId) return false;
    if (agentUsername && task.agentUsername !== agentUsername) return false;
    return true;
  });

  return filtered
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function makeMockDeviceToken() {
  return `mockdev_${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function pairMockDevice(deviceId: string) {
  const normalized = deviceId.trim() || "local-device-1";
  const store = getStore();
  const now = new Date().toISOString();
  const token = makeMockDeviceToken();
  const existing = store.devices[normalized];
  store.devices[normalized] = {
    deviceId: normalized,
    token,
    agentPairToken: existing?.agentPairToken ?? null,
    agentPairTokenUpdatedAt: existing?.agentPairTokenUpdatedAt ?? null,
    registeredAgentUsername: existing?.registeredAgentUsername ?? null,
    registeredAt: existing?.registeredAt ?? null,
    pairedAt: existing?.pairedAt ?? now,
    updatedAt: now,
  };
  return store.devices[normalized];
}

export function getMockPairedDevice(deviceId: string) {
  return getStore().devices[deviceId] ?? null;
}

export function setMockDeviceAgentPairToken(params: {
  deviceId: string;
  agentPairToken: string;
}) {
  const device = getMockPairedDevice(params.deviceId);
  if (!device) return null;
  const token = params.agentPairToken.trim();
  if (!token) return null;
  const now = new Date().toISOString();
  device.agentPairToken = token;
  device.agentPairTokenUpdatedAt = now;
  device.updatedAt = now;
  return device;
}

export function getMockPairedDeviceByAgentPairToken(agentPairToken: string) {
  const token = agentPairToken.trim();
  if (!token) return null;
  const store = getStore();
  for (const device of Object.values(store.devices)) {
    if (device.agentPairToken === token) return device;
  }
  return null;
}

export function registerMockDeviceForAgent(params: {
  deviceId: string;
  agentUsername: string;
}) {
  const device = getMockPairedDevice(params.deviceId);
  if (!device) return null;
  const agentUsername = params.agentUsername.trim().toLowerCase();
  if (!agentUsername) return null;
  const now = new Date().toISOString();
  device.registeredAgentUsername = agentUsername;
  device.registeredAt = now;
  device.updatedAt = now;
  return device;
}

export function getMockRegisteredDeviceForAgent(agentUsername: string) {
  const username = agentUsername.trim().toLowerCase();
  if (!username) return null;
  const store = getStore();
  for (const device of Object.values(store.devices)) {
    if (device.registeredAgentUsername === username) return device;
  }
  return null;
}

export function verifyMockDeviceToken(params: {
  deviceId: string;
  authHeader?: string | null;
}) {
  const paired = getMockPairedDevice(params.deviceId);
  if (!paired) return { ok: false as const, reason: "unpaired" };

  const raw = (params.authHeader ?? "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) {
    return { ok: false as const, reason: "missing_token" };
  }

  const token = raw.slice(7).trim();
  if (!token || token !== paired.token) {
    return { ok: false as const, reason: "invalid_token" };
  }

  return { ok: true as const, paired };
}
