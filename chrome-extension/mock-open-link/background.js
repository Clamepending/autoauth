const POLL_ALARM = "ottoauth-mock-poll";
const DEFAULTS = {
  pollEnabled: false,
  pollEndpoint: "https://ottoauth.vercel.app/api/computeruse/device/next-task",
  deviceId: "local-device-1",
  authToken: "",
  agentPairToken: "",
  openInBackground: false,
  liveListenEnabled: false,
  lastTaskId: "",
  lastStatus: "Idle",
};

let liveListenLoopActive = false;

function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

function setStorage(values) {
  return chrome.storage.local.set(values);
}

function setStatus(message) {
  const stamped = `[${new Date().toLocaleTimeString()}] ${message}`;
  return setStorage({ lastStatus: stamped });
}

function parseHttpUrl(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

async function openUrl(url, source = "unknown", openInBackground = false) {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    await setStatus(`Rejected invalid URL from ${source}`);
    throw new Error("Only http/https URLs are allowed.");
  }

  await chrome.tabs.create({
    url: parsed,
    active: !openInBackground,
  });
  await setStatus(`Opened ${parsed} (${source})`);
  return parsed;
}

function extractTask(payload) {
  if (!payload || typeof payload !== "object") return null;

  const direct = payload;
  const nested = typeof direct.task === "object" && direct.task ? direct.task : null;
  const task = nested ?? direct;

  const type =
    typeof task.type === "string" ? task.type :
    typeof task.command === "string" ? task.command :
    "open_url";
  const url = typeof task.url === "string" ? task.url : null;
  const id = typeof task.id === "string" || typeof task.id === "number" ? String(task.id) : "";

  if (type !== "open_url" || !url) return null;
  return { id, url };
}

