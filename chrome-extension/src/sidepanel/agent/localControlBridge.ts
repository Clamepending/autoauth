import {
  LOCAL_CONTROL_DEFAULT_URL,
  LOCAL_CONTROL_HISTORY_LIMIT,
  LOCAL_CONTROL_MACRO_SYNC_INTERVAL_MS,
  LOCAL_CONTROL_POLL_INTERVAL_MS,
  OTTOAUTH_TASK_HEARTBEAT_INTERVAL_MS,
  OTTOAUTH_TASK_TIMEOUT_MS,
  STORAGE_KEY_LOCAL_CONTROL_ENABLED,
  STORAGE_KEY_LOCAL_CONTROL_REQUEST_HISTORY,
  STORAGE_KEY_LOCAL_CONTROL_URL,
} from '../../shared/constants';
import type { LocalControlRequest } from '../../shared/types';
import { useStore } from '../store';
import { runAgentLoop } from './loop';
import {
  anySessionRunning,
  buildSyntheticTask,
  ensureBackgroundSession,
  extractResultFromMessages,
  summarizeResult,
} from './executionHelpers';
import { syncRemoteAgentMacros } from './actionLibrary';
import {
  createTraceRecorder,
  ensureTraceRecordingReady,
  formatTraceRecordingFailureMessage,
} from './traceRecorder';
import { sendToBackground } from '../../shared/messaging';

let pollingActive = false;
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
let lastMacroSyncAt = 0;

function normalizeUrl(value: string | null | undefined): string {
  const trimmed = String(value || '').trim();
  return (trimmed || LOCAL_CONTROL_DEFAULT_URL).replace(/\/+$/, '');
}

function calculateExecutionDurationMs(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number | null {
  if (!startedAt || !completedAt) return null;
  const startedTime = new Date(startedAt).getTime();
  const completedTime = new Date(completedAt).getTime();
  if (Number.isNaN(startedTime) || Number.isNaN(completedTime)) return null;
  return Math.max(0, completedTime - startedTime);
}

function getWorkerId(): string {
  const { ottoAuthDeviceId } = useStore.getState();
  return ottoAuthDeviceId || `chrome-extension-${chrome.runtime.id.slice(0, 8)}`;
}

function clampHistory(requests: LocalControlRequest[]): LocalControlRequest[] {
  return [...requests]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, LOCAL_CONTROL_HISTORY_LIMIT);
}

function persistHistory(requests: LocalControlRequest[]): void {
  chrome.storage.local.set({
    [STORAGE_KEY_LOCAL_CONTROL_REQUEST_HISTORY]: clampHistory(requests),
  });
}

function storeHistory(requests: LocalControlRequest[]): void {
  const limited = clampHistory(requests);
  useStore.getState().setLocalControlRequestHistory(limited);
  persistHistory(limited);
}

function upsertHistory(request: LocalControlRequest): void {
  const current = useStore.getState().localControlRequestHistory;
  storeHistory([
    request,
    ...current.filter((entry) => entry.id !== request.id),
  ]);
}

function schedulePoll(): void {
  if (!pollingActive) return;
  pollTimeoutId = setTimeout(pollForTask, LOCAL_CONTROL_POLL_INTERVAL_MS);
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) as T : (null as T);
}

async function refreshRequestHistoryFromServer(): Promise<void> {
  const { localControlUrl } = useStore.getState();
  if (!localControlUrl) return;
  try {
    const payload = await jsonFetch<{ requests?: LocalControlRequest[] }>(`${localControlUrl}/list_requests`);
    if (Array.isArray(payload.requests)) {
      storeHistory(payload.requests);
    }
  } catch {
    // The intake loop reports connectivity state; history refresh stays best-effort.
  }
}

async function maybeSyncRemoteMacros(force = false): Promise<void> {
  const { localControlUrl } = useStore.getState();
  if (!localControlUrl) return;
  const now = Date.now();
  if (!force && now - lastMacroSyncAt < LOCAL_CONTROL_MACRO_SYNC_INTERVAL_MS) {
    return;
  }
  lastMacroSyncAt = now;
  const result = await syncRemoteAgentMacros(localControlUrl);
  if (!result.ok) {
    // Macro sync is optional. Keep queue ingestion healthy even if the macro API is unavailable.
    console.debug('[LocalControl] Macro sync skipped:', result.error);
  }
}

