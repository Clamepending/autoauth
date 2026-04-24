import { useStore } from '../store';
import { runAgentLoop } from './loop';
import {
  anySessionRunning,
  ensureBackgroundSession,
  extractOttoAuthTaskCompletion,
} from './executionHelpers';
import {
  createTraceRecorder,
  ensureTraceRecordingReady,
  formatTraceRecordingFailureMessage,
} from './traceRecorder';
import { sendToBackground } from '../../shared/messaging';
import type { OttoAuthModelUsage, OttoAuthTask } from '../../shared/types';
import { resizeScreenshotForModel } from '../../shared/imageUtils';
import {
  clearOttoAuthHeadlessRuntimeState,
  writeOttoAuthHeadlessState,
} from '../../shared/ottoAuthHeadlessState';
import {
  STORAGE_KEY_OTTOAUTH_URL,
  STORAGE_KEY_OTTOAUTH_DEVICE_ID,
  STORAGE_KEY_OTTOAUTH_AUTH_TOKEN,
  OTTOAUTH_POLL_INTERVAL_MS,
  OTTOAUTH_TASK_HEARTBEAT_INTERVAL_MS,
  OTTOAUTH_TASK_TIMEOUT_MS,
} from '../../shared/constants';

type OttoAuthExecutionContext = 'sidepanel' | 'headless-worker';

let pollingActive = false;
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pollAbortController: AbortController | null = null;
const OTTOAUTH_LIVE_SNAPSHOT_INTERVAL_MS = 4000;
let executionContext: OttoAuthExecutionContext = 'sidepanel';

function isHeadlessWorkerContext() {
  return executionContext === 'headless-worker';
}

async function persistHeadlessRuntimeState(values: {
  runtimeActive?: boolean;
  pollingActive?: boolean;
  currentTask?: OttoAuthTask | null;
  lastError?: string | null;
  lastSeenAt?: number | null;
}): Promise<void> {
  if (!isHeadlessWorkerContext()) return;
  await writeOttoAuthHeadlessState(values).catch((error) => {
    console.error('[OttoAuth Headless] Failed to persist runtime state:', error);
  });
}

export function setOttoAuthExecutionContext(context: OttoAuthExecutionContext): void {
  executionContext = context;
}

export async function pairWithOttoAuth(serverUrl: string, deviceName: string, pairingCode: string): Promise<{
  ok: boolean;
  deviceId?: string;
  authToken?: string;
  error?: string;
}> {
  const url = serverUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${url}/api/computeruse/device/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceName || 'browser-agent-1',
        device_label: deviceName || 'browser-agent-1',
        pairing_code: pairingCode || '',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    const deviceId = data.device?.id || deviceName;
    const authToken = data.deviceToken;
    chrome.storage.local.set({
      [STORAGE_KEY_OTTOAUTH_URL]: url,
      [STORAGE_KEY_OTTOAUTH_DEVICE_ID]: deviceId,
      [STORAGE_KEY_OTTOAUTH_AUTH_TOKEN]: authToken,
    });
    useStore.getState().setOttoAuthConfig({ url, deviceId, token: authToken });
    useStore.getState().setOttoAuthConnected(true);
    return { ok: true, deviceId, authToken };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function loadOttoAuthConfig(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEY_OTTOAUTH_URL, STORAGE_KEY_OTTOAUTH_DEVICE_ID, STORAGE_KEY_OTTOAUTH_AUTH_TOKEN],
      (result) => {
        const url = result[STORAGE_KEY_OTTOAUTH_URL] as string | undefined;
        const deviceId = result[STORAGE_KEY_OTTOAUTH_DEVICE_ID] as string | undefined;
        const token = result[STORAGE_KEY_OTTOAUTH_AUTH_TOKEN] as string | undefined;
        if (url && deviceId && token) {
          useStore.getState().setOttoAuthConfig({ url, deviceId, token });
          useStore.getState().setOttoAuthConnected(true);
        }
        resolve();
      },
    );
  });
}