async function pollOnce() {
  const {
    pollEnabled,
    pollEndpoint,
    deviceId,
    authToken,
    lastTaskId,
    openInBackground,
  } = await getStorage(DEFAULTS);

  if (!pollEnabled) return { ok: true, skipped: true };
  if (!pollEndpoint) {
    await setStatus("Polling enabled but endpoint is empty");
    return { ok: false, error: "Missing poll endpoint" };
  }

  const endpoint = parseHttpUrl(pollEndpoint);
  if (!endpoint) {
    await setStatus("Invalid poll endpoint URL");
    return { ok: false, error: "Invalid poll endpoint" };
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "X-OttoAuth-Mock-Device": String(deviceId || ""),
        ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
      },
    });
  } catch (error) {
    await setStatus(`Poll failed: ${String(error)}`);
    return { ok: false, error: String(error) };
  }

  if (response.status === 204) {
    await setStatus("No task");
    return { ok: true, empty: true };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    await setStatus(`Poll error ${response.status}${text ? `: ${text.slice(0, 80)}` : ""}`);
    return { ok: false, error: `HTTP ${response.status}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    await setStatus("Poll response was not JSON");
    return { ok: false, error: "Invalid JSON" };
  }

  const task = extractTask(payload);
  if (!task) {
    await setStatus("No usable open_url task in response");
    return { ok: true, empty: true };
  }

  if (task.id && task.id === lastTaskId) {
    await setStatus(`Skipping duplicate task ${task.id}`);
    return { ok: true, duplicate: true, id: task.id };
  }

  let opened;
  try {
    opened = await openUrl(task.url, "poll", Boolean(openInBackground));
  } catch (error) {
    if (task.id) {
      await reportTaskCompletion({
        taskId: task.id,
        status: "failed",
        error: String(error?.message || error),
        url: task.url,
      });
    }
    throw error;
  }
  if (task.id) {
    await setStorage({ lastTaskId: task.id });
    await reportTaskCompletion({ taskId: task.id, status: "completed", url: opened });
  }

  return { ok: true, opened: true, id: task.id || null, url: task.url };
}

function deriveWaitEndpoint(pollEndpoint) {
  const parsed = parseHttpUrl(pollEndpoint);
  if (!parsed) return null;
  try {
    const url = new URL(parsed);
    if (url.pathname.endsWith("/next-task")) {
      url.pathname = url.pathname.replace(/\/next-task$/, "/wait-task");
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function derivePairEndpoint(pollEndpoint) {
  const parsed = parseHttpUrl(pollEndpoint);
  if (!parsed) return null;

  try {
    const url = new URL(parsed);
    if (!url.pathname.endsWith("/next-task")) return null;
    url.pathname = url.pathname.replace(/\/next-task$/, "/pair");
    return url.toString();
  } catch {
    return null;
  }
}

function deriveCompleteEndpoint(pollEndpoint, taskId) {
  const parsed = parseHttpUrl(pollEndpoint);
  if (!parsed || !taskId) return null;

  try {
    const url = new URL(parsed);
    if (!url.pathname.endsWith("/next-task")) return null;
    url.pathname = url.pathname.replace(
      /\/next-task$/,
      `/tasks/${encodeURIComponent(String(taskId))}/complete`
    );
    return url.toString();
  } catch {
    return null;
  }
}

function deriveDeviceClaimTokenEndpoint(pollEndpoint) {
  const parsed = parseHttpUrl(pollEndpoint);
  if (!parsed) return null;
  try {
    const url = new URL(parsed);
    if (!url.pathname.endsWith("/next-task")) return null;
    url.pathname = url.pathname.replace(/\/next-task$/, "/claim-token");
    return url.toString();
  } catch {
    return null;
  }
}

function generateAgentPairToken() {
  return `browser_${Math.random().toString(36).slice(2, 8)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function reportTaskCompletion(params) {
  const taskId = params?.taskId ? String(params.taskId) : "";
  if (!taskId) return { ok: false, skipped: true, error: "Missing taskId" };

  const { pollEndpoint, deviceId, authToken } = await getStorage(DEFAULTS);
  const completeEndpoint = deriveCompleteEndpoint(pollEndpoint, taskId);
  if (!completeEndpoint) {
    await setStatus("Cannot derive complete endpoint from poll endpoint");
    return { ok: false, error: "Invalid poll endpoint for completion callback" };
  }

  let response;
  try {
    response = await fetch(completeEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-OttoAuth-Mock-Device": String(deviceId || ""),
        ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        status: params?.status || "completed",
        url: params?.url || null,
        error: params?.error || null,
        summary:
          params?.status === "failed"
            ? "Extension failed to open URL"
            : `Extension opened ${params?.url || "URL"}`,
      }),
    });
  } catch (error) {
    await setStatus(`Completion callback failed: ${String(error)}`);
    return { ok: false, error: String(error) };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    await setStatus(
      `Completion callback error ${response.status}${text ? `: ${text.slice(0, 80)}` : ""}`
    );
    return { ok: false, error: `HTTP ${response.status}` };
  }

  return { ok: true };
}

async function showNotification(params) {
  const title = typeof params?.title === "string" && params.title.trim()
    ? params.title.trim()
    : "OttoAuth";
  const message = typeof params?.message === "string" && params.message.trim()
    ? params.message.trim()
    : "New event";

  const notificationId = `ottoauth_${Date.now()}`;
  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icon-128.png",
    title,
    message,
    priority: 0,
  });
  await setStatus(`Notification: ${title}`);
  return { ok: true, notificationId };
}

