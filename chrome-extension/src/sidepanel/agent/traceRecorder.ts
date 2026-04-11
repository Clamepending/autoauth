import {
  STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED,
  STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME,
  STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED,
} from '../../shared/constants';
import type { OttoAuthTask } from '../../shared/types';
import { useStore, type DisplayMessage } from '../store';

const DB_NAME = 'ottoauth-trace-recording';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const DIRECTORY_HANDLE_KEY = 'recording-directory';
const TRACE_SCHEMA_VERSION = 1;

export interface TraceEvent {
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface TraceRecorder {
  note: (type: string, payload?: Record<string, unknown>) => void;
  persistStart: () => Promise<{ ok: boolean; error?: string; directoryName?: string }>;
  persistProgress: (args: {
    messages: DisplayMessage[];
  }) => Promise<{ ok: boolean; error?: string; directoryName?: string }>;
  persist: (args: {
    status: 'completed' | 'failed' | 'stopped';
    result: Record<string, unknown> | null;
    error: string | null;
    messages: DisplayMessage[];
  }) => Promise<{ ok: boolean; error?: string; directoryName?: string }>;
}

type WritableDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
};

function isHeadlessTraceContext(): boolean {
  if (typeof window === 'undefined') return false;
  return /\/(headless|offscreen)\.html$/.test(window.location.pathname)
    || window.location.pathname.endsWith('headless.html')
    || window.location.pathname.endsWith('offscreen.html');
}

async function getHeadlessFallbackDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isHeadlessTraceContext()) return null;
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof storage.getDirectory !== 'function') {
    return null;
  }
  try {
    const root = await storage.getDirectory();
    return await root.getDirectoryHandle('ottoauth-headless-traces', { create: true });
  } catch {
    return null;
  }
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onsuccess = async () => {
      const db = request.result;
      try {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const completion = new Promise<void>((resolveTx, rejectTx) => {
          tx.oncomplete = () => resolveTx();
          tx.onerror = () => rejectTx(tx.error ?? new Error('IndexedDB transaction failed'));
          tx.onabort = () => rejectTx(tx.error ?? new Error('IndexedDB transaction aborted'));
        });
        const value = await fn(store);
        await completion;
        db.close();
        resolve(value);
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore('readwrite', async (store) => {
    await idbRequest(store.put(handle, DIRECTORY_HANDLE_KEY));
  });
}

async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await withStore('readonly', async (store) => {
      const handle = await idbRequest(store.get(DIRECTORY_HANDLE_KEY));
      return (handle as FileSystemDirectoryHandle | undefined) ?? null;
    });
  } catch {
    return null;
  }
}

function getStorageValues<T extends string>(keys: T[]): Promise<Record<T, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result as Record<T, unknown>);
    });
  });
}

function normalizeFolderName(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

async function ensureDirectoryWritable(
  handle: FileSystemDirectoryHandle,
  requestPermission = false,
): Promise<boolean> {
  const permissionHandle = handle as WritableDirectoryHandle;
  const canWriteByProbe = async () => {
    try {
      const probeHandle = await handle.getFileHandle('.ottoauth-write-probe', { create: true });
      const writable = await probeHandle.createWritable();
      try {
        await writable.write('');
      } finally {
        await writable.close();
      }
      return true;
    } catch {
      return false;
    }
  };
  const query = permissionHandle.queryPermission
    ? await permissionHandle.queryPermission({ mode: 'readwrite' })
    : 'granted';
  if (query === 'granted') {
    return true;
  }
  if (!requestPermission) {
    return canWriteByProbe();
  }
  if (!permissionHandle.requestPermission) {
    return canWriteByProbe();
  }
  if ((await permissionHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
    return true;
  }
  return canWriteByProbe();
}

function sanitizeFileName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function hostnameFromUrl(value: string | null | undefined): string {
  if (!value) {
    return 'unknown-site';
  }
  try {
    return sanitizeFileName(new URL(value).hostname.replace(/^www\./, ''));
  } catch {
    return 'unknown-site';
  }
}

function firstUrlFromText(value: string | null | undefined): string | null {
  const text = String(value || '');
  const match = text.match(/https?:\/\/[^\s)"']+/i);
  return match ? match[0] : null;
}

function inferSiteSlug(task: OttoAuthTask, goal: string): string {
  const direct = hostnameFromUrl(task.url);
  if (direct !== 'unknown-site') {
    return direct;
  }
  const fromGoal = hostnameFromUrl(firstUrlFromText(goal));
  if (fromGoal !== 'unknown-site') {
    return fromGoal;
  }
  const fromTaskPrompt = hostnameFromUrl(firstUrlFromText(task.taskPrompt));
  if (fromTaskPrompt !== 'unknown-site') {
    return fromTaskPrompt;
  }
  return 'unknown-site';
}

function isoStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function compactBlock(block: DisplayMessage['blocks'][number]): Record<string, unknown> {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }
  if (block.type === 'tool_use') {
    return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
  }
  if (block.type === 'tool_result') {
    return {
      type: 'tool_result',
      toolUseId: block.toolUseId,
      text: block.text ?? '',
      hasImage: Boolean(block.imageData),
    };
  }
  return { type: 'screenshot', hasData: Boolean(block.data), bytes: block.data.length };
}

function compactMessages(messages: DisplayMessage[]): Record<string, unknown>[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    timestamp: message.timestamp,
    blocks: message.blocks.map((block) => compactBlock(block)),
  }));
}

