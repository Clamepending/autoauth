function normalizeServerUrl(serverUrl) {
  return String(serverUrl || '').trim().replace(/\/+$/, '');
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildDeviceHeaders(config) {
  return {
    Authorization: `Bearer ${config.authToken}`,
    'X-OttoAuth-Mock-Device': config.deviceId,
  };
}

export async function pairDevice({
  serverUrl,
  deviceId,
  deviceLabel,
  pairingCode,
}) {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  if (!normalizedServerUrl) {
    throw new Error('A server URL is required.');
  }
  if (!deviceId?.trim()) {
    throw new Error('A device id is required.');
  }

  const response = await fetch(`${normalizedServerUrl}/api/computeruse/device/pair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device_id: deviceId.trim(),
      device_label: (deviceLabel || deviceId).trim(),
      pairing_code: String(pairingCode || '').trim(),
    }),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Pairing failed with HTTP ${response.status}.`);
  }

  return {
    serverUrl: normalizedServerUrl,
    deviceId: payload?.device?.id || deviceId.trim(),
    authToken: payload?.deviceToken,
    note: payload?.note || null,
    human: payload?.human || null,
  };
}

export async function waitForTask(config) {
  const response = await fetch(`${normalizeServerUrl(config.serverUrl)}/api/computeruse/device/wait-task`, {
    method: 'GET',
    headers: buildDeviceHeaders(config),
  });

  if (response.status === 204) {
    return null;
  }

  // Server-side per-device cooldown. Treat as "no task right now"; the caller
  // will sleep its normal idle interval before trying again.
  if (response.status === 429) {
    return null;
  }

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.error || `wait-task failed with HTTP ${response.status}.`);
  }
  return payload;
}

export async function uploadTaskSnapshot(config, taskId, payload) {
  const response = await fetch(
    `${normalizeServerUrl(config.serverUrl)}/api/computeruse/device/tasks/${encodeURIComponent(taskId)}/snapshot`,
    {
      method: 'POST',
      headers: {
        ...buildDeviceHeaders(config),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(body?.error || `snapshot failed with HTTP ${response.status}.`);
  }
  return body;
}

export async function reportTaskResult(config, taskId, payload) {
  const response = await fetch(
    `${normalizeServerUrl(config.serverUrl)}/api/computeruse/device/tasks/${encodeURIComponent(taskId)}/local-agent-complete`,
    {
      method: 'POST',
      headers: {
        ...buildDeviceHeaders(config),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(body?.error || `completion failed with HTTP ${response.status}.`);
  }
  return body;
}

export async function fetchTaskMessages(config, taskId) {
  const response = await fetch(
    `${normalizeServerUrl(config.serverUrl)}/api/computeruse/device/tasks/${encodeURIComponent(taskId)}/messages`,
    {
      method: 'GET',
      headers: buildDeviceHeaders(config),
    },
  );
  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(body?.error || `fetch messages failed with HTTP ${response.status}.`);
  }
  return Array.isArray(body?.messages) ? body.messages : [];
}

export async function sendTaskMessage(config, taskId, message) {
  const response = await fetch(
    `${normalizeServerUrl(config.serverUrl)}/api/computeruse/device/tasks/${encodeURIComponent(taskId)}/messages`,
    {
      method: 'POST',
      headers: {
        ...buildDeviceHeaders(config),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    },
  );
  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(body?.error || `send message failed with HTTP ${response.status}.`);
  }
  return body?.message || null;
}
