import {
  STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED,
  STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME,
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
  persist: (args: {
    status: 'completed' | 'failed';
    result: Record<string, unknown> | null;
    error: string | null;
    messages: DisplayMessage[];
  }) => Promise<{ ok: boolean; error?: string; directoryName?: string }>;
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

function normalizeFolderName(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

async function ensureDirectoryWritable(
  handle: FileSystemDirectoryHandle,
  requestPermission = false,
): Promise<boolean> {
  const query = await handle.queryPermission({ mode: 'readwrite' });
  if (query === 'granted') {
    return true;
  }
  if (!requestPermission) {
    return false;
  }
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
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

export async function loadTraceRecordingConfig(): Promise<void> {
  const handle = await loadDirectoryHandle();
  const writable = handle ? await ensureDirectoryWritable(handle, false) : false;
  chrome.storage.local.get(
    [
      STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED,
      STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME,
    ],
    async (result) => {
      const enabled = Boolean(result[STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]);
      let folderName = normalizeFolderName(result[STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME] as string | undefined);
      if (!folderName && handle) {
        folderName = handle.name;
      }
      if (!handle && folderName) {
        chrome.storage.local.remove([STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME]);
        folderName = null;
      }
      const effectiveEnabled = enabled && Boolean(folderName) && writable;
      if (enabled && !effectiveEnabled) {
        chrome.storage.local.set({
          [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: false,
        });
      }
      useStore.getState().setOttoAuthTraceRecordingEnabled(effectiveEnabled);
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
  if (!('showDirectoryPicker' in window)) {
    return { ok: false, error: 'Directory selection is not supported in this browser context.' };
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const granted = await ensureDirectoryWritable(handle, true);
    if (!granted) {
      return { ok: false, error: 'Write permission was not granted for the selected folder.' };
    }
    await saveDirectoryHandle(handle);
    const folderName = normalizeFolderName(handle.name) || 'selected-folder';
    chrome.storage.local.set({
      [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME]: folderName,
    });
    useStore.getState().setOttoAuthTraceRecordingFolderName(folderName);
    return { ok: true, folderName };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: 'Folder selection was cancelled.' };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createTraceRecorder(context: {
  task: OttoAuthTask;
  goal: string;
  sessionId: string;
  serverUrl: string | null;
  deviceId: string | null;
}): Promise<TraceRecorder | null> {
  const store = useStore.getState();
  if (!store.ottoAuthTraceRecordingEnabled) {
    return null;
  }

  const directoryHandle = await loadDirectoryHandle();
  if (!directoryHandle) {
    chrome.storage.local.set({
      [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: false,
    });
    useStore.getState().setOttoAuthTraceRecordingEnabled(false);
    return null;
  }
  const writable = await ensureDirectoryWritable(directoryHandle, false);
  if (!writable) {
    console.warn('[TraceRecorder] Recording enabled, but the selected folder is not writable.');
    chrome.storage.local.set({
      [STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED]: false,
    });
    useStore.getState().setOttoAuthTraceRecordingEnabled(false);
    return null;
  }

  const startedAt = new Date();
  const site = inferSiteSlug(context.task, context.goal);
  const baseDirName = sanitizeFileName(
    `${isoStamp(startedAt)}_${site}_${context.task.type}_${context.task.id.slice(0, 12)}`,
  );
  const events: TraceEvent[] = [];

  const persistStart = async () => {
    try {
      const runDir = await ensureRunDirectory(directoryHandle, startedAt, site, baseDirName);
      const taskPayload = {
        schemaVersion: TRACE_SCHEMA_VERSION,
        recordedAt: new Date().toISOString(),
        task: context.task,
        goal: context.goal,
        sessionId: context.sessionId,
        serverUrl: context.serverUrl,
        deviceId: context.deviceId,
      };
      const partialTracePayload = {
        schemaVersion: TRACE_SCHEMA_VERSION,
        startedAt: startedAt.toISOString(),
        completedAt: null,
        status: 'running',
        result: null,
        error: null,
        taskId: context.task.id,
        taskType: context.task.type,
        goal: context.goal,
        url: context.task.url,
        sessionId: context.sessionId,
        serverUrl: context.serverUrl,
        deviceId: context.deviceId,
        traceFolder: baseDirName,
        events,
        messages: [],
      };
      await writeJsonFile(runDir, 'task.json', taskPayload);
      await writeJsonFile(runDir, 'trace.json', partialTracePayload);
      return { ok: true, directoryName: baseDirName };
    } catch (persistError) {
      return {
        ok: false,
        error: persistError instanceof Error ? persistError.message : String(persistError),
      };
    }
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
    persist: async ({ status, result, error, messages }) => {
      try {
        const runDir = await ensureRunDirectory(directoryHandle, startedAt, site, baseDirName);
        const completedAt = new Date();

        const taskPayload = {
          schemaVersion: TRACE_SCHEMA_VERSION,
          recordedAt: completedAt.toISOString(),
          task: context.task,
          goal: context.goal,
          sessionId: context.sessionId,
          serverUrl: context.serverUrl,
          deviceId: context.deviceId,
        };
        const tracePayload = {
          schemaVersion: TRACE_SCHEMA_VERSION,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
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

        await writeJsonFile(runDir, 'task.json', taskPayload);
        await writeJsonFile(runDir, 'trace.json', tracePayload);
        return { ok: true, directoryName: baseDirName };
      } catch (persistError) {
        return {
          ok: false,
          error: persistError instanceof Error ? persistError.message : String(persistError),
        };
      }
    },
  };
}
