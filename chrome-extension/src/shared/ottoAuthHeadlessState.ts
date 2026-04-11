import {
  STORAGE_KEY_OTTOAUTH_HEADLESS_CURRENT_TASK,
  STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR,
  STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT,
  STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED,
  STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_ACTIVE,
  STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED,
  STORAGE_KEY_OTTOAUTH_HEADLESS_RUNTIME_ACTIVE,
} from './constants';
import type { OttoAuthHeadlessState, OttoAuthTask } from './types';

export const OTTOAUTH_HEADLESS_STORAGE_KEYS = [
  STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED,
  STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED,
  STORAGE_KEY_OTTOAUTH_HEADLESS_RUNTIME_ACTIVE,
  STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_ACTIVE,
  STORAGE_KEY_OTTOAUTH_HEADLESS_CURRENT_TASK,
  STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR,
  STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT,
] as const;

type HeadlessStorageKey = (typeof OTTOAUTH_HEADLESS_STORAGE_KEYS)[number];

function normalizeTask(value: unknown): OttoAuthTask | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string'
    || typeof record.type !== 'string'
    || typeof record.deviceId !== 'string'
    || typeof record.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: record.id,
    type: record.type,
    url: typeof record.url === 'string' ? record.url : null,
    goal: typeof record.goal === 'string' ? record.goal : null,
    taskPrompt: typeof record.taskPrompt === 'string' ? record.taskPrompt : null,
    deviceId: record.deviceId,
    createdAt: record.createdAt,
  };
}

export function normalizeOttoAuthHeadlessState(
  values: Partial<Record<HeadlessStorageKey, unknown>>,
): OttoAuthHeadlessState {
  return {
    modeEnabled: Boolean(values[STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED]),
    pollingRequested: Boolean(values[STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED]),
    runtimeActive: Boolean(values[STORAGE_KEY_OTTOAUTH_HEADLESS_RUNTIME_ACTIVE]),
    pollingActive: Boolean(values[STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_ACTIVE]),
    currentTask: normalizeTask(values[STORAGE_KEY_OTTOAUTH_HEADLESS_CURRENT_TASK]),
    lastError:
      typeof values[STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR] === 'string'
        ? values[STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR] as string
        : null,
    lastSeenAt:
      typeof values[STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT] === 'number'
        ? values[STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT] as number
        : null,
  };
}

export async function readOttoAuthHeadlessState(): Promise<OttoAuthHeadlessState> {
  const values = await chrome.storage.local.get([...OTTOAUTH_HEADLESS_STORAGE_KEYS]);
  return normalizeOttoAuthHeadlessState(values);
}

export async function writeOttoAuthHeadlessState(
  values: Partial<OttoAuthHeadlessState>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (typeof values.modeEnabled === 'boolean') {
    payload[STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED] = values.modeEnabled;
  }
  if (typeof values.pollingRequested === 'boolean') {
    payload[STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED] = values.pollingRequested;
  }
  if (typeof values.runtimeActive === 'boolean') {
    payload[STORAGE_KEY_OTTOAUTH_HEADLESS_RUNTIME_ACTIVE] = values.runtimeActive;
  }
  if (typeof values.pollingActive === 'boolean') {
    payload[STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_ACTIVE] = values.pollingActive;
  }
  if ('currentTask' in values) {
    payload[STORAGE_KEY_OTTOAUTH_HEADLESS_CURRENT_TASK] = values.currentTask ?? null;
  }
  if ('lastError' in values) {
    payload[STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR] = values.lastError ?? null;
  }
  if ('lastSeenAt' in values) {
    payload[STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT] = values.lastSeenAt ?? null;
  }
  if (Object.keys(payload).length === 0) return;
  await chrome.storage.local.set(payload);
}

export async function clearOttoAuthHeadlessRuntimeState(): Promise<void> {
  await writeOttoAuthHeadlessState({
    runtimeActive: false,
    pollingActive: false,
    currentTask: null,
    lastError: null,
    lastSeenAt: null,
  });
}