async function pairDeviceNow() {
  const { pollEndpoint, deviceId } = await getStorage(DEFAULTS);
  const pairEndpoint = derivePairEndpoint(pollEndpoint);
  if (!pairEndpoint) {
    await setStatus("Cannot derive pair endpoint from poll endpoint");
    return { ok: false, error: "Invalid poll endpoint for pairing" };
  }

  let response;
  try {
    response = await fetch(pairEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ deviceId: String(deviceId || "local-device-1") }),
    });
  } catch (error) {
    await setStatus(`Pair failed: ${String(error)}`);
    return { ok: false, error: String(error) };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    await setStatus(`Pair error ${response.status}${text ? `: ${text.slice(0, 80)}` : ""}`);
    return { ok: false, error: `HTTP ${response.status}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    await setStatus("Pair response was not JSON");
    return { ok: false, error: "Invalid JSON" };
  }

  const token = typeof payload?.deviceToken === "string" ? payload.deviceToken : "";
  const returnedDeviceId =
    typeof payload?.device?.id === "string"
      ? payload.device.id
      : String(deviceId || "local-device-1");
  if (!token) {
    await setStatus("Pair response missing deviceToken");
    return { ok: false, error: "Missing deviceToken" };
  }

  await setStorage({ authToken: token, deviceId: returnedDeviceId });
  await setStatus(`Paired ${returnedDeviceId}`);
  return { ok: true, deviceId: returnedDeviceId, deviceToken: token };
}

async function registerAgentPairToken(params) {
  const agentPairToken = String(params?.agentPairToken || "").trim();
  if (!agentPairToken) {
    await setStatus("Missing agent pair token");
    return { ok: false, error: "Missing agent pair token" };
  }

  const { pollEndpoint, deviceId, authToken } = await getStorage(DEFAULTS);
  const endpoint = deriveDeviceClaimTokenEndpoint(pollEndpoint);
  if (!endpoint) {
    await setStatus("Cannot derive device-claim-token endpoint from poll endpoint");
    return { ok: false, error: "Invalid poll endpoint for device claim token" };
  }
  if (!authToken) {
    await setStatus("Pair the device first");
    return { ok: false, error: "Device is not paired yet" };
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-OttoAuth-Mock-Device": String(deviceId || ""),
        "Authorization": `Bearer ${authToken}`,
      },
      body: JSON.stringify({ agent_pair_token: agentPairToken }),
    });
  } catch (error) {
    await setStatus(`Register token failed: ${String(error)}`);
    return { ok: false, error: String(error) };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    await setStatus(
      `Register token error ${response.status}${text ? `: ${text.slice(0, 80)}` : ""}`
    );
    return { ok: false, error: `HTTP ${response.status}` };
  }

  await setStorage({ agentPairToken });
  await setStatus("Browser token ready to share with your agent");
  return { ok: true, agentPairToken };
}

async function setupBrowserTokenNow() {
  const paired = await pairDeviceNow();
  if (!paired.ok) return paired;

  const freshToken = generateAgentPairToken();
  const registered = await registerAgentPairToken({ agentPairToken: freshToken });
  if (!registered.ok) return registered;

  await setStorage({
    pollEnabled: false,
    liveListenEnabled: true,
  });
  void ensureLiveListenLoopRunning();

  return {
    ok: true,
    deviceId: paired.deviceId,
    agentPairToken: registered.agentPairToken,
  };
}

async function waitForTaskOnce() {
  const {
    pollEndpoint,
    deviceId,
    authToken,
    lastTaskId,
    openInBackground,
  } = await getStorage(DEFAULTS);

  const endpoint = deriveWaitEndpoint(pollEndpoint);
  if (!endpoint) {
    await setStatus("Cannot derive wait-task endpoint from poll endpoint");
    return { ok: false, error: "Invalid poll endpoint for wait-task" };
  }

  const url = new URL(endpoint);
  url.searchParams.set("waitMs", "25000");

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "X-OttoAuth-Mock-Device": String(deviceId || ""),
        ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
      },
    });
  } catch (error) {
    await setStatus(`Live wait failed: ${String(error)}`);
    return { ok: false, error: String(error) };
  }

  if (response.status === 204) {
    await setStatus("Live listen timeout (no task)");
    return { ok: true, empty: true, timeout: true };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    await setStatus(
      `Live wait error ${response.status}${text ? `: ${text.slice(0, 80)}` : ""}`
    );
    return { ok: false, error: `HTTP ${response.status}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    await setStatus("Live wait response was not JSON");
    return { ok: false, error: "Invalid JSON" };
  }

  const task = extractTask(payload);
  if (!task) {
    await setStatus("Live wait returned no usable open_url task");
    return { ok: true, empty: true };
  }

  if (task.id && task.id === lastTaskId) {
    await setStatus(`Live wait duplicate task ${task.id}`);
    return { ok: true, duplicate: true, id: task.id };
  }

  let opened;
  try {
    opened = await openUrl(task.url, "live-listen", Boolean(openInBackground));
  } catch (error) {
    if (task.id) {
      await reportTaskCompletion({
        taskId: task.id,
        status: "failed",
        error: String(error?.message || error),
        url: task.url,
      });
    }
    throw error;
  }
  if (task.id) {
    await setStorage({ lastTaskId: task.id });
    await reportTaskCompletion({ taskId: task.id, status: "completed", url: opened });
  }
  return { ok: true, opened: true, id: task.id || null, url: task.url };
}

