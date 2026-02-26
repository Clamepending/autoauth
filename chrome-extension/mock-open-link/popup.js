function $(id) {
  return document.getElementById(id);
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function setStatus(text) {
  $("status").textContent = text;
}

function displayToken(token) {
  $("agentPairToken").value = token || "";
}

async function loadSettings() {
  const response = await sendMessage({ type: "get_settings" });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to load settings");
    return;
  }

  const s = response.settings || {};
  $("pollEndpoint").value = s.pollEndpoint || "";
  $("deviceId").value = s.deviceId || "";
  $("liveListenEnabled").checked = Boolean(s.liveListenEnabled);
  displayToken(s.agentPairToken || "");
  setStatus(s.lastStatus || "Idle");
}

async function saveSettings() {
  const payload = {
    type: "save_settings",
    pollEndpoint: $("pollEndpoint").value.trim(),
    deviceId: $("deviceId").value.trim(),
    liveListenEnabled: $("liveListenEnabled").checked,
  };
  const response = await sendMessage(payload);
  if (!response?.ok) {
    setStatus(response?.error || "Save failed");
    return;
  }
  displayToken(response.settings?.agentPairToken || "");
  setStatus(response.settings?.lastStatus || "Settings saved");
}

async function setupBrowserToken() {
  const preSave = await sendMessage({
    type: "save_settings",
    pollEndpoint: $("pollEndpoint").value.trim(),
    deviceId: $("deviceId").value.trim(),
    // Don't start live listen before pairing+token registration succeeds.
    // The background setup flow enables it after success.
    liveListenEnabled: $("liveListenEnabled").checked,
  });
  if (!preSave?.ok) {
    setStatus(preSave?.error || "Save failed");
    return;
  }

  const response = await sendMessage({ type: "setup_browser_token_now" });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to create browser token");
    return;
  }
  displayToken(response.agentPairToken || "");
  await loadSettings();
}

async function copyToken() {
  const token = $("agentPairToken").value.trim();
  if (!token) {
    setStatus("No browser token yet. Click Connect / Refresh Token first.");
    return;
  }

  try {
    await navigator.clipboard.writeText(token);
    setStatus("Browser token copied");
  } catch {
    $("agentPairToken").focus();
    $("agentPairToken").select();
    setStatus("Clipboard unavailable. Token selected; copy manually.");
  }
}

async function openNow() {
  const url = $("manualUrl").value.trim();
  if (!url) {
    setStatus("Enter a URL first");
    return;
  }
  const response = await sendMessage({ type: "open_url_now", url });
  if (!response?.ok) {
    setStatus(response?.error || "Open URL failed");
    return;
  }
  setStatus(`Opened: ${response.opened}`);
}

async function pollNow() {
  const response = await sendMessage({ type: "poll_now" });
  if (!response?.ok) {
    setStatus(response?.error || "Poll failed");
    return;
  }
  if (response.opened) {
    setStatus(`Opened from poll: ${response.url}`);
    return;
  }
  if (response.duplicate) {
    setStatus(`Skipped duplicate task ${response.id}`);
    return;
  }
  if (response.empty || response.skipped) {
    setStatus(response.skipped ? "Polling disabled" : "No task");
    return;
  }
  setStatus(JSON.stringify(response));
}

async function listenOnce() {
  const response = await sendMessage({ type: "live_listen_once" });
  if (!response?.ok) {
    setStatus(response?.error || "Listen failed");
    return;
  }
  if (response.opened) {
    setStatus(`Opened from live listen: ${response.url}`);
    return;
  }
  if (response.timeout || response.empty) {
    setStatus("No task during live listen window");
    return;
  }
  setStatus(JSON.stringify(response));
}

async function testNotification() {
  const response = await sendMessage({ type: "test_notification" });
  if (!response?.ok) {
    setStatus(response?.error || "Notification failed");
    return;
  }
  setStatus("Notification sent");
}

window.addEventListener("DOMContentLoaded", async () => {
  $("setupTokenBtn").addEventListener("click", () => void setupBrowserToken());
  $("copyTokenBtn").addEventListener("click", () => void copyToken());
  $("saveBtn").addEventListener("click", () => void saveSettings());
  $("pollNowBtn").addEventListener("click", () => void pollNow());
  $("listenOnceBtn").addEventListener("click", () => void listenOnce());
  $("testNotificationBtn").addEventListener("click", () => void testNotification());
  $("openNowBtn").addEventListener("click", () => void openNow());
  await loadSettings();
});
