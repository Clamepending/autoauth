import { useEffect } from 'react';
import { useStore } from './store';
import { STORAGE_KEY_API_KEY } from '../shared/constants';
import { loadOttoAuthConfig } from './agent/ottoAuthBridge';
import ApiKeySetup from './components/ApiKeySetup';
import Chat from './components/Chat';
import OttoAuthSettings from './components/OttoAuthSettings';
import PermissionDialog from './components/PermissionDialog';
import PlanView from './components/PlanView';

export default function App() {
  const apiKey = useStore((s) => s.apiKey);
  const setApiKey = useStore((s) => s.setApiKey);
  const permissionRequest = useStore((s) => s.permissionRequest);
  const planRequest = useStore((s) => s.planRequest);

  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEY_API_KEY], (result) => {
      const stored = result[STORAGE_KEY_API_KEY];
      if (stored) setApiKey(stored as string);
    });
    loadOttoAuthConfig();
  }, [setApiKey]);

  if (!apiKey) {
    return <ApiKeySetup />;
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
