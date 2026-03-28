import { useState } from 'react';
import { useStore } from '../store';
import {
  pairWithOttoAuth,
  disconnectOttoAuth,
  startOttoAuthPolling,
  stopOttoAuthPolling,
} from '../agent/ottoAuthBridge';

export default function OttoAuthSettings() {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [deviceName, setDeviceName] = useState('browser-agent-1');
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const connected = useStore((s) => s.ottoAuthConnected);
  const polling = useStore((s) => s.ottoAuthPolling);
  const deviceId = useStore((s) => s.ottoAuthDeviceId);
  const currentTask = useStore((s) => s.ottoAuthCurrentTask);
  const url = useStore((s) => s.ottoAuthUrl);

  const handlePair = async () => {
    setError('');
    setPairing(true);
    const result = await pairWithOttoAuth(serverUrl, deviceName);
    setPairing(false);
    if (!result.ok) {
      setError(result.error || 'Pairing failed');
    }
  };

  const handleDisconnect = () => {
    disconnectOttoAuth();
    setError('');
  };

  const togglePolling = () => {
    if (polling) {
      stopOttoAuthPolling();
    } else {
      startOttoAuthPolling();
    }
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs border-b border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${connected ? (polling ? 'bg-green-400 animate-pulse' : 'bg-yellow-400') : 'bg-gray-300'}`} />
          <span className="text-gray-600">
            {connected
              ? polling
                ? currentTask
                  ? `Working: ${currentTask.id.slice(0, 12)}...`
                  : 'Listening for tasks...'
                : `Paired: ${deviceId}`
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
          <div className="text-xs text-gray-500 space-y-0.5">
            <div>Server: <span className="text-gray-700">{url}</span></div>
            <div>Device: <span className="text-gray-700">{deviceId}</span></div>
            <div className="flex items-center gap-1">
              Status:{' '}
              <span className={`font-medium ${polling ? 'text-green-600' : 'text-yellow-600'}`}>
                {polling ? (currentTask ? 'Executing task' : 'Polling') : 'Paused'}
              </span>
            </div>
          </div>

          {currentTask && (
            <div className="text-xs bg-blue-50 rounded px-2 py-1.5 text-blue-700">
              Task: {currentTask.type} — {currentTask.id.slice(0, 16)}...
            </div>
          )}

          <div className="flex gap-1.5">
            <button
              onClick={togglePolling}
              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                polling
                  ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                  : 'bg-green-100 text-green-700 hover:bg-green-200'
              }`}
            >
              {polling ? 'Pause' : 'Start Polling'}
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
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handlePair}
            disabled={pairing || !serverUrl}
            className="w-full px-2 py-1.5 text-xs font-medium rounded bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-50"
          >
            {pairing ? 'Pairing...' : 'Connect & Pair'}
          </button>
        </div>
      )}
    </div>
  );
}
