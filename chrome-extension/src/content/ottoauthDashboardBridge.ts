type BackgroundResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
};

type ExtensionFulfillmentStatus = {
  installed: true;
  hasApiKey: boolean;
  configured: boolean;
  serverUrl: string | null;
  deviceId: string | null;
  headlessModeEnabled: boolean;
  pollingRequested: boolean;
  runtimeActive: boolean;
  pollingActive: boolean;
  lastError: string | null;
  lastSeenAt: number | null;
};

const REQUEST_SOURCE = 'ottoauth-dashboard';
const RESPONSE_SOURCE = 'ottoauth-extension-dashboard';

const STORAGE_KEY_API_KEY = 'claude_api_key';
const STORAGE_KEY_OTTOAUTH_URL = 'ottoauth_server_url';
const STORAGE_KEY_OTTOAUTH_DEVICE_ID = 'ottoauth_device_id';
const STORAGE_KEY_OTTOAUTH_AUTH_TOKEN = 'ottoauth_auth_token';
const STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED = 'ottoauth_headless_mode_enabled';
const STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED = 'ottoauth_headless_polling_requested';
const STORAGE_KEY_OTTOAUTH_HEADLESS_RUNTIME_ACTIVE = 'ottoauth_headless_runtime_active';
const STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_ACTIVE = 'ottoauth_headless_polling_active';
const STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR = 'ottoauth_headless_last_error';
const STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT = 'ottoauth_headless_last_seen_at';

const STATUS_KEYS = [
  STORAGE_KEY_API_KEY,
  STORAGE_KEY_OTTOAUTH_URL,
  STORAGE_KEY_OTTOAUTH_DEVICE_ID,
  STORAGE_KEY_OTTOAUTH_AUTH_TOKEN,
  STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED,
  STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED,
  STORAGE_KEY_OTTOAUTH_HEADLESS_RUNTIME_ACTIVE,
  STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_ACTIVE,
  STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR,
  STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sendBackgroundMessage(message: Record<string, unknown>): Promise<BackgroundResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve({
          success: false,
          error: lastError.message || 'The extension background worker did not respond.',
        });
        return;
      }

      resolve(
        response ?? {
          success: false,
          error: 'The extension background worker returned no response.',
        },
      );
    });
  });
}

async function readStatus(): Promise<ExtensionFulfillmentStatus> {
  const response = await sendBackgroundMessage({ type: 'storage-get', keys: STATUS_KEYS });
  if (!response.success) {
    throw new Error(response.error || 'Could not read extension fulfillment settings.');
  }

  const values = isRecord(response.data) ? response.data : {};
  const serverUrl = asString(values[STORAGE_KEY_OTTOAUTH_URL]);
  const deviceId = asString(values[STORAGE_KEY_OTTOAUTH_DEVICE_ID]);
  const authToken = asString(values[STORAGE_KEY_OTTOAUTH_AUTH_TOKEN]);
  const apiKey = asString(values[STORAGE_KEY_API_KEY]);

  return {
    installed: true,
    hasApiKey: Boolean(apiKey),
    configured: Boolean(serverUrl && deviceId && authToken),
    serverUrl,
    deviceId,
    headlessModeEnabled: values[STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED] === true,
    pollingRequested: values[STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED] === true,
    runtimeActive: values[STORAGE_KEY_OTTOAUTH_HEADLESS_RUNTIME_ACTIVE] === true,
    pollingActive: values[STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_ACTIVE] === true,
    lastError: asString(values[STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR]),
    lastSeenAt: asNumber(values[STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT]),
  };
}

async function configureFulfillment(payload: unknown): Promise<ExtensionFulfillmentStatus> {
  if (!isRecord(payload)) {
    throw new Error('Missing fulfillment configuration.');
  }

  const serverUrl = asString(payload.serverUrl)?.trim() ?? '';
  const deviceId = asString(payload.deviceId)?.trim() ?? '';
  const authToken = asString(payload.authToken)?.trim() ?? '';

  if (!serverUrl || !deviceId || !authToken) {
    throw new Error('OttoAuth did not provide a complete device pairing response.');
  }

  const response = await sendBackgroundMessage({
    type: 'storage-set',
    items: {
      [STORAGE_KEY_OTTOAUTH_URL]: serverUrl,
      [STORAGE_KEY_OTTOAUTH_DEVICE_ID]: deviceId,
      [STORAGE_KEY_OTTOAUTH_AUTH_TOKEN]: authToken,
      [STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED]: true,
      [STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED]: true,
      [STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR]: null,
    },
  });

  if (!response.success) {
    throw new Error(response.error || 'Could not save fulfillment settings in the extension.');
  }

  return readStatus();
}

function isAllowedOttoAuthPage() {
  const { hostname } = window.location;
  return hostname === 'ottoauth.vercel.app' || hostname === 'localhost' || hostname === '127.0.0.1';
}

function postResponse(requestId: string, response: { ok: true; payload: unknown } | { ok: false; error: string }) {
  window.postMessage(
    {
      source: RESPONSE_SOURCE,
      requestId,
      ...response,
    },
    window.location.origin,
  );
}

async function handleRequest(requestId: string, action: string, payload: unknown) {
  try {
    if (action === 'status') {
      postResponse(requestId, { ok: true, payload: await readStatus() });
      return;
    }

    if (action === 'configure') {
      postResponse(requestId, { ok: true, payload: await configureFulfillment(payload) });
      return;
    }

    throw new Error(`Unsupported OttoAuth extension action: ${action}`);
  } catch (error) {
    postResponse(requestId, {
      ok: false,
      error: error instanceof Error ? error.message : 'The OttoAuth extension bridge failed.',
    });
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !isAllowedOttoAuthPage()) return;

  const message = event.data as unknown;
  if (!isRecord(message) || message.source !== REQUEST_SOURCE) return;

  const requestId = asString(message.requestId);
  const action = asString(message.action);
  if (!requestId || !action) return;

  void handleRequest(requestId, action, message.payload);
});
