import { useState } from 'react';
import { sendToBackground } from '../../shared/messaging';
import type { LocalControlRequest } from '../../shared/types';
import { useStore } from '../store';
import ActionLibraryPanel from './ActionLibraryPanel';

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return null;
  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function statusPillClass(status: LocalControlRequest['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'stopped':
      return 'bg-yellow-100 text-yellow-700';
    case 'running':
      return 'bg-blue-100 text-blue-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function displaySummary(request: LocalControlRequest): string {
  return request.summary || request.error || 'No summary captured yet.';
}

export default function AgentControl() {
  const [creatingSession, setCreatingSession] = useState(false);
  const [createError, setCreateError] = useState('');
  const [panelView, setPanelView] = useState<'actions' | 'runs'>('actions');

  const currentRequest = useStore((s) => s.localControlCurrentRequest);
  const history = useStore((s) => s.localControlRequestHistory);
  const enabled = useStore((s) => s.localControlEnabled);
  const status = useStore((s) => s.localControlStatus);
  const recordingFolderName = useStore((s) => s.ottoAuthTraceRecordingFolderName);

  const recentRuns = history.filter((request) => (
    request.status === 'completed' || request.status === 'failed' || request.status === 'stopped'
  ));

  const startManualSession = async () => {
    setCreateError('');
    setCreatingSession(true);
    const response = await sendToBackground({ type: 'session-request-create' });
    setCreatingSession(false);
    if (!response.success) {
      setCreateError(response.error || 'Failed to create a browser session.');
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-white">
      <div className="px-4 pt-5 pb-3 border-b border-gray-100 bg-gradient-to-b from-slate-50 to-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Agent Control</div>
            <p className="mt-1 text-xs text-gray-500 max-w-[250px]">
              No tab-group session is active, so the extension is acting as a browser worker for queued runs.
            </p>
          </div>
          <button
            onClick={startManualSession}
            disabled={creatingSession}
            className="shrink-0 rounded-lg bg-orange-600 px-3 py-2 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {creatingSession ? 'Opening...' : 'Start Session'}
          </button>
        </div>
        {createError && (
          <div className="mt-2 text-xs text-red-600">{createError}</div>
        )}
      </div>

      <div className="px-4 py-3 border-b border-gray-100 bg-white">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Intake</div>
            <div className="mt-1 text-sm font-medium text-gray-800">
              {currentRequest ? 'Running' : enabled ? status === 'offline' ? 'Offline' : 'Listening' : 'Paused'}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Trace Folder</div>
            <div className="mt-1 text-sm font-medium text-gray-800 truncate" title={recordingFolderName || 'Not set'}>
              {recordingFolderName || 'Not set'}
            </div>
          </div>
        </div>
      </div>

      {currentRequest && (
        <div className="mx-4 mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-blue-800">Current Request</div>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              {currentRequest.model}
            </span>
          </div>
          <div className="mt-1 text-sm text-blue-900">{currentRequest.taskDescription}</div>
          <div className="mt-2 text-[11px] text-blue-700">
            Started {formatTimestamp(currentRequest.startedAt || currentRequest.updatedAt)}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-3">
        <div className="mb-3 inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          <button
            onClick={() => setPanelView('actions')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              panelView === 'actions'
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Actions
          </button>
          <button
            onClick={() => setPanelView('runs')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              panelView === 'runs'
                ? 'bg-orange-600 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Recent Runs
          </button>
        </div>

        {panelView === 'actions' ? (
          <ActionLibraryPanel />
        ) : recentRuns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <div className="text-sm font-medium text-gray-600">No finished requests yet</div>
            <p className="mt-1 text-xs text-gray-400">
              Enqueued localhost runs will land here with summaries and trace folder names.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentRuns.slice(0, 20).map((request) => {
              const durationLabel = formatDuration(request.executionDurationMs);
              return (
                <div key={request.id} className="rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">{request.taskDescription}</div>
                      <div className="mt-1 text-[11px] text-gray-500">
                        {request.model} • {formatTimestamp(request.completedAt || request.updatedAt)}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusPillClass(request.status)}`}>
                      {request.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">{displaySummary(request)}</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
                    <span>ID {request.id}</span>
                    {durationLabel && <span>Duration {durationLabel}</span>}
                    {request.traceDirectoryName && <span>Trace {request.traceDirectoryName}</span>}
                    {request.recordingFolderName && <span>Folder {request.recordingFolderName}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
