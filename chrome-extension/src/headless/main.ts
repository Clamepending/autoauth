import { loadAgentMacros } from '../sidepanel/agent/actionLibrary';
import { loadQuickAccessLinks } from '../sidepanel/agent/quickAccessLinks';
import {
  loadOttoAuthConfig,
  resetOttoAuthHeadlessRuntimeState,
  setOttoAuthExecutionContext,
  startOttoAuthPolling,
  stopOttoAuthPolling,
} from '../sidepanel/agent/ottoAuthBridge';
import { loadTraceRecordingConfig } from '../sidepanel/agent/traceRecorder';
import { useStore } from '../sidepanel/store';
import {
  STORAGE_KEY_API_KEY,
  STORAGE_KEY_OTTOAUTH_AUTH_TOKEN,
  STORAGE_KEY_OTTOAUTH_DEVICE_ID,
  STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED,
  STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED,
  STORAGE_KEY_QUICK_ACCESS_LINKS,
  STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED,
  STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME,
  STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED,
  STORAGE_KEY_OTTOAUTH_URL,
} from '../shared/constants';
import { readOttoAuthHeadlessState, writeOttoAuthHeadlessState } from '../shared/ottoAuthHeadlessState';

let heartbeatId: ReturnType<typeof setInterval> | null = null;

function setStatusText(text: string): void {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = text;
  }
}

async function loadApiKey(): Promise<void> {
  const values = await chrome.storage.local.get([STORAGE_KEY_API_KEY]);
  const apiKey = typeof values[STORAGE_KEY_API_KEY] === 'string'
    ? values[STORAGE_KEY_API_KEY] as string
    : null;
  useStore.getState().setApiKey(apiKey);
}

async function initializeRuntime(): Promise<void> {
  await loadAgentMacros();
  await loadQuickAccessLinks();
  await loadApiKey();
  await loadOttoAuthConfig();
  await loadTraceRecordingConfig();
}

async function reconcileHeadlessWorker(): Promise<void> {
  await loadApiKey();
  await loadQuickAccessLinks();
  await loadOttoAuthConfig();
  await loadTraceRecordingConfig();

  const headlessState = await readOttoAuthHeadlessState();
  const { apiKey, ottoAuthUrl, ottoAuthToken, ottoAuthDeviceId } = useStore.getState();

  if (!headlessState.modeEnabled) {
    stopOttoAuthPolling();
    setStatusText('Headless mode is disabled.');
    return;
  }

  if (!headlessState.pollingRequested) {
    stopOttoAuthPolling();
    setStatusText('Headless worker is idle.');
    return;
  }

  if (!apiKey) {
    stopOttoAuthPolling();
    await writeOttoAuthHeadlessState({
      lastError: 'Set an API key in the extension before starting OttoAuth headless mode.',
      lastSeenAt: Date.now(),
    });
    setStatusText('Waiting for API key.');
    return;
  }

  if (!ottoAuthUrl || !ottoAuthToken || !ottoAuthDeviceId) {
    stopOttoAuthPolling();
    await writeOttoAuthHeadlessState({
      lastError: 'Claim a device and connect OttoAuth before starting headless mode.',
      lastSeenAt: Date.now(),
    });
    setStatusText('Waiting for OttoAuth device pairing.');
    return;
  }

  startOttoAuthPolling();
  await writeOttoAuthHeadlessState({
    runtimeActive: true,
    lastError: null,
    lastSeenAt: Date.now(),
  });
  setStatusText('Headless OttoAuth polling is active.');
}

function relevantStorageChange(changes: Record<string, chrome.storage.StorageChange>): boolean {
  const keys = [
    STORAGE_KEY_API_KEY,
    STORAGE_KEY_OTTOAUTH_URL,
    STORAGE_KEY_OTTOAUTH_DEVICE_ID,
    STORAGE_KEY_OTTOAUTH_AUTH_TOKEN,
    STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED,
    STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED,
    STORAGE_KEY_QUICK_ACCESS_LINKS,
    STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED,
    STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME,
    STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED,
  ];
  return keys.some((key) => key in changes);
}

async function bootstrap(): Promise<void> {
  setOttoAuthExecutionContext('headless-worker');
  await initializeRuntime();
  await writeOttoAuthHeadlessState({
    runtimeActive: true,
    lastSeenAt: Date.now(),
  });
  await reconcileHeadlessWorker();

  heartbeatId = setInterval(() => {
    void writeOttoAuthHeadlessState({
      runtimeActive: true,
      lastSeenAt: Date.now(),
    });
  }, 10000);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !relevantStorageChange(changes)) return;
    void reconcileHeadlessWorker();
  });

  window.addEventListener('beforeunload', () => {
    if (heartbeatId) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
    void resetOttoAuthHeadlessRuntimeState();
  });
}

void bootstrap().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[OttoAuth Headless] bootstrap failed:', error);
  setStatusText(`Headless worker failed to start: ${message}`);
  await writeOttoAuthHeadlessState({
    runtimeActive: true,
    pollingActive: false,
    lastError: message,
    lastSeenAt: Date.now(),
  }).catch(() => {});
});