export function disconnectOttoAuth(): void {
  stopOttoAuthPolling();
  chrome.storage.local.remove([
    STORAGE_KEY_OTTOAUTH_URL,
    STORAGE_KEY_OTTOAUTH_DEVICE_ID,
    STORAGE_KEY_OTTOAUTH_AUTH_TOKEN,
  ]);
  useStore.getState().setOttoAuthConfig(null);
  useStore.getState().setOttoAuthConnected(false);
  useStore.getState().setOttoAuthCurrentTask(null);
}

export function startOttoAuthPolling(): void {
  if (pollingActive) return;
  const { ottoAuthUrl, ottoAuthToken, ottoAuthDeviceId } = useStore.getState();
  if (!ottoAuthUrl || !ottoAuthToken || !ottoAuthDeviceId) return;
  pollingActive = true;
  useStore.getState().setOttoAuthPolling(true);
  void persistHeadlessRuntimeState({
    runtimeActive: true,
    pollingActive: true,
    lastError: null,
    lastSeenAt: Date.now(),
  });
  pollForTask();
}

export function stopOttoAuthPolling(): void {
  pollingActive = false;
  useStore.getState().setOttoAuthPolling(false);
  if (pollAbortController) {
    pollAbortController.abort();
    pollAbortController = null;
  }
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
  void persistHeadlessRuntimeState({
    pollingActive: false,
    currentTask: null,
    lastSeenAt: Date.now(),
  });
}