async function claimNextRequest(): Promise<LocalControlRequest | null> {
  const { localControlUrl } = useStore.getState();
  const response = await fetch(`${localControlUrl}/internal/claim_next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_id: getWorkerId() }),
  });
  if (response.status === 204) {
    return null;
  }
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }
  return await response.json() as LocalControlRequest;
}

async function fetchRequestInfo(requestId: string): Promise<LocalControlRequest | null> {
  const { localControlUrl } = useStore.getState();
  try {
    const payload = await jsonFetch<{ request?: LocalControlRequest }>(
      `${localControlUrl}/get_request_info?request_id=${encodeURIComponent(requestId)}`,
    );
    return payload.request ?? null;
  } catch {
    return null;
  }
}

async function reportRequestUpdate(requestId: string, payload: Record<string, unknown>): Promise<LocalControlRequest | null> {
  const { localControlUrl } = useStore.getState();
  try {
    const response = await jsonFetch<{ request?: LocalControlRequest }>(
      `${localControlUrl}/internal/request_update`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, ...payload }),
      },
    );
    return response.request ?? null;
  } catch (error) {
    console.error('[LocalControl] Failed to report request update:', error);
    return null;
  }
}

export function stopLocalControlPolling(): void {
  pollingActive = false;
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
  const { localControlCurrentRequest } = useStore.getState();
  useStore.getState().setLocalControlStatus(localControlCurrentRequest ? 'processing' : 'paused');
}

export function startLocalControlPolling(): void {
  if (pollingActive) return;
  const { localControlEnabled, localControlUrl } = useStore.getState();
  if (!localControlEnabled || !localControlUrl) return;
  pollingActive = true;
  useStore.getState().setLocalControlStatus(useStore.getState().localControlCurrentRequest ? 'processing' : 'listening');
  useStore.getState().setLocalControlLastError(null);
  pollForTask();
}

export async function loadLocalControlConfig(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEY_LOCAL_CONTROL_ENABLED, STORAGE_KEY_LOCAL_CONTROL_URL],
      (result) => {
        const enabled = result[STORAGE_KEY_LOCAL_CONTROL_ENABLED] === undefined
          ? true
          : Boolean(result[STORAGE_KEY_LOCAL_CONTROL_ENABLED]);
        const url = normalizeUrl(result[STORAGE_KEY_LOCAL_CONTROL_URL] as string | undefined);
        const store = useStore.getState();
        store.setLocalControlEnabled(enabled);
        store.setLocalControlUrl(url);
        store.setLocalControlStatus(enabled ? 'listening' : 'paused');
        maybeSyncRemoteMacros(true).catch(() => {});
        if (enabled) {
          startLocalControlPolling();
          refreshRequestHistoryFromServer().catch(() => {});
        }
        resolve();
      },
    );
  });
}

export async function loadLocalControlHistory(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_LOCAL_CONTROL_REQUEST_HISTORY], (result) => {
      const history = Array.isArray(result[STORAGE_KEY_LOCAL_CONTROL_REQUEST_HISTORY])
        ? result[STORAGE_KEY_LOCAL_CONTROL_REQUEST_HISTORY] as LocalControlRequest[]
        : [];
      useStore.getState().setLocalControlRequestHistory(clampHistory(history));
      resolve();
    });
  });
}

export function setLocalControlIntakeEnabled(enabled: boolean): void {
  chrome.storage.local.set({ [STORAGE_KEY_LOCAL_CONTROL_ENABLED]: enabled });
  useStore.getState().setLocalControlEnabled(enabled);
  useStore.getState().setLocalControlLastError(null);
  maybeSyncRemoteMacros(true).catch(() => {});
  if (enabled) {
    startLocalControlPolling();
    refreshRequestHistoryFromServer().catch(() => {});
  } else {
    stopLocalControlPolling();
  }
}

export function saveLocalControlUrl(url: string): void {
  const normalized = normalizeUrl(url);
  chrome.storage.local.set({ [STORAGE_KEY_LOCAL_CONTROL_URL]: normalized });
  useStore.getState().setLocalControlUrl(normalized);
  useStore.getState().setLocalControlLastError(null);
  maybeSyncRemoteMacros(true).catch(() => {});
  if (useStore.getState().localControlEnabled) {
    stopLocalControlPolling();
    startLocalControlPolling();
    refreshRequestHistoryFromServer().catch(() => {});
  }
}

async function pollForTask(): Promise<void> {
  if (!pollingActive) return;
  const store = useStore.getState();
  await maybeSyncRemoteMacros().catch(() => {});
  if (!store.localControlEnabled || !store.localControlUrl) {
    stopLocalControlPolling();
    return;
  }
  if (anySessionRunning()) {
    useStore.getState().setLocalControlStatus(store.localControlCurrentRequest ? 'processing' : 'listening');
    schedulePoll();
    return;
  }

  try {
    const request = await claimNextRequest();
    useStore.getState().setLocalControlLastError(null);
    useStore.getState().setLocalControlStatus(request ? 'processing' : 'listening');
    if (request) {
      await executeLocalControlRequest(request);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useStore.getState().setLocalControlLastError(message);
    useStore.getState().setLocalControlStatus('offline');
  }

  schedulePoll();
}

async function executeLocalControlRequest(request: LocalControlRequest): Promise<void> {
  if (anySessionRunning()) return;

  const store = useStore.getState();
  const recordingReady = await ensureTraceRecordingReady(false);
  if (!recordingReady.ok && recordingReady.required) {
    const error = formatTraceRecordingFailureMessage(recordingReady.error);
    const failedRequest: LocalControlRequest = {
      ...request,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executionDurationMs: null,
      error,
      summary: error,
      recordingFolderName: store.ottoAuthTraceRecordingFolderName,
    };
    upsertHistory(failedRequest);
    await reportRequestUpdate(request.id, {
      status: 'failed',
      error,
      summary: error,
      executionDurationMs: null,
      recordingFolderName: store.ottoAuthTraceRecordingFolderName,
    });
    useStore.getState().setLocalControlLastError(error);
    return;
  }

  const sessionId = await ensureBackgroundSession('local_control');
  if (!sessionId) {
    const error = 'Failed to create session for request';
    const failedRequest: LocalControlRequest = {
      ...request,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executionDurationMs: null,
      error,
      summary: error,
      recordingFolderName: store.ottoAuthTraceRecordingFolderName,
    };
    upsertHistory(failedRequest);
    await reportRequestUpdate(request.id, {
      status: 'failed',
      error,
      summary: error,
      executionDurationMs: null,
      recordingFolderName: store.ottoAuthTraceRecordingFolderName,
    });
    return;
  }

  const runningRequest: LocalControlRequest = {
    ...request,
    status: 'running',
    sessionId,
    startedAt: request.startedAt || new Date().toISOString(),
    claimedAt: request.claimedAt || new Date().toISOString(),
    executionDurationMs: null,
    updatedAt: new Date().toISOString(),
    workerId: getWorkerId(),
    recordingFolderName: store.ottoAuthTraceRecordingFolderName,
  };
  useStore.getState().setLocalControlCurrentRequest(runningRequest);
  useStore.getState().setLocalControlStatus('processing');
  useStore.getState().setLocalControlLastError(null);
  upsertHistory(runningRequest);
  store.clearMessages(sessionId);

  const goal = request.taskDescription.trim();
  const traceTask = buildSyntheticTask({
    id: request.id,
    type: 'local_control',
    goal,
    createdAt: request.createdAt,
    deviceId: getWorkerId(),
  });
  const recorder = await createTraceRecorder({
    task: traceTask,
    goal,
    sessionId,
    serverUrl: store.localControlUrl,
    deviceId: getWorkerId(),
  });
  let traceDirectoryName: string | null = null;
  const startPersist = await recorder?.persistStart();
  if (startPersist?.directoryName) {
    traceDirectoryName = startPersist.directoryName;
  }
  if (startPersist && !startPersist.ok) {
    console.error('[TraceRecorder] Failed to persist task start:', startPersist.error);
  }
  recorder?.note('session_initialized', { sessionId, requestId: request.id, source: 'local_control' });

  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let stopRequested = Boolean(request.stopRequested);

  try {
    heartbeatId = setInterval(() => {
      const messages = useStore.getState().getMessages(sessionId);
      recorder?.note('heartbeat', {
        requestId: request.id,
        sessionId,
        messageCount: messages.length,
        isRunning: useStore.getState().getIsRunning(sessionId),
      });
      if (recorder) {
        recorder.persistProgress({ messages }).then((persistResult) => {
          if (persistResult.directoryName) {
            traceDirectoryName = persistResult.directoryName;
          }
          if (!persistResult.ok) {
            console.error('[TraceRecorder] Failed to persist running trace:', persistResult.error);
          }
        }).catch((persistError) => {
          console.error('[TraceRecorder] Failed to persist running trace:', persistError);
        });
      }
      fetchRequestInfo(request.id).then((serverRequest) => {
        if (serverRequest?.stopRequested && !stopRequested) {
          stopRequested = true;
          useStore.getState().setIsRunning(false, sessionId);
          recorder?.note('stop_requested', { requestId: request.id, sessionId });
        }
      }).catch(() => {});
    }, OTTOAUTH_TASK_HEARTBEAT_INTERVAL_MS);

    const loopPromise = runAgentLoop(goal, sessionId, {
      model: request.model,
      onEvent: (event) => recorder?.note(event.type, event.payload),
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        useStore.getState().setIsRunning(false, sessionId);
        useStore.getState().setError(
          `Local request timed out after ${Math.round(OTTOAUTH_TASK_TIMEOUT_MS / 1000)}s`,
          sessionId,
        );
        recorder?.note('task_timeout', {
          requestId: request.id,
          sessionId,
          timeoutMs: OTTOAUTH_TASK_TIMEOUT_MS,
        });
        reject(new Error(`Local request timed out after ${Math.round(OTTOAUTH_TASK_TIMEOUT_MS / 1000)}s`));
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

    const sessionError = useStore.getState().getError(sessionId);
    if (sessionError) {
      throw new Error(sessionError);
    }

    const result = extractResultFromMessages(sessionId);
    const completedAt = new Date().toISOString();
    const executionDurationMs = calculateExecutionDurationMs(runningRequest.startedAt, completedAt);
    const status = stopRequested ? 'stopped' : 'completed';
    const summary = summarizeResult(
      result,
      stopRequested ? 'Stopped before completion.' : 'Run completed.',
    );
    recorder?.note(stopRequested ? 'task_stopped' : 'task_completed', {
      requestId: request.id,
      hasResult: Boolean(result),
      status,
    });

    const persistResult = await recorder?.persist({
      status,
      result,
      error: stopRequested ? 'Stopped by request.' : null,
      messages: useStore.getState().getMessages(sessionId),
    });
    if (persistResult?.directoryName) {
      traceDirectoryName = persistResult.directoryName;
    }
    if (persistResult && !persistResult.ok) {
      console.error('[TraceRecorder] Failed to persist completed trace:', persistResult.error);
    }

    const finalRequest: LocalControlRequest = {
      ...runningRequest,
      status,
      updatedAt: completedAt,
      completedAt,
      executionDurationMs,
      stopRequested,
      summary,
      error: stopRequested ? 'Stopped by request.' : null,
      result,
      traceDirectoryName,
      recordingFolderName: useStore.getState().ottoAuthTraceRecordingFolderName,
    };
    useStore.getState().setLocalControlCurrentRequest(null);
    useStore.getState().setLocalControlStatus(useStore.getState().localControlEnabled ? 'listening' : 'paused');
    upsertHistory(finalRequest);
    await reportRequestUpdate(request.id, {
      status,
      summary,
      error: finalRequest.error,
      result,
      sessionId,
      stopRequested,
      executionDurationMs,
      traceDirectoryName,
      recordingFolderName: finalRequest.recordingFolderName,
    });
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (heartbeatId) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date().toISOString();
    const executionDurationMs = calculateExecutionDurationMs(runningRequest.startedAt, completedAt);
    recorder?.note('task_failed', { requestId: request.id, error: message });
    const persistResult = await recorder?.persist({
      status: stopRequested ? 'stopped' : 'failed',
      result: null,
      error: message,
      messages: useStore.getState().getMessages(sessionId),
    });
    if (persistResult?.directoryName) {
      traceDirectoryName = persistResult.directoryName;
    }
    if (persistResult && !persistResult.ok) {
      console.error('[TraceRecorder] Failed to persist failed trace:', persistResult.error);
    }
    const failedRequest: LocalControlRequest = {
      ...runningRequest,
      status: stopRequested ? 'stopped' : 'failed',
      updatedAt: completedAt,
      completedAt,
      executionDurationMs,
      stopRequested,
      summary: stopRequested ? 'Stopped before completion.' : message,
      error: message,
      result: null,
      traceDirectoryName,
      recordingFolderName: useStore.getState().ottoAuthTraceRecordingFolderName,
    };
    useStore.getState().setLocalControlCurrentRequest(null);
    useStore.getState().setLocalControlLastError(stopRequested ? null : message);
    useStore.getState().setLocalControlStatus(useStore.getState().localControlEnabled ? 'listening' : 'paused');
    upsertHistory(failedRequest);
    await reportRequestUpdate(request.id, {
      status: failedRequest.status,
      summary: failedRequest.summary,
      error: message,
      sessionId,
      stopRequested,
      executionDurationMs,
      traceDirectoryName,
      recordingFolderName: failedRequest.recordingFolderName,
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (heartbeatId) {
      clearInterval(heartbeatId);
    }
    useStore.getState().setLocalControlCurrentRequest(null);
    if (sessionId) {
      await sendToBackground({ type: 'session-close', sessionId }).catch(() => {});
    }
    refreshRequestHistoryFromServer().catch(() => {});
  }
}
