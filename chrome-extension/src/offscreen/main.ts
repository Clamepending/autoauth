import { installOffscreenStorageShim } from '../shared/offscreenStorageShim';
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

let heartbeatId: ReturnType<typeof setInterval> | null = null;

type HeadlessRuntimeDeps = {
  loadAgentMacros: () => Promise<unknown>;
  loadQuickAccessLinks: () => Promise<unknown>;
  loadOttoAuthConfig: () => Promise<void>;
  loadTraceRecordingConfig: () => Promise<void>;
  readOttoAuthHeadlessState: () => Promise<{
    modeEnabled: boolean;
    pollingRequested: boolean;
  }>;
  writeOttoAuthHeadlessState: (values: {
    runtimeActive?: boolean;
    pollingActive?: boolean;
    lastError?: string | null;
    lastSeenAt?: number | null;
  }) => Promise<void>;
  resetOttoAuthHeadlessRuntimeState: () => Promise<void>;
  setOttoAuthExecutionContext: (context: 'sidepanel' | 'headless-worker') => void;
  startOttoAuthPolling: () => void;
  stopOttoAuthPolling: () => void;
};

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

async function loadApiKey(): Promise<void> {
  const values = await chrome.storage.local.get([STORAGE_KEY_API_KEY]);
  const apiKey = typeof values[STORAGE_KEY_API_KEY] === 'string'
    ? values[STORAGE_KEY_API_KEY] as string
    : null;
  useStore.getState().setApiKey(apiKey);
}

async function bootstrap(): Promise<void> {
  await installOffscreenStorageShim();

  const [
    actionLibrary,
    ottoAuthBridge,
    traceRecorder,
    headlessStateStore,
  ] = await Promise.all([
    import('../sidepanel/agent/actionLibrary'),
    import('../sidepanel/agent/quickAccessLinks'),
    import('../sidepanel/agent/ottoAuthBridge'),
    import('../sidepanel/agent/traceRecorder'),
    import('../shared/ottoAuthHeadlessState'),
  ]);

  const deps: HeadlessRuntimeDeps = {
    loadAgentMacros: actionLibrary.loadAgentMacros,
    loadQuickAccessLinks: quickAccessLinks.loadQuickAccessLinks,
    loadOttoAuthConfig: ottoAuthBridge.loadOttoAuthConfig,
    loadTraceRecordingConfig: traceRecorder.loadTraceRecordingConfig,
    readOttoAuthHeadlessState: headlessStateStore.readOttoAuthHeadlessState,
    writeOttoAuthHeadlessState: headlessStateStore.writeOttoAuthHeadlessState,
    resetOttoAuthHeadlessRuntimeState: ottoAuthBridge.resetOttoAuthHeadlessRuntimeState,
    setOttoAuthExecutionContext: ottoAuthBridge.setOttoAuthExecutionContext,
    startOttoAuthPolling: ottoAuthBridge.startOttoAuthPolling,
    stopOttoAuthPolling: ottoAuthBridge.stopOttoAuthPolling,
  };

  deps.setOttoAuthExecutionContext('headless-worker');
  await deps.loadAgentMacros();
  await deps.loadQuickAccessLinks();
  await loadApiKey();
  await deps.loadOttoAuthConfig();
  await deps.loadTraceRecordingConfig();

  const reconcile = async () => {
    await loadApiKey();
    await deps.loadQuickAccessLinks();
    await deps.loadOttoAuthConfig();
    await deps.loadTraceRecordingConfig();

    const headlessState = await deps.readOttoAuthHeadlessState();
    const { apiKey, ottoAuthUrl, ottoAuthToken, ottoAuthDeviceId } = useStore.getState();

    if (!headlessState.modeEnabled) {
      deps.stopOttoAuthPolling();
      return;
    }

    if (!headlessState.pollingRequested) {
      deps.stopOttoAuthPolling();
      return;
    }

    if (!apiKey) {
      deps.stopOttoAuthPolling();
      await deps.writeOttoAuthHeadlessState({
        lastError: 'Set an API key in the extension before starting OttoAuth headless mode.',
        lastSeenAt: Date.now(),
      });
      return;
    }

    if (!ottoAuthUrl || !ottoAuthToken || !ottoAuthDeviceId) {
      deps.stopOttoAuthPolling();
      await deps.writeOttoAuthHeadlessState({
        lastError: 'Claim a device and connect OttoAuth before starting headless mode.',
        lastSeenAt: Date.now(),
      });
      return;
    }

    deps.startOttoAuthPolling();
    await deps.writeOttoAuthHeadlessState({
      runtimeActive: true,
      lastError: null,
      lastSeenAt: Date.now(),
    });
  };

  await deps.writeOttoAuthHeadlessState({
    runtimeActive: true,
    lastSeenAt: Date.now(),
  });
  await reconcile();

  heartbeatId = setInterval(() => {
    void deps.writeOttoAuthHeadlessState({
      runtimeActive: true,
      lastSeenAt: Date.now(),
    });
  }, 10000);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !relevantStorageChange(changes)) return;
    void reconcile();
  });

  window.addEventListener('beforeunload', () => {
    if (heartbeatId) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
    void deps.resetOttoAuthHeadlessRuntimeState();
  });
}

void bootstrap().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[OttoAuth Offscreen] bootstrap failed:', error);
  try {
    await installOffscreenStorageShim();
    const { writeOttoAuthHeadlessState } = await import('../shared/ottoAuthHeadlessState');
    await writeOttoAuthHeadlessState({
      runtimeActive: true,
      pollingActive: false,
      lastError: message,
      lastSeenAt: Date.now(),
    });
  } catch {
    // Ignore follow-on bootstrap failures while reporting the original error.
  }
});
