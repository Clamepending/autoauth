import { useEffect, useState } from 'react';
import { useStore } from '../store';
import {
  pairWithOttoAuth,
  disconnectOttoAuth,
  startOttoAuthPolling,
  stopOttoAuthPolling,
} from '../agent/ottoAuthBridge';
import {
  chooseTraceRecordingDirectory,
  ensureTraceRecordingReady,
  formatTraceRecordingFailureMessage,
  setTraceRecordingEnabled,
} from '../agent/traceRecorder';
import { OTTOAUTH_HEADLESS_STORAGE_KEYS, readOttoAuthHeadlessState, writeOttoAuthHeadlessState } from '../../shared/ottoAuthHeadlessState';
import type { OttoAuthHeadlessState, QuickAccessLink } from '../../shared/types';
import {
  DEFAULT_QUICK_ACCESS_LINKS,
  DEFAULT_SUPPORTED_PLATFORM_LINKS,
  resetQuickAccessLinks,
  saveQuickAccessLinks,
} from '../agent/quickAccessLinks';

const EMPTY_HEADLESS_STATE: OttoAuthHeadlessState = {
  modeEnabled: false,
  pollingRequested: false,
  runtimeActive: false,
  pollingActive: false,
  currentTask: null,
  lastError: null,
  lastSeenAt: null,
};