async function ensureLiveListenLoopRunning() {
  if (liveListenLoopActive) return;
  liveListenLoopActive = true;

  try {
    while (true) {
      const { liveListenEnabled } = await getStorage(DEFAULTS);
      if (!liveListenEnabled) break;

      const result = await waitForTaskOnce();
      if (!result.ok) {
        // Avoid tight error loops.
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } finally {
    liveListenLoopActive = false;
  }
}

async function ensureDefaultsAndAlarm() {
  const current = await getStorage(DEFAULTS);
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (typeof current[key] === "undefined") {
      missing[key] = value;
    }
  }
  if (Object.keys(missing).length > 0) {
    await setStorage(missing);
  }

  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });

  const latest = await getStorage(DEFAULTS);
  if (latest.liveListenEnabled) {
    void ensureLiveListenLoopRunning();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaultsAndAlarm().catch((err) => {
    console.error("Failed to initialize extension:", err);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureDefaultsAndAlarm().catch((err) => {
    console.error("Failed to initialize on startup:", err);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  pollOnce().catch((err) => {
    console.error("Poll alarm failed:", err);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, error: "Invalid message" });
      return;
    }

    if (message.type === "open_url_now") {
      const settings = await getStorage(DEFAULTS);
      const opened = await openUrl(message.url, "popup", Boolean(settings.openInBackground));
      sendResponse({ ok: true, opened });
      return;
    }

    if (message.type === "poll_now") {
      const result = await pollOnce();
      sendResponse(result);
      return;
    }

    if (message.type === "pair_device_now") {
      const result = await pairDeviceNow();
      sendResponse(result);
      return;
    }

    if (message.type === "setup_browser_token_now") {
      const result = await setupBrowserTokenNow();
      sendResponse(result);
      return;
    }

    if (message.type === "live_listen_once") {
      const result = await waitForTaskOnce();
      sendResponse(result);
      return;
    }

    if (message.type === "test_notification") {
      const result = await showNotification({
        title: "OttoAuth Test",
        message: "Mock notification plumbing is working.",
      });
      sendResponse(result);
      return;
    }

    if (message.type === "get_settings") {
      const settings = await getStorage(DEFAULTS);
      sendResponse({ ok: true, settings });
      return;
    }

    if (message.type === "save_settings") {
      const next = {};
      if ("pollEnabled" in message) next.pollEnabled = Boolean(message.pollEnabled);
      if ("pollEndpoint" in message) next.pollEndpoint = String(message.pollEndpoint ?? "");
      if ("deviceId" in message) next.deviceId = String(message.deviceId ?? "");
      if ("authToken" in message) next.authToken = String(message.authToken ?? "");
      if ("agentPairToken" in message) next.agentPairToken = String(message.agentPairToken ?? "");
      if ("openInBackground" in message) next.openInBackground = Boolean(message.openInBackground);
      if ("liveListenEnabled" in message) next.liveListenEnabled = Boolean(message.liveListenEnabled);
      await setStorage(next);
      await setStatus("Settings saved");
      if (next.liveListenEnabled === true) {
        void ensureLiveListenLoopRunning();
      }
      const settings = await getStorage(DEFAULTS);
      sendResponse({ ok: true, settings });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })().catch(async (err) => {
    console.error("Message handler error:", err);
    await setStatus(`Error: ${String(err.message || err)}`);
    sendResponse({ ok: false, error: String(err.message || err) });
  });

  return true;
});
