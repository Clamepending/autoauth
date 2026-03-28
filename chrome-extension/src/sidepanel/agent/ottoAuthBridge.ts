import { useStore } from '../store';
import { runAgentLoop } from './loop';
import type { OttoAuthTask } from '../../shared/types';
import {
  STORAGE_KEY_OTTOAUTH_URL,
  STORAGE_KEY_OTTOAUTH_DEVICE_ID,
  STORAGE_KEY_OTTOAUTH_AUTH_TOKEN,
  OTTOAUTH_POLL_INTERVAL_MS,
  OTTOAUTH_POLL_TIMEOUT_MS,
} from '../../shared/constants';

let pollingActive = false;
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

export async function pairWithOttoAuth(serverUrl: string, deviceName: string): Promise<{
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
      body: JSON.stringify({ device_id: deviceName || 'browser-agent-1' }),
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
  pollForTask();
}

export function stopOttoAuthPolling(): void {
  pollingActive = false;
  useStore.getState().setOttoAuthPolling(false);
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
}

async function pollForTask(): Promise<void> {
  if (!pollingActive) return;

  const { ottoAuthUrl, ottoAuthToken, ottoAuthDeviceId, isRunning } = useStore.getState();
  if (!ottoAuthUrl || !ottoAuthToken || !ottoAuthDeviceId) {
    stopOttoAuthPolling();
    return;
  }

  if (isRunning) {
    schedulePoll();
    return;
  }

  try {
    const res = await fetch(
      `${ottoAuthUrl}/api/computeruse/device/wait-task?waitMs=${OTTOAUTH_POLL_TIMEOUT_MS}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ottoAuthToken}`,
          'X-OttoAuth-Mock-Device': ottoAuthDeviceId,
        },
      },
    );

    if (res.status === 204) {
      schedulePoll();
      return;
    }

    if (res.status === 401) {
      console.error('[OttoAuth] Auth failed — device token may be invalid');
      useStore.getState().setOttoAuthConnected(false);
      stopOttoAuthPolling();
      return;
    }

    if (!res.ok) {
      console.error(`[OttoAuth] wait-task error: ${res.status}`);
      schedulePoll();
      return;
    }

    const task: OttoAuthTask = await res.json();
    await executeOttoAuthTask(task);
  } catch (e) {
    console.error('[OttoAuth] poll error:', e);
  }

  schedulePoll();
}

function schedulePoll(): void {
  if (!pollingActive) return;
  pollTimeoutId = setTimeout(pollForTask, OTTOAUTH_POLL_INTERVAL_MS);
}

async function executeOttoAuthTask(task: OttoAuthTask): Promise<void> {
  const store = useStore.getState();
  if (store.isRunning) return;

  store.setOttoAuthCurrentTask(task);
  store.clearMessages();

  const goal = task.goal || task.taskPrompt || task.url;
  if (!goal) {
    await reportTaskResult(task.id, 'failed', null, 'No goal or URL provided in task');
    store.setOttoAuthCurrentTask(null);
    return;
  }

  try {
    await runAgentLoop(goal);
    const result = extractResultFromMessages();
    await reportTaskResult(task.id, 'completed', result, null);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await reportTaskResult(task.id, 'failed', null, errMsg);
  } finally {
    useStore.getState().setOttoAuthCurrentTask(null);
  }
}

function extractResultFromMessages(): Record<string, unknown> | null {
  const messages = useStore.getState().messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    for (let j = msg.blocks.length - 1; j >= 0; j--) {
      const block = msg.blocks[j];
      if (block.type !== 'text') continue;
      const json = extractJson(block.text);
      if (json) return json;
    }
  }
  const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
  if (lastAssistant) {
    const textParts = lastAssistant.blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (textParts) {
      return { summary: textParts.slice(0, 2000) };
    }
  }
  return null;
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* not valid json */ }
  }
  const braceMatch = text.match(/\{[\s\S]*"status"\s*:\s*"[^"]+[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* not valid json */ }
  }
  return null;
}

async function reportTaskResult(
  taskId: string,
  status: 'completed' | 'failed',
  result: Record<string, unknown> | null,
  error: string | null,
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
      body: JSON.stringify({ status, result, error }),
    });
  } catch (e) {
    console.error('[OttoAuth] Failed to report task result:', e);
  }
}
