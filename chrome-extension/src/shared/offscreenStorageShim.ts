import type { BGMessage, BGResponse } from './types';

type StorageCallback = (items: Record<string, unknown>) => void;
type StorageMutationCallback = () => void;
type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

const storageChangeListeners = new Set<StorageChangeListener>();
let runtimeListenerInstalled = false;

async function sendRuntimeMessage(message: BGMessage): Promise<BGResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: BGResponse) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: 'No response from background' });
      }
    });
  });
}

function ensureRuntimeStorageListener(): void {
  if (runtimeListenerInstalled) return;
  runtimeListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object' || !('kind' in message)) return;
    if (message.kind !== 'storage-changed') return;
    const changes = (message.changes || {}) as Record<string, chrome.storage.StorageChange>;
    const areaName = typeof message.areaName === 'string' ? message.areaName : 'local';
    for (const listener of storageChangeListeners) {
      listener(changes, areaName);
    }
  });
}

function normalizeStorageKeys(
  keys?: string | string[] | Record<string, unknown> | null,
): string | string[] | Record<string, unknown> | null | undefined {
  if (typeof keys === 'undefined') return null;
  return keys;
}

export async function installOffscreenStorageShim(): Promise<void> {
  const chromeWithStorage = chrome as typeof chrome & {
    storage?: typeof chrome.storage;
  };

  if (chromeWithStorage.storage?.local) {
    return;
  }

  ensureRuntimeStorageListener();

  chromeWithStorage.storage = {
    local: {
      get: ((keys?: string | string[] | Record<string, unknown> | null, callback?: StorageCallback) => {
        const request = sendRuntimeMessage({
          type: 'storage-get',
          keys: normalizeStorageKeys(keys),
        }).then((response) => {
          if (!response.success) {
            throw new Error(response.error || 'Failed to read extension storage');
          }
          return (response.data || {}) as Record<string, unknown>;
        });
        if (callback) {
          request.then(callback).catch(() => callback({}));
        }
        return request;
      }) as typeof chrome.storage.local.get,
      set: ((items: Record<string, unknown>, callback?: StorageMutationCallback) => {
        const request = sendRuntimeMessage({
          type: 'storage-set',
          items,
        }).then((response) => {
          if (!response.success) {
            throw new Error(response.error || 'Failed to write extension storage');
          }
        });
        if (callback) {
          request.then(() => callback()).catch(() => callback());
        }
        return request;
      }) as typeof chrome.storage.local.set,
      remove: ((keys: string | string[], callback?: StorageMutationCallback) => {
        const request = sendRuntimeMessage({
          type: 'storage-remove',
          keys: Array.isArray(keys) ? keys : [keys],
        }).then((response) => {
          if (!response.success) {
            throw new Error(response.error || 'Failed to remove extension storage keys');
          }
        });
        if (callback) {
          request.then(() => callback()).catch(() => callback());
        }
        return request;
      }) as typeof chrome.storage.local.remove,
      clear: ((callback?: StorageMutationCallback) => {
        const request = sendRuntimeMessage({
          type: 'storage-clear',
        }).then((response) => {
          if (!response.success) {
            throw new Error(response.error || 'Failed to clear extension storage');
          }
        });
        if (callback) {
          request.then(() => callback()).catch(() => callback());
        }
        return request;
      }) as typeof chrome.storage.local.clear,
    } as typeof chrome.storage.local,
    onChanged: {
      addListener: ((listener: StorageChangeListener) => {
        storageChangeListeners.add(listener);
      }) as typeof chrome.storage.onChanged.addListener,
      removeListener: ((listener: StorageChangeListener) => {
        storageChangeListeners.delete(listener);
      }) as typeof chrome.storage.onChanged.removeListener,
      hasListener: ((listener: StorageChangeListener) => {
        return storageChangeListeners.has(listener);
      }) as typeof chrome.storage.onChanged.hasListener,
      hasListeners: (() => storageChangeListeners.size > 0) as typeof chrome.storage.onChanged.hasListeners,
      addRules: (async () => undefined) as typeof chrome.storage.onChanged.addRules,
      getRules: (async () => []) as typeof chrome.storage.onChanged.getRules,
      removeRules: (async () => undefined) as typeof chrome.storage.onChanged.removeRules,
    } as typeof chrome.storage.onChanged,
    managed: undefined as never,
    sync: undefined as never,
    session: undefined as never,
  };
}