async function writeJsonFile(
  directoryHandle: FileSystemDirectoryHandle,
  name: string,
  payload: unknown,
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(`${JSON.stringify(payload, null, 2)}\n`);
  } finally {
    await writable.close();
  }
}

async function ensureRunDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  startedAt: Date,
  site: string,
  baseDirName: string,
): Promise<FileSystemDirectoryHandle> {
  const dateDir = await directoryHandle.getDirectoryHandle(startedAt.toISOString().slice(0, 10), { create: true });
  const siteDir = await dateDir.getDirectoryHandle(site, { create: true });
  return siteDir.getDirectoryHandle(baseDirName, { create: true });
}

function buildTaskPayload(context: {
  task: OttoAuthTask;
  goal: string;
  sessionId: string;
  serverUrl: string | null;
  deviceId: string | null;
}, recordedAt: string) {
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    recordedAt,
    task: context.task,
    goal: context.goal,
    sessionId: context.sessionId,
    serverUrl: context.serverUrl,
    deviceId: context.deviceId,
  };
}

function buildTracePayload(args: {
  context: {
    task: OttoAuthTask;
    goal: string;
    sessionId: string;
    serverUrl: string | null;
    deviceId: string | null;
  };
  startedAt: Date;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  result: Record<string, unknown> | null;
  error: string | null;
  baseDirName: string;
  events: TraceEvent[];
  messages: DisplayMessage[];
}) {
  const { context, startedAt, completedAt, status, result, error, baseDirName, events, messages } = args;
  const completedTime = completedAt ? new Date(completedAt).getTime() : Date.now();
  const executionDurationMs = Math.max(0, completedTime - startedAt.getTime());
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    startedAt: startedAt.toISOString(),
    completedAt,
    executionDurationMs,
    status,
    result,
    error,
    taskId: context.task.id,
    taskType: context.task.type,
    goal: context.goal,
    url: context.task.url,
    sessionId: context.sessionId,
    serverUrl: context.serverUrl,
    deviceId: context.deviceId,
    traceFolder: baseDirName,
    events,
    messages: compactMessages(messages),
  };
}

export async function loadTraceRecordingConfig(): Promise<void> {
  const handle = await loadDirectoryHandle();
  chrome.storage.local.get(
    [
      STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED,
      STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME,
      STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED,
    ],
    async (result) => {
      const paused = Boolean(result[STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED]);
      let folderName = normalizeFolderName(result[STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME] as string | undefined);
      if (!folderName && handle) {
        folderName = handle.name;
      }
      if (!handle && folderName) {
        chrome.storage.local.remove([STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME]);
        folderName = null;
      }
      const desiredEnabled = Boolean(handle) && !paused;
      if (handle && folderName) {
        chrome.storage.local.set({
          [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: desiredEnabled,
          [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME]: folderName,
        });
      } else if (!desiredEnabled) {
        chrome.storage.local.set({
          [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: false,
        });
      }
      useStore.getState().setOttoAuthTraceRecordingEnabled(desiredEnabled);
      useStore.getState().setOttoAuthTraceRecordingFolderName(folderName);
    },
  );
}

export async function setTraceRecordingEnabled(enabled: boolean): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (enabled) {
    const handle = await loadDirectoryHandle();
    if (!handle) {
      useStore.getState().setOttoAuthTraceRecordingEnabled(false);
      return { ok: false, error: 'Select a recording folder before enabling trace capture.' };
    }
    const writable = await ensureDirectoryWritable(handle, true);
    if (!writable) {
      useStore.getState().setOttoAuthTraceRecordingEnabled(false);
      return {
        ok: false,
        error: 'Write permission was not granted for the selected folder.',
      };
    }
  }
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: enabled,
        [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED]: !enabled,
      },
      () => {
        useStore.getState().setOttoAuthTraceRecordingEnabled(enabled);
        resolve({ ok: true });
      },
    );
  });
}

