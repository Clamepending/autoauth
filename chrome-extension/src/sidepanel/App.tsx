import { useEffect } from 'react';
import { useStore } from './store';
import { STORAGE_KEY_API_KEY } from '../shared/constants';
import { loadOttoAuthConfig } from './agent/ottoAuthBridge';
import { sendToBackground } from '../shared/messaging';
import type { SessionInfo } from '../shared/types';
import ApiKeySetup from './components/ApiKeySetup';
import Chat from './components/Chat';
import OttoAuthSettings from './components/OttoAuthSettings';
import PermissionDialog from './components/PermissionDialog';
import PlanView from './components/PlanView';

async function syncActiveSession(createIfMissing = false): Promise<void> {
  let resp = await sendToBackground({ type: 'session-get-active' });
  const store = useStore.getState();

  if ((!resp.success || !resp.data) && createIfMissing) {
    resp = await sendToBackground({ type: 'session-request-create' });
  }

  if (resp.success && resp.data) {
    const session = resp.data as SessionInfo;
    if (!store.sessionStates[session.id]) {
      store.initSession(session);
    } else if (store.activeSessionId !== session.id) {
      store.switchSession(session.id);
    }
  } else {
    if (store.activeSessionId !== null) {
      store.switchSession(null);
    }
  }
}

export default function App() {
  const apiKey = useStore((s) => s.apiKey);
  const setApiKey = useStore((s) => s.setApiKey);
  const permissionRequest = useStore((s) => s.permissionRequest);
  const planRequest = useStore((s) => s.planRequest);
  const activeSessionId = useStore((s) => s.activeSessionId);

  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEY_API_KEY], (result) => {
      const stored = result[STORAGE_KEY_API_KEY];
      if (stored) setApiKey(stored as string);
    });
    loadOttoAuthConfig();
    syncActiveSession(true);
  }, [setApiKey]);

  useEffect(() => {
    const onTabActivated = () => { syncActiveSession(); };
    chrome.tabs.onActivated.addListener(onTabActivated);

    const onTabUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.groupId !== undefined) {
        syncActiveSession();
      }
    };
    chrome.tabs.onUpdated.addListener(onTabUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(onTabActivated);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    };
  }, []);

  if (!apiKey) {
    return <ApiKeySetup />;
  }

  if (!activeSessionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-white text-center px-6">
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700 mb-1">No active session</p>
        <p className="text-xs text-gray-400 max-w-[220px]">
          Click the extension icon on any tab to start a new agent session in a tab group.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <OttoAuthSettings />
      <Chat />
      {permissionRequest && <PermissionDialog request={permissionRequest} />}
      {planRequest && <PlanView request={planRequest} />}
    </div>
  );
}