export default function OttoAuthSettings() {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [deviceName, setDeviceName] = useState('browser-agent-1');
  const [pairingCode, setPairingCode] = useState('');
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingError, setRecordingError] = useState('');
  const [recordingStatus, setRecordingStatus] = useState<Awaited<ReturnType<typeof ensureTraceRecordingReady>> | null>(null);
  const [headlessState, setHeadlessState] = useState<OttoAuthHeadlessState>(EMPTY_HEADLESS_STATE);
  const [headlessBusy, setHeadlessBusy] = useState(false);
  const [quickAccessDraft, setQuickAccessDraft] = useState<QuickAccessLink[]>(DEFAULT_QUICK_ACCESS_LINKS);
  const [quickAccessBusy, setQuickAccessBusy] = useState(false);
  const [quickAccessError, setQuickAccessError] = useState('');
  const [quickAccessMessage, setQuickAccessMessage] = useState('');

  const connected = useStore((s) => s.ottoAuthConnected);
  const polling = useStore((s) => s.ottoAuthPolling);
  const deviceId = useStore((s) => s.ottoAuthDeviceId);
  const currentTask = useStore((s) => s.ottoAuthCurrentTask);
  const url = useStore((s) => s.ottoAuthUrl);
  const recordingEnabled = useStore((s) => s.ottoAuthTraceRecordingEnabled);
  const recordingFolderName = useStore((s) => s.ottoAuthTraceRecordingFolderName);
  const quickAccessLinks = useStore((s) => s.quickAccessLinks);
  const headlessModeEnabled = headlessState.modeEnabled;
  const effectivePolling = headlessModeEnabled
    ? headlessState.pollingActive || headlessState.pollingRequested
    : polling;
  const effectiveCurrentTask = headlessModeEnabled ? headlessState.currentTask : currentTask;
  const headlessStarting = headlessModeEnabled
    && headlessState.pollingRequested
    && !headlessState.pollingActive
    && !headlessState.currentTask
    && !headlessState.lastError;
  const headlessStatusLabel = !headlessModeEnabled
    ? 'Disabled'
    : headlessState.currentTask
      ? 'Executing in background worker'
      : headlessState.pollingActive
        ? 'Polling in background worker'
        : headlessStarting
          ? 'Starting background worker'
          : headlessState.runtimeActive
            ? 'Worker idle'
            : 'Worker stopped';

  const traceNeedsAttention = connected && Boolean(recordingStatus) && !recordingStatus.ok && recordingStatus.required;
  const traceBlockingMessage = traceNeedsAttention
    ? formatTraceRecordingFailureMessage(recordingStatus?.error)
    : null;
  const effectiveAttentionMessage = traceBlockingMessage || (headlessModeEnabled ? headlessState.lastError : null);
  const attentionSummaryLabel = traceBlockingMessage
    ? 'Action needed: Fix trace folder'
    : effectiveAttentionMessage
      ? 'Action needed: Check OttoAuth'
      : null;
  const blockedStatusLabel = traceBlockingMessage
    ? 'Blocked by trace folder access'
    : effectiveAttentionMessage
      ? 'Blocked by headless worker error'
      : null;
  const pollingButtonLabel = effectivePolling ? 'Pause' : 'Start Polling';
  const folderButtonLabel = traceNeedsAttention
    ? 'Fix Folder Access'
    : recordingFolderName
      ? 'Re-select Folder'
      : 'Select Folder';

  const refreshHeadlessState = async () => {
    const nextState = await readOttoAuthHeadlessState();
    setHeadlessState(nextState);
    return nextState;
  };

  const refreshRecordingStatus = async () => {
    if (!recordingFolderName && !recordingEnabled) {
      setRecordingStatus(null);
      return null;
    }
    const status = await ensureTraceRecordingReady(false);
    setRecordingStatus(status);
    return status;
  };

  const handlePair = async () => {
    setError('');
    setPairing(true);
    const result = await pairWithOttoAuth(serverUrl, deviceName, pairingCode);
    setPairing(false);
    if (!result.ok) {
      setError(result.error || 'Pairing failed');
    } else {
      setPairingCode('');
    }
  };

  const handleDisconnect = async () => {
    if (headlessModeEnabled || headlessState.pollingRequested || headlessState.runtimeActive) {
      await writeOttoAuthHeadlessState({
        modeEnabled: false,
        pollingRequested: false,
        runtimeActive: false,
        pollingActive: false,
        currentTask: null,
        lastError: null,
        lastSeenAt: null,
      });
      await refreshHeadlessState();
    }
    disconnectOttoAuth();
    setError('');
    setRecordingError('');
  };

  const togglePolling = async () => {
    if (headlessModeEnabled) {
      if (headlessState.pollingRequested || headlessState.pollingActive) {
        await writeOttoAuthHeadlessState({
          pollingRequested: false,
          currentTask: null,
          lastError: null,
        });
      } else {
        setRecordingError('');
        if (recordingFolderName) {
          const ready = await ensureTraceRecordingReady(true);
          setRecordingStatus(ready);
          if (!ready.ok) {
            setRecordingError(
              ready.required
                ? `${ready.error || 'Trace recording is not ready.'} Re-select the folder below to fix it.`
                : ready.error || 'Trace recording is not ready.',
            );
            return;
          }
        }
        await writeOttoAuthHeadlessState({
          pollingRequested: true,
          lastError: null,
        });
      }
      await refreshHeadlessState();
      return;
    }

    if (polling) {
      stopOttoAuthPolling();
    } else {
      setRecordingError('');
      if (recordingFolderName) {
        const ready = await ensureTraceRecordingReady(true);
        setRecordingStatus(ready);
        if (!ready.ok) {
          setRecordingError(
            ready.required
              ? `${ready.error || 'Trace recording is not ready.'} Re-select the folder below to fix it.`
              : ready.error || 'Trace recording is not ready.',
          );
          return;
        }
      }
      startOttoAuthPolling();
    }
  };

  const handleSelectFolder = async () => {
    const shouldResumePolling = connected && !headlessModeEnabled && !polling && traceNeedsAttention;
    setRecordingBusy(true);
    setRecordingError('');
    const result = await chooseTraceRecordingDirectory();
    if (!result.ok) {
      setRecordingError(result.error || 'Failed to select a recording folder.');
    } else {
      const status = await refreshRecordingStatus();
      if (status && !status.ok) {
        setRecordingError(status.error || 'Trace recording is not ready.');
      } else if (shouldResumePolling) {
        startOttoAuthPolling();
      }
    }
    setRecordingBusy(false);
  };

  const handleToggleHeadlessMode = async () => {
    setHeadlessBusy(true);
    setRecordingError('');
    setError('');
    if (effectiveCurrentTask) {
      setError('Wait for the current OttoAuth task to finish before switching headless mode.');
      setHeadlessBusy(false);
      return;
    }
    if (!headlessModeEnabled) {
      const shouldTransferPolling = polling;
      if (shouldTransferPolling) {
        stopOttoAuthPolling();
      }
      await writeOttoAuthHeadlessState({
        modeEnabled: true,
        pollingRequested: shouldTransferPolling,
        runtimeActive: false,
        pollingActive: false,
        currentTask: null,
        lastError: null,
      });
    } else {
      await writeOttoAuthHeadlessState({
        modeEnabled: false,
        pollingRequested: false,
        runtimeActive: false,
        pollingActive: false,
        currentTask: null,
        lastError: null,
        lastSeenAt: null,
      });
    }
    await refreshHeadlessState();
    setHeadlessBusy(false);
  };

  const handleToggleRecording = async () => {
    setRecordingError('');
    if (recordingEnabled) {
      const result = await setTraceRecordingEnabled(false);
      if (!result.ok) {
        setRecordingError(result.error || 'Failed to update recording state.');
      } else {
        await refreshRecordingStatus();
      }
      return;
    }
    if (!recordingFolderName) {
      setRecordingError('Select a recording folder before enabling trace capture.');
      return;
    }
    setRecordingBusy(true);
    const result = await setTraceRecordingEnabled(true);
    if (!result.ok) {
      setRecordingError(result.error || 'Failed to enable trace capture.');
    } else {
      await refreshRecordingStatus();
    }
    setRecordingBusy(false);
  };

  const handleQuickAccessChange = (id: string, field: 'label' | 'url', value: string) => {
    setQuickAccessDraft((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleAddQuickAccess = () => {
    setQuickAccessDraft((current) => [
      ...current,
      {
        id: `quick-access-${Date.now()}-${current.length + 1}`,
        label: '',
        url: '',
      },
    ]);
    setQuickAccessError('');
    setQuickAccessMessage('');
  };

  const handleRemoveQuickAccess = (id: string) => {
    setQuickAccessDraft((current) => current.filter((entry) => entry.id !== id));
    setQuickAccessError('');
    setQuickAccessMessage('');
  };

  const handleSaveQuickAccess = async () => {
    setQuickAccessBusy(true);
    setQuickAccessError('');
    setQuickAccessMessage('');
    try {
      const next = await saveQuickAccessLinks(quickAccessDraft);
      setQuickAccessDraft(next);
      setQuickAccessMessage(`Saved ${next.length} quick-access link${next.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setQuickAccessError(error instanceof Error ? error.message : 'Could not save quick-access links.');
    } finally {
      setQuickAccessBusy(false);
    }
  };

  const handleResetQuickAccess = async () => {
    setQuickAccessBusy(true);
    setQuickAccessError('');
    setQuickAccessMessage('');
    try {
      const next = await resetQuickAccessLinks();
      setQuickAccessDraft(next);
      setQuickAccessMessage('Restored the default quick-access links.');
    } catch (error) {
      setQuickAccessError(error instanceof Error ? error.message : 'Could not reset quick-access links.');
    } finally {
      setQuickAccessBusy(false);
    }
  };

  useEffect(() => {
    if (url) {
      setServerUrl(url);
    }
  }, [url]);

  useEffect(() => {
    if (quickAccessLinks.length > 0) {
      setQuickAccessDraft(quickAccessLinks);
      return;
    }
    setQuickAccessDraft(DEFAULT_QUICK_ACCESS_LINKS);
  }, [quickAccessLinks]);

  useEffect(() => {
    void refreshHeadlessState();
    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (OTTOAUTH_HEADLESS_STORAGE_KEYS.some((key) => key in changes)) {
        void refreshHeadlessState();
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!recordingFolderName && !recordingEnabled) {
        if (!cancelled) {
          setRecordingStatus(null);
        }
        return;
      }
      const status = await ensureTraceRecordingReady(false);
      if (!cancelled) {
        setRecordingStatus(status);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, polling, recordingEnabled, recordingFolderName]);

  const recordingPanel = (
    <div className="rounded border border-gray-200 bg-white px-2 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-gray-700">Trace Recording</div>
          <div className="text-[11px] text-gray-500">
            Save task payloads and tool traces for later macro mining. If Chrome loses write access,
            OttoAuth runs will fail until you re-select the folder here.
          </div>
        </div>
        <button
          onClick={handleToggleRecording}
          disabled={recordingBusy}
          className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
            recordingEnabled
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-gray-900 text-white hover:bg-black'
          } disabled:opacity-50`}
        >
          {recordingEnabled ? 'Stop Recording' : 'Start Recording'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="min-w-0 text-gray-500">
          Folder:{' '}
          <span className="text-gray-700 break-all">
            {recordingFolderName || 'No folder selected'}
          </span>
        </div>
        <button
          onClick={handleSelectFolder}
          disabled={recordingBusy}
          className="shrink-0 px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {recordingBusy ? 'Selecting...' : folderButtonLabel}
        </button>
      </div>

      {traceBlockingMessage && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-2 text-[11px] text-red-700">
          {traceBlockingMessage}
        </div>
      )}

      {recordingError && (
        <div className="text-[11px] text-red-600">{recordingError}</div>
      )}
    </div>
  );

  const headlessPanel = (
    <div className="rounded border border-gray-200 bg-white px-2 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-gray-700">Headless Mode</div>
          <div className="text-[11px] text-gray-500">
            Default off. When enabled, OttoAuth keeps polling from a hidden background document
            even after you close the sidepanel.
          </div>
        </div>
        <button
          onClick={handleToggleHeadlessMode}
          disabled={headlessBusy}
          className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
            headlessModeEnabled
              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              : 'bg-gray-900 text-white hover:bg-black'
          } disabled:opacity-50`}
        >
          {headlessBusy ? 'Saving...' : headlessModeEnabled ? 'Disable Headless' : 'Enable Headless'}
        </button>
      </div>
      <div className="text-[11px] text-gray-500 space-y-0.5">
        <div>
          Mode:{' '}
          <span className={`font-medium ${headlessModeEnabled ? 'text-blue-700' : 'text-gray-700'}`}>
            {headlessModeEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div>
          Worker:{' '}
          <span className={`font-medium ${
            headlessState.currentTask
              ? 'text-blue-700'
              : headlessState.pollingActive
                ? 'text-green-700'
                : headlessStarting
                  ? 'text-yellow-700'
                  : 'text-gray-700'
          }`}>
            {headlessStatusLabel}
          </span>
        </div>
        {headlessState.lastSeenAt && (
          <div>Last heartbeat: <span className="text-gray-700">{new Date(headlessState.lastSeenAt).toLocaleString()}</span></div>
        )}
      </div>
    </div>
  );

  const quickAccessPanel = (
    <div className="rounded border border-gray-200 bg-white px-2 py-2 space-y-2">
      <div>
        <div className="text-xs font-medium text-gray-700">Supported Platforms</div>
        <div className="text-[11px] text-gray-500">
          This built-in table is always included in the agent prompt. If a task does not specify a platform,
          agents should prefer Fantuan or Grubhub for food ordering and Uber Central for Uber rides before generic search.
        </div>
      </div>

      <div className="space-y-2">
        {DEFAULT_SUPPORTED_PLATFORM_LINKS.map((entry) => (
          <div key={entry.id} className="rounded border border-gray-200 bg-gray-50 px-2 py-2 space-y-1">
            <div className="text-xs font-medium text-gray-800">{entry.label}</div>
            <div className="text-[11px] text-gray-500 break-all">{entry.url}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs font-medium text-gray-700">Quick Access Sites</div>
        <div className="text-[11px] text-gray-500">
          This table lives in the extension only. Browser agents include it in their prompt so they can jump directly to hard-to-find sites instead of relying on search results.
        </div>
      </div>

      <div className="space-y-2">
        {quickAccessDraft.map((entry) => (
          <div key={entry.id} className="rounded border border-gray-200 bg-gray-50 px-2 py-2 space-y-1.5">
            <input
              type="text"
              value={entry.label}
              onChange={(event) => handleQuickAccessChange(entry.id, 'label', event.target.value)}
              placeholder="Business name"
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
            <div className="flex gap-1.5">
              <input
                type="text"
                value={entry.url}
                onChange={(event) => handleQuickAccessChange(entry.id, 'url', event.target.value)}
                placeholder="https://example.com/order"
                className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
              <button
                onClick={() => handleRemoveQuickAccess(entry.id)}
                className="shrink-0 px-2 py-1.5 text-[11px] font-medium rounded border border-red-200 text-red-700 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {quickAccessError && (
        <div className="text-[11px] text-red-600">{quickAccessError}</div>
      )}
      {quickAccessMessage && (
        <div className="text-[11px] text-green-700">{quickAccessMessage}</div>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={handleAddQuickAccess}
          className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
        >
          Add Site
        </button>
        <button
          onClick={handleSaveQuickAccess}
          disabled={quickAccessBusy}
          className="px-2 py-1.5 text-[11px] font-medium rounded bg-gray-900 text-white hover:bg-black disabled:opacity-50"
        >
          {quickAccessBusy ? 'Saving...' : 'Save Sites'}
        </button>
        <button
          onClick={handleResetQuickAccess}
          disabled={quickAccessBusy}
          className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Reset Defaults
        </button>
      </div>
    </div>
  );

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs border-b border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${
            connected
              ? effectiveAttentionMessage
                ? 'bg-red-400'
                : effectiveCurrentTask
                  ? 'bg-blue-500 animate-pulse'
                  : effectivePolling
                  ? 'bg-green-400 animate-pulse'
                  : 'bg-yellow-400'
              : 'bg-gray-300'
          }`}
          />
          <span className="text-gray-600">
            {connected
              ? effectiveAttentionMessage
                ? attentionSummaryLabel
                : effectivePolling
                  ? effectiveCurrentTask
                    ? `Working: ${effectiveCurrentTask.id.slice(0, 12)}...`
                    : headlessModeEnabled
                      ? 'Listening headlessly...'
                      : 'Listening for tasks...'
                  : `Claimed: ${deviceId}`
              : 'OttoAuth: Not connected'}
          </span>
        </span>
        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }

  return (
    <div className="border-b border-gray-100 bg-gray-50 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">OttoAuth Connection</span>
        <button
          onClick={() => setExpanded(false)}
          className="p-0.5 text-gray-400 hover:text-gray-600"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      {connected ? (
        <div className="space-y-2">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-2 text-[11px] text-red-700">
              {error}
            </div>
          )}
          {effectiveAttentionMessage && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-2 text-[11px] text-red-700">
              {effectiveAttentionMessage}
            </div>
          )}

          <div className="text-xs text-gray-500 space-y-0.5">
            <div>Server: <span className="text-gray-700">{url}</span></div>
            <div>Claimed device: <span className="text-gray-700">{deviceId}</span></div>
            <div className="flex items-center gap-1">
              Status:{' '}
              <span className={`font-medium ${
                effectiveAttentionMessage
                  ? 'text-red-600'
                  : effectiveCurrentTask
                    ? 'text-blue-700'
                    : effectivePolling
                      ? 'text-green-600'
                      : 'text-yellow-600'
              }`}>
                {effectiveAttentionMessage
                  ? blockedStatusLabel
                  : effectiveCurrentTask
                    ? headlessModeEnabled ? 'Executing in headless worker' : 'Executing task'
                    : effectivePolling
                      ? headlessModeEnabled ? 'Polling in headless worker' : 'Polling'
                      : 'Paused'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              Trace capture:{' '}
              <span className={`font-medium ${
                traceNeedsAttention
                  ? 'text-red-600'
                  : recordingStatus?.ok
                    ? 'text-green-600'
                    : recordingEnabled
                      ? 'text-yellow-600'
                      : 'text-gray-500'
              }`}>
                {traceNeedsAttention
                  ? 'Needs folder access'
                  : recordingStatus?.ok
                    ? 'Ready'
                    : recordingEnabled
                      ? 'Enabled'
                      : 'Disabled'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              Execution mode:{' '}
              <span className={`font-medium ${headlessModeEnabled ? 'text-blue-700' : 'text-gray-700'}`}>
                {headlessModeEnabled ? 'Headless worker' : 'Sidepanel only'}
              </span>
            </div>
          </div>

          {effectiveCurrentTask && (
            <div className="text-xs bg-blue-50 rounded px-2 py-1.5 text-blue-700">
              Task: {effectiveCurrentTask.type} — {effectiveCurrentTask.id.slice(0, 16)}...
            </div>
          )}
          {headlessPanel}
          {recordingPanel}
          {quickAccessPanel}

          <div className="flex gap-1.5">
            <button
              onClick={togglePolling}
              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                effectiveAttentionMessage
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : effectivePolling
                  ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                  : 'bg-green-100 text-green-700 hover:bg-green-200'
              }`}
            >
              {pollingButtonLabel}
            </button>
            <button
              onClick={handleDisconnect}
              className="px-2 py-1.5 text-xs font-medium rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3000"
            className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="browser-agent-1"
            className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <input
            type="text"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value)}
            placeholder="Dashboard claim code"
            className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handlePair}
            disabled={pairing || !serverUrl || !pairingCode.trim()}
            className="w-full px-2 py-1.5 text-xs font-medium rounded bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-50"
          >
            {pairing ? 'Claiming...' : 'Connect & Claim Device'}
          </button>
          <p className="text-[11px] text-gray-500">
            Generate the claim code from the OttoAuth human dashboard, then paste it here to attach this device to that account.
          </p>
          {recordingPanel}
          {quickAccessPanel}
        </div>
      )}
    </div>
  );
}