export async function chooseTraceRecordingDirectory(): Promise<{
  ok: boolean;
  folderName?: string;
  error?: string;
}> {
  const pickerWindow = window as Window & {
    showDirectoryPicker?: (options?: { mode?: 'readwrite' | 'read' }) => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof pickerWindow.showDirectoryPicker !== 'function') {
    return { ok: false, error: 'Directory selection is not supported in this browser context.' };
  }
  try {
    const handle = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
    const granted = await ensureDirectoryWritable(handle, true);
    if (!granted) {
      return { ok: false, error: 'Write permission was not granted for the selected folder.' };
    }
    await saveDirectoryHandle(handle);
    const folderName = normalizeFolderName(handle.name) || 'selected-folder';
    chrome.storage.local.set({
      [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: true,
      [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED]: false,
      [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME]: folderName,
    });
    useStore.getState().setOttoAuthTraceRecordingEnabled(true);
    useStore.getState().setOttoAuthTraceRecordingFolderName(folderName);
    return { ok: true, folderName };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: 'Folder selection was cancelled.' };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function ensureTraceRecordingReady(
  requestPermission: boolean,
): Promise<{ ok: boolean; required: boolean; folderName?: string; error?: string }> {
  const persisted = await getStorageValues([
    STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME,
    STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED,
  ]);
  const paused = Boolean(persisted[STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED]);
  const directoryHandle = await loadDirectoryHandle();
  const folderName = normalizeFolderName(
    (persisted[STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME] as string | undefined)
      || directoryHandle?.name,
  );

  if (!directoryHandle || !folderName) {
    useStore.getState().setOttoAuthTraceRecordingEnabled(false);
    if (!folderName) {
      useStore.getState().setOttoAuthTraceRecordingFolderName(null);
    }
    return { ok: false, required: false, error: 'Select a recording folder before starting collection.' };
  }
  if (paused) {
    useStore.getState().setOttoAuthTraceRecordingEnabled(false);
    useStore.getState().setOttoAuthTraceRecordingFolderName(folderName);
    return { ok: false, required: false, folderName, error: 'Trace recording is paused. Click Start Recording to re-enable it.' };
  }

  const writable = await ensureDirectoryWritable(directoryHandle, requestPermission);
  useStore.getState().setOttoAuthTraceRecordingFolderName(folderName);
  useStore.getState().setOttoAuthTraceRecordingEnabled(true);
  if (!writable) {
    const fallbackDirectory = await getHeadlessFallbackDirectory();
    if (fallbackDirectory) {
      return { ok: true, required: true, folderName };
    }
    return {
      ok: false,
      required: true,
      folderName,
      error: 'Chrome still needs write permission for the selected recording folder.',
    };
  }

  chrome.storage.local.set({
    [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: true,
    [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED]: false,
    [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME]: folderName,
  });
  return { ok: true, required: true, folderName };
}

export function formatTraceRecordingFailureMessage(error?: string | null): string {
  const detail = String(error || 'write permission is required for the selected folder.').trim();
  return `Trace recording not ready: ${detail} Open OttoAuth settings and re-select the recording folder to restore write access.`;
}

export async function disableTraceRecording(folderName?: string | null): Promise<void> {
  const normalizedFolderName = normalizeFolderName(folderName);
  await new Promise<void>((resolve) => {
    chrome.storage.local.set(
      {
        [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: false,
        [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED]: true,
        ...(normalizedFolderName
          ? {
              [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME]: normalizedFolderName,
            }
          : {}),
      },
      () => resolve(),
    );
  });
  useStore.getState().setOttoAuthTraceRecordingEnabled(false);
  if (typeof folderName !== 'undefined') {
    useStore.getState().setOttoAuthTraceRecordingFolderName(normalizedFolderName);
  }
}

export async function createTraceRecorder(context: {
  task: OttoAuthTask;
  goal: string;
  sessionId: string;
  serverUrl: string | null;
  deviceId: string | null;
}): Promise<TraceRecorder | null> {
  const persisted = await getStorageValues([
    STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME,
    STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED,
  ]);
  const directoryHandle = await loadDirectoryHandle();
  const paused = Boolean(persisted[STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED]);
  const persistedEnabled = Boolean(directoryHandle) && !paused;
  const persistedFolderName = normalizeFolderName(
    persisted[STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME] as string | undefined,
  );

  if (!persistedEnabled) {
    useStore.getState().setOttoAuthTraceRecordingEnabled(false);
    if (!persistedFolderName) {
      useStore.getState().setOttoAuthTraceRecordingFolderName(null);
    }
    return null;
  }

  if (!directoryHandle) {
    await disableTraceRecording(persistedFolderName);
    return null;
  }
  const writable = await ensureDirectoryWritable(directoryHandle, false);
  let activeDirectoryHandle: FileSystemDirectoryHandle | null = directoryHandle;
  if (!writable) {
    const fallbackDirectory = await getHeadlessFallbackDirectory();
    if (fallbackDirectory) {
      activeDirectoryHandle = fallbackDirectory;
    } else {
      console.warn('[TraceRecorder] Recording enabled, but the selected folder is not writable.');
      await disableTraceRecording(
        persistedFolderName || normalizeFolderName(directoryHandle.name),
      );
      return null;
    }
  }

  useStore.getState().setOttoAuthTraceRecordingEnabled(true);
  useStore.getState().setOttoAuthTraceRecordingFolderName(
    persistedFolderName || normalizeFolderName(directoryHandle.name),
  );
  chrome.storage.local.set({
    [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: true,
    [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED]: false,
  });

  const startedAt = new Date();
  const site = inferSiteSlug(context.task, context.goal);
  const baseDirName = sanitizeFileName(
    `${isoStamp(startedAt)}_${site}_${context.task.type}_${context.task.id.slice(0, 12)}`,
  );
  const events: TraceEvent[] = [];
  let lastPersistedEventCount = 0;
  let lastPersistedMessageCount = 0;

  const persistSnapshot = async (args: {
    status: 'running' | 'completed' | 'failed' | 'stopped';
    result: Record<string, unknown> | null;
    error: string | null;
    messages: DisplayMessage[];
    force?: boolean;
  }) => {
    const messageCount = args.messages.length;
    const shouldSkip = !args.force
      && args.status === 'running'
      && events.length === lastPersistedEventCount
      && messageCount === lastPersistedMessageCount;
    if (shouldSkip) {
      return { ok: true, directoryName: baseDirName };
    }

    try {
      const runDir = await ensureRunDirectory(activeDirectoryHandle, startedAt, site, baseDirName);
      const recordedAt = new Date().toISOString();
      await writeJsonFile(runDir, 'task.json', buildTaskPayload(context, recordedAt));
      await writeJsonFile(
        runDir,
        'trace.json',
        buildTracePayload({
          context,
          startedAt,
          completedAt: args.status === 'running' ? null : recordedAt,
          status: args.status,
          result: args.result,
          error: args.error,
          baseDirName,
          events,
          messages: args.messages,
        }),
      );
      lastPersistedEventCount = events.length;
      lastPersistedMessageCount = messageCount;
      return { ok: true, directoryName: baseDirName };
    } catch (persistError) {
      return {
        ok: false,
        error: persistError instanceof Error ? persistError.message : String(persistError),
      };
    }
  };

  const persistStart = async () => {
    return persistSnapshot({
      status: 'running',
      result: null,
      error: null,
      messages: [],
      force: true,
    });
  };

  const note = (type: string, payload: Record<string, unknown> = {}) => {
    events.push({
      timestamp: Date.now(),
      type,
      payload,
    });
  };

  note('task_received', {
    taskId: context.task.id,
    taskType: context.task.type,
    goal: context.goal,
    url: context.task.url,
    sessionId: context.sessionId,
  });

  return {
    note,
    persistStart,
    persistProgress: async ({ messages }) =>
      persistSnapshot({
        status: 'running',
        result: null,
        error: null,
        messages,
      }),
    persist: async ({ status, result, error, messages }) => {
      return persistSnapshot({
        status,
        result,
        error,
        messages,
        force: true,
      });
    },
  };
}