async function pollForTask(): Promise<void> {
  if (!pollingActive) return;

  const { ottoAuthUrl, ottoAuthToken, ottoAuthDeviceId } = useStore.getState();
  if (!ottoAuthUrl || !ottoAuthToken || !ottoAuthDeviceId) {
    stopOttoAuthPolling();
    return;
  }

  if (anySessionRunning()) {
    schedulePoll();
    return;
  }

  let controller: AbortController | null = null;
  try {
    controller = new AbortController();
    pollAbortController = controller;
    const res = await fetch(`${ottoAuthUrl}/api/computeruse/device/wait-task`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ottoAuthToken}`,
        'X-OttoAuth-Mock-Device': ottoAuthDeviceId,
      },
      signal: controller.signal,
    });
    if (pollAbortController === controller) {
      pollAbortController = null;
    }

    if (!pollingActive) {
      return;
    }

    if (res.status === 204) {
      schedulePoll();
      return;
    }

    if (res.status === 401) {
      console.error('[OttoAuth] Auth failed — device token may be invalid');
      useStore.getState().setOttoAuthConnected(false);
      void persistHeadlessRuntimeState({
        pollingActive: false,
        currentTask: null,
        lastError: 'OttoAuth authentication failed for the claimed device.',
        lastSeenAt: Date.now(),
      });
      stopOttoAuthPolling();
      return;
    }

    if (!res.ok) {
      console.error(`[OttoAuth] wait-task error: ${res.status}`);
      schedulePoll();
      return;
    }

    const task: OttoAuthTask = await res.json();
    if (!pollingActive) {
      return;
    }
    await executeOttoAuthTask(task);
  } catch (e) {
    if (controller?.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
      if (pollAbortController === controller) {
        pollAbortController = null;
      }
      return;
    }
    if (pollAbortController === controller) {
      pollAbortController = null;
    }
    console.error('[OttoAuth] poll error:', e);
    void persistHeadlessRuntimeState({
      lastError: e instanceof Error ? e.message : String(e),
      lastSeenAt: Date.now(),
    });
  }

  schedulePoll();
}

function schedulePoll(): void {
  if (!pollingActive) return;
  pollTimeoutId = setTimeout(pollForTask, OTTOAUTH_POLL_INTERVAL_MS);
}

async function executeOttoAuthTask(task: OttoAuthTask): Promise<void> {
  const store = useStore.getState();
  if (anySessionRunning()) return;

  const recordingReady = await ensureTraceRecordingReady(false);
  if (!recordingReady.ok && recordingReady.required) {
    const error = formatTraceRecordingFailureMessage(recordingReady.error);
    await reportTaskResult(task.id, 'failed', null, error, []);
    stopOttoAuthPolling();
    useStore.getState().setError(error);
    useStore.getState().setOttoAuthCurrentTask(null);
    await persistHeadlessRuntimeState({
      pollingActive: false,
      currentTask: null,
      lastError: error,
      lastSeenAt: Date.now(),
    });
    return;
  }

  const sessionId = await ensureBackgroundSession('ottoauth');
  if (!sessionId) {
    const error = 'Failed to create session for task';
    await reportTaskResult(task.id, 'failed', null, error, []);
    await persistHeadlessRuntimeState({
      currentTask: null,
      lastError: error,
      lastSeenAt: Date.now(),
    });
    return;
  }

  store.setOttoAuthCurrentTask(task);
  store.clearMessages(sessionId);
  await persistHeadlessRuntimeState({
    currentTask: task,
    lastError: null,
    lastSeenAt: Date.now(),
  });

  const goal = task.goal || task.taskPrompt || task.url;
  if (!goal) {
    const error = 'No goal or URL provided in task';
    await reportTaskResult(task.id, 'failed', null, error, []);
    store.setOttoAuthCurrentTask(null);
    await persistHeadlessRuntimeState({
      currentTask: null,
      lastError: error,
      lastSeenAt: Date.now(),
    });
    return;
  }

  const recorder = await createTraceRecorder({
    task,
    goal,
    sessionId,
    serverUrl: store.ottoAuthUrl,
    deviceId: store.ottoAuthDeviceId,
  });
  const startPersist = await recorder?.persistStart();
  if (startPersist && !startPersist.ok) {
    const error = `Trace recording failed to initialize: ${startPersist.error || 'Unable to write the task trace.'}`;
    console.error('[TraceRecorder] Failed to persist task start:', startPersist.error);
    await reportTaskResult(task.id, 'failed', null, error, []);
    useStore.getState().setError(error);
    useStore.getState().setOttoAuthCurrentTask(null);
    await persistHeadlessRuntimeState({
      pollingActive: false,
      currentTask: null,
      lastError: error,
      lastSeenAt: Date.now(),
    });
    stopOttoAuthPolling();
    if (sessionId) {
      await sendToBackground({ type: 'session-close', sessionId }).catch(() => {});
    }
    return;
  }
  recorder?.note('session_initialized', { sessionId });

  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let snapshotIntervalId: ReturnType<typeof setInterval> | null = null;
  const modelUsages: OttoAuthModelUsage[] = [];

  try {
    heartbeatId = setInterval(() => {
      const messages = useStore.getState().getMessages(sessionId);
      recorder?.note('heartbeat', {
        taskId: task.id,
        sessionId,
        messageCount: messages.length,
        isRunning: useStore.getState().getIsRunning(sessionId),
      });
      if (recorder) {
        recorder.persistProgress({ messages }).catch((persistError) => {
          console.error('[TraceRecorder] Failed to persist running trace:', persistError);
        });
      }
    }, OTTOAUTH_TASK_HEARTBEAT_INTERVAL_MS);
    await pushTaskSnapshot(task, sessionId).catch((snapshotError) => {
      console.error('[OttoAuth] Failed to push initial task snapshot:', snapshotError);
    });
    snapshotIntervalId = setInterval(() => {
      pushTaskSnapshot(task, sessionId).catch((snapshotError) => {
        console.error('[OttoAuth] Failed to push running task snapshot:', snapshotError);
      });
    }, OTTOAUTH_LIVE_SNAPSHOT_INTERVAL_MS);

    const loopPromise = runAgentLoop(goal, sessionId, {
      taskChat: {
        fetchRequesterMessages: () => fetchTaskMessages(task.id),
        sendAgentMessage: (message) => sendTaskMessage(task.id, message),
      },
      onEvent: (event) => recorder?.note(event.type, event.payload),
      onModelUsage: (usage) => {
        modelUsages.push(usage);
        recorder?.note('model_usage', usage as Record<string, unknown>);
      },
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        useStore.getState().setIsRunning(false, sessionId);
        useStore.getState().setError(`OttoAuth task timed out after ${Math.round(OTTOAUTH_TASK_TIMEOUT_MS / 1000)}s`, sessionId);
        recorder?.note('task_timeout', {
          taskId: task.id,
          sessionId,
          timeoutMs: OTTOAUTH_TASK_TIMEOUT_MS,
        });
        reject(new Error(`OttoAuth task timed out after ${Math.round(OTTOAUTH_TASK_TIMEOUT_MS / 1000)}s`));
      }, OTTOAUTH_TASK_TIMEOUT_MS);
    });

    await Promise.race([loopPromise, timeoutPromise]);

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (heartbeatId) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
    if (snapshotIntervalId) {
      clearInterval(snapshotIntervalId);
      snapshotIntervalId = null;
    }

    const sessionError = useStore.getState().getError(sessionId);
    if (sessionError) {
      throw new Error(sessionError);
    }
    const completion = extractOttoAuthTaskCompletion(sessionId);
    await pushTaskSnapshot(task, sessionId).catch((snapshotError) => {
      console.error('[OttoAuth] Failed to push completion snapshot:', snapshotError);
    });
    recorder?.note(completion.status === 'completed' ? 'task_completed' : 'task_failed', {
      taskId: task.id,
      hasResult: Boolean(completion.result),
      error: completion.error,
      status: completion.status,
    });
    if (completion.status === 'failed' && completion.error) {
      useStore.getState().setError(completion.error, sessionId);
    }
    await reportTaskResult(task.id, completion.status, completion.result, completion.error, modelUsages);
    await persistHeadlessRuntimeState({
      currentTask: null,
      lastError: completion.status === 'failed' ? completion.error : null,
      lastSeenAt: Date.now(),
    });
    const persistResult = await recorder?.persist({
      status: completion.status,
      result: completion.result,
      error: completion.error,
      messages: useStore.getState().getMessages(sessionId),
    });
    if (persistResult && !persistResult.ok) {
      console.error('[TraceRecorder] Failed to persist completed trace:', persistResult.error);
    }
  } catch (e) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (heartbeatId) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
    if (snapshotIntervalId) {
      clearInterval(snapshotIntervalId);
      snapshotIntervalId = null;
    }
    const errMsg = e instanceof Error ? e.message : String(e);
    recorder?.note('task_failed', { taskId: task.id, error: errMsg });
    await pushTaskSnapshot(task, sessionId).catch((snapshotError) => {
      console.error('[OttoAuth] Failed to push failure snapshot:', snapshotError);
    });
    await reportTaskResult(task.id, 'failed', null, errMsg, modelUsages);
    await persistHeadlessRuntimeState({
      currentTask: null,
      lastError: errMsg,
      lastSeenAt: Date.now(),
    });
    const persistResult = await recorder?.persist({
      status: 'failed',
      result: null,
      error: errMsg,
      messages: useStore.getState().getMessages(sessionId),
    });
    if (persistResult && !persistResult.ok) {
      console.error('[TraceRecorder] Failed to persist failed trace:', persistResult.error);
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (heartbeatId) {
      clearInterval(heartbeatId);
    }
    if (snapshotIntervalId) {
      clearInterval(snapshotIntervalId);
    }
    useStore.getState().setOttoAuthCurrentTask(null);
    await persistHeadlessRuntimeState({
      currentTask: null,
      lastSeenAt: Date.now(),
    });
    if (sessionId) {
      await sendToBackground({ type: 'session-close', sessionId }).catch(() => {});
    }
  }
}

export async function resetOttoAuthHeadlessRuntimeState(): Promise<void> {
  if (!isHeadlessWorkerContext()) return;
  await clearOttoAuthHeadlessRuntimeState();
}

async function pushTaskSnapshot(task: OttoAuthTask, sessionId: string): Promise<void> {
  const { ottoAuthUrl, ottoAuthToken } = useStore.getState();
  if (!ottoAuthUrl || !ottoAuthToken) return;

  const tabsResp = await sendToBackground({ type: 'tabs-context', sessionId });
  if (!tabsResp.success || !Array.isArray(tabsResp.data)) return;
  const tabs = tabsResp.data as Array<{ id: number; active: boolean; title?: string; url?: string }>;
  const activeTab = tabs.find((tab) => tab.active);
  if (!activeTab) return;

  const screenshotResp = await sendToBackground({ type: 'take-screenshot', tabId: activeTab.id });
  if (!screenshotResp.success) return;
  const raw = (screenshotResp.data as { screenshot: string }).screenshot;
  if (!raw) return;

  const viewportResp = await sendToBackground({ type: 'get-viewport-size', tabId: activeTab.id });
  const viewport = viewportResp.success
    ? (viewportResp.data as { width: number; height: number })
    : useStore.getState().viewportSize;
  const width = Math.max(320, Math.min(viewport.width || 1280, 1280));
  const height = Math.max(240, Math.min(viewport.height || 800, 900));
  const resized = await resizeScreenshotForModel(raw, width, height, window.devicePixelRatio || 1);

  await fetch(`${ottoAuthUrl}/api/computeruse/device/tasks/${task.id}/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ottoAuthToken}`,
      'X-OttoAuth-Mock-Device': useStore.getState().ottoAuthDeviceId || '',
    },
    body: JSON.stringify({
      image_base64: resized.data,
      width: resized.width,
      height: resized.height,
      tabs: tabs.map((tab) => ({
        id: tab.id,
        active: Boolean(tab.active),
        title: typeof tab.title === 'string' ? tab.title : '',
        url: typeof tab.url === 'string' ? tab.url : '',
      })),
    }),
  }).catch((error) => {
    throw error;
  });
}

async function reportTaskResult(
  taskId: string,
  status: 'completed' | 'failed',
  result: Record<string, unknown> | null,
  error: string | null,
  usages: OttoAuthModelUsage[],
): Promise<void> {
  const { ottoAuthUrl, ottoAuthToken, ottoAuthDeviceId } = useStore.getState();
  if (!ottoAuthUrl || !ottoAuthToken) return;

  try {
    await fetch(`${ottoAuthUrl}/api/computeruse/device/tasks/${taskId}/local-agent-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ottoAuthToken}`,
        'X-OttoAuth-Mock-Device': ottoAuthDeviceId || '',
      },
      body: JSON.stringify({ status, result, error, usages }),
    });
  } catch (e) {
    console.error('[OttoAuth] Failed to report task result:', e);
  }
}

async function fetchTaskMessages(taskId: string): Promise<Array<{ id: string; created_at?: string | null; message: string }>> {
  const { ottoAuthUrl, ottoAuthToken, ottoAuthDeviceId } = useStore.getState();
  if (!ottoAuthUrl || !ottoAuthToken) return [];

  const response = await fetch(`${ottoAuthUrl}/api/computeruse/device/tasks/${taskId}/messages`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ottoAuthToken}`,
      'X-OttoAuth-Mock-Device': ottoAuthDeviceId || '',
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; messages?: Array<{ id: string; created_at?: string | null; message: string }> }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Could not fetch OttoAuth chat messages (HTTP ${response.status}).`);
  }
  return Array.isArray(payload?.messages) ? payload.messages : [];
}

async function sendTaskMessage(taskId: string, message: string): Promise<void> {
  const { ottoAuthUrl, ottoAuthToken, ottoAuthDeviceId } = useStore.getState();
  if (!ottoAuthUrl || !ottoAuthToken) return;

  const response = await fetch(`${ottoAuthUrl}/api/computeruse/device/tasks/${taskId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ottoAuthToken}`,
      'X-OttoAuth-Mock-Device': ottoAuthDeviceId || '',
    },
    body: JSON.stringify({ message }),
  });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Could not send OttoAuth chat message (HTTP ${response.status}).`);
  }
}
