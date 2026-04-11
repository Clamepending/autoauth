import { useEffect, useState } from 'react';
import { LOCAL_CONTROL_DEFAULT_URL } from '../../shared/constants';
import { saveLocalControlUrl, setLocalControlIntakeEnabled } from '../agent/localControlBridge';
import { useStore } from '../store';

function statusLabel(status: string, enabled: boolean, hasCurrentRequest: boolean): string {
  if (hasCurrentRequest) return 'Executing request';
  if (!enabled) return 'Paused';
  if (status === 'offline') return 'Server unavailable';
  return 'Listening';
}

export default function LocalControlSettings() {
  const [expanded, setExpanded] = useState(false);
  const [serverUrl, setServerUrl] = useState(LOCAL_CONTROL_DEFAULT_URL);

  const persistedUrl = useStore((s) => s.localControlUrl);
  const enabled = useStore((s) => s.localControlEnabled);
  const status = useStore((s) => s.localControlStatus);
  const currentRequest = useStore((s) => s.localControlCurrentRequest);
  const lastError = useStore((s) => s.localControlLastError);
  const history = useStore((s) => s.localControlRequestHistory);

  useEffect(() => {
    setServerUrl(persistedUrl || LOCAL_CONTROL_DEFAULT_URL);
  }, [persistedUrl]);

  const completedCount = history.filter((request) => (
    request.status === 'completed' || request.status === 'failed' || request.status === 'stopped'
  )).length;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs border-b border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${
            currentRequest
              ? 'bg-blue-500 animate-pulse'
              : enabled
                ? status === 'offline'
                  ? 'bg-red-400'
                  : 'bg-green-400'
                : 'bg-gray-300'
          }`}
          />
          <span className="text-gray-600">
            {currentRequest
              ? `Local queue: ${currentRequest.id.slice(0, 12)}...`
              : enabled
                ? status === 'offline'
                  ? 'Local queue: Server unavailable'
                  : 'Local queue: Listening'
                : 'Local queue: Paused'}
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
        <span className="text-xs font-medium text-gray-700">Local Agent Intake</span>
        <button
          onClick={() => setExpanded(false)}
          className="p-0.5 text-gray-400 hover:text-gray-600"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      <div className="text-xs text-gray-500 space-y-0.5">
        <div>Server: <span className="text-gray-700 break-all">{persistedUrl}</span></div>
        <div className="flex items-center gap-1">
          Status:
          <span className={`font-medium ${
            currentRequest ? 'text-blue-600' : status === 'offline' ? 'text-red-600' : enabled ? 'text-green-600' : 'text-gray-500'
          }`}>
            {statusLabel(status, enabled, Boolean(currentRequest))}
          </span>
        </div>
        <div>Completed runs: <span className="text-gray-700">{completedCount}</span></div>
      </div>

      {currentRequest && (
        <div className="text-xs bg-blue-50 rounded px-2 py-1.5 text-blue-700">
          Running: {currentRequest.taskDescription}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          type="text"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder={LOCAL_CONTROL_DEFAULT_URL}
          className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={() => saveLocalControlUrl(serverUrl)}
          className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
        >
          Save
        </button>
      </div>

      {lastError && (
        <div className="text-[11px] text-red-600">{lastError}</div>
      )}

      <button
        onClick={() => setLocalControlIntakeEnabled(!enabled)}
        className={`w-full px-2 py-1.5 text-xs font-medium rounded transition-colors ${
          enabled
            ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
        }`}
      >
        {enabled ? 'Pause Intake' : 'Start Intake'}
      </button>
    </div>
  );
}
