import { useEffect } from 'react';
import { useStore } from './store';
import { STORAGE_KEY_API_KEY } from '../shared/constants';
import { loadAgentMacros } from './agent/actionLibrary';
import { loadOttoAuthConfig } from './agent/ottoAuthBridge';
import { loadLocalControlConfig, loadLocalControlHistory } from './agent/localControlBridge';
import { loadTraceRecordingConfig } from './agent/traceRecorder';
import { sendToBackground } from '../shared/messaging';
import type { SessionInfo, SidePanelNotification } from '../shared/types';
import AgentControl from './components/AgentControl';
import ApiKeySetup from './components/ApiKeySetup';
import Chat from './components/Chat';
import LocalControlSettings from './components/LocalControlSettings';
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
    void (async () => {
      await Promise.all([
        loadAgentMacros(),
        loadOttoAuthConfig(),
        loadLocalControlHistory(),
        loadTraceRecordingConfig(),
      ]);
      await loadLocalControlConfig();
      await syncActiveSession(false);
    })();
  }, [setApiKey]);

  useEffect(() => {
    const onTabActivated = () => { syncActiveSession(); };
    chrome.tabs.onActivated.addListener(onTabActivated);

    const onTabUpdated = (_tabId: number, changeInfo: { groupId?: number }) => {
      if (changeInfo.groupId !== undefined) {
        syncActiveSession();
      }
    };
    chrome.tabs.onUpdated.addListener(onTabUpdated);

    const onRuntimeMessage = (message: SidePanelNotification) => {
      const store = useStore.getState();
      if (!message || typeof message !== 'object' || !('kind' in message)) return;
      if (message.kind === 'session-created') {
        const existing = store.sessionInfos[message.session.id];
        if (!existing) {
          store.initSession(message.session);
          // Keep background OttoAuth sessions from stealing the current view.
          if (message.session.source && message.session.source !== 'manual') {
            syncActiveSession();
          }
        }
        return;
      }
      if (message.kind === 'session-removed') {
        const wasActive = store.activeSessionId === message.sessionId;
        store.removeSession(message.sessionId);
        if (wasActive) {
          syncActiveSession();
        }
      }
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    return () => {
      chrome.tabs.onActivated.removeListener(onTabActivated);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    };
  }, []);

  if (!apiKey) {
    return <ApiKeySetup />;
  }

  if (!activeSessionId) {
    return (
      <div className="h-full min-h-0 flex flex-col bg-white">
        <OttoAuthSettings />
        <LocalControlSettings />
        <AgentControl />
        {permissionRequest && <PermissionDialog request={permissionRequest} />}
        {planRequest && <PlanView request={planRequest} />}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-white">
      <OttoAuthSettings />
      <LocalControlSettings />
      <Chat />
      {permissionRequest && <PermissionDialog request={permissionRequest} />}
      {planRequest && <PlanView request={planRequest} />}
    </div>
  );
}
