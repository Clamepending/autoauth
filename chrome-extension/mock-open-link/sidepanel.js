function $(id) {
  return document.getElementById(id);
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

let lastRenderedLogId = "";
let autosaveTimer = null;
let bootstrapping = true;
let latestRuntimeState = null;
let continueResumePending = false;
let approvePlanPending = false;

const SEND_ICON_SVG = `
<svg class="iconGlyph iconPrimary" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M21 12 4.5 4.8l2.7 6.05L21 12Zm0 0-13.8 1.15L4.5 19.2 21 12Z"
    fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const STOP_ICON_SVG = `
<svg class="iconGlyph iconPrimary" viewBox="0 0 24 24" aria-hidden="true">
  <rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor"></rect>
</svg>`;

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString();
}

function truncate(value, max = 500) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function logKindToClass(kind) {
  if (kind === "error") return "error";
  if (kind === "user") return "user";
  if (kind === "planner" || kind === "plan" || kind === "action" || kind === "done") return "agent";
  return "system";
}

function renderRuntime(runtime) {
  latestRuntimeState = runtime || null;
  const status = runtime?.status || "idle";
  $("runStatus").textContent = status.replace(/_/g, " ");
  const meta = [];
  if (runtime?.step) meta.push(`step ${runtime.step}`);
  if (runtime?.isRunning) meta.push("running");
  if (runtime?.endedAt) meta.push(`ended ${formatTime(runtime.endedAt)}`);
  if (!meta.length) meta.push("No run yet");
  $("metaText").textContent = meta.join(" • ");
  updatePrimaryActionButton(runtime);
  updateApprovePlanButton(runtime);
  updateContinueMaxButton(runtime);

  const logs = Array.isArray(runtime?.logs) ? runtime.logs : [];
  const latestLogId = logs.length ? String(logs[logs.length - 1].id || "") : "";
  if (latestLogId === lastRenderedLogId && logs.length > 0) {
    return;
  }
  lastRenderedLogId = latestLogId;

  const feed = $("feed");
  feed.innerHTML = "";
  if (!logs.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Run the local browser agent to see steps here.";
    feed.appendChild(empty);
    return;
  }

  for (const log of logs) {
    const card = document.createElement("div");
    card.className = `msg ${logKindToClass(log.kind)}`;

    const metaRow = document.createElement("div");
    metaRow.className = "meta";
    metaRow.innerHTML = `<span>${log.kind || "event"}</span><span>${formatTime(log.at)}</span>`;
    card.appendChild(metaRow);

    const body = document.createElement("div");
    const isUserMessage = log.kind === "user";
    const userGoal = isUserMessage && log.data && typeof log.data.goal === "string"
      ? log.data.goal.trim()
      : "";
    body.textContent = isUserMessage
      ? (userGoal || log.message || "")
      : (log.message || "Event");
    card.appendChild(body);

    if (!isUserMessage && typeof log.data !== "undefined" && log.data !== null) {
      const details = document.createElement("details");
      details.className = "logDataDetails";
      const summary = document.createElement("summary");
      summary.textContent = "details";
      details.appendChild(summary);

      const pre = document.createElement("pre");
      pre.textContent = truncate(log.data, 1600);
      details.appendChild(pre);
      card.appendChild(details);
    }

    feed.appendChild(card);
  }

  feed.scrollTop = feed.scrollHeight;
}

function updateContinueMaxButton(runtime) {
  const btn = $("continueMaxBtn");
  if (!btn) return;
  const show = runtime?.status === "paused_max_steps" && !runtime?.isRunning;
  btn.classList.toggle("hidden", !show);
  btn.disabled = continueResumePending || Boolean(runtime?.isRunning);
  if (show) {
    const steps = Number.parseInt($("localAgentMaxSteps")?.value || "12", 10);
    const safeSteps = Number.isFinite(steps) ? steps : 12;
    btn.textContent = `Continue (${safeSteps})`;
    btn.title = `Continue this run for another ${safeSteps} steps`;
  }
}

function updateApprovePlanButton(runtime) {
  const btn = $("approvePlanBtn");
  if (!btn) return;
  const show = runtime?.status === "awaiting_plan_approval" && !runtime?.isRunning && runtime?.pendingPlan;
  btn.classList.toggle("hidden", !show);
  btn.disabled = approvePlanPending || Boolean(runtime?.isRunning);
}

function updatePrimaryActionButton(runtime) {
  const isRunning = Boolean(runtime?.isRunning);
  const btn = $("primaryActionBtn");
  const icon = $("primaryActionIcon");
  if (!btn || !icon) return;

  if (isRunning) {
    btn.classList.add("isStop");
    btn.title = "Stop agent";
    btn.setAttribute("aria-label", "Stop agent");
    icon.innerHTML = STOP_ICON_SVG;
  } else {
    btn.classList.remove("isStop");
    const awaitingApproval = runtime?.status === "awaiting_plan_approval" && runtime?.pendingPlan;
    btn.title = awaitingApproval ? "Send a new message (replaces pending plan)" : "Send message (generate plan)";
    btn.setAttribute("aria-label", awaitingApproval ? "Send new message" : "Send message and generate plan");
    icon.innerHTML = SEND_ICON_SVG;
  }
}

function setPairToken(token) {
  const el = $("agentPairToken");
  const next = String(token || "").trim();
  el.dataset.token = next;
  el.textContent = next || "No token yet";
  el.title = next || "No browser token yet";
}

function setPairingStatus(text) {
  const el = $("pairingStatusText");
  if (el) {
    el.textContent = text || "Generate a browser token, then give it to your agent once.";
  }
}

async function loadSettings() {
  const response = await sendMessage({ type: "get_settings" });
  if (!response?.ok) throw new Error(response?.error || "Failed to load settings");
  const s = response.settings || {};
  $("goalInput").value = s.localAgentGoal || "";
  $("llmBaseUrl").value = s.llmBaseUrl || "";
  $("llmModel").value = s.llmModel || "";
  $("llmApiKey").value = s.llmApiKey || "";
  $("localAgentMaxSteps").value = String(s.localAgentMaxSteps ?? 12);
  $("pollEndpoint").value = s.pollEndpoint || "";
  $("deviceId").value = s.deviceId || "";
  $("liveListenEnabled").checked = Boolean(s.liveListenEnabled);
  setPairToken(s.agentPairToken || "");
  setPairingStatus(s.agentPairToken ? "Share this token with your agent, then call register-device once." : "Generate a browser token, then give it to your agent once.");
}

async function loadRuntime() {
  const response = await sendMessage({ type: "get_local_agent_runtime" });
  if (!response?.ok) throw new Error(response?.error || "Failed to load runtime");
  renderRuntime(response.runtime || null);
}

function buildDebugTranscript() {
  const runtime = latestRuntimeState || {};
  const logs = Array.isArray(runtime.logs) ? runtime.logs : [];
  const transcript = {
    exportedAt: new Date().toISOString(),
    runtime: {
      status: runtime.status || "idle",
      isRunning: Boolean(runtime.isRunning),
      step: Number(runtime.step || 0),
      startedAt: runtime.startedAt || "",
      endedAt: runtime.endedAt || "",
      lastError: runtime.lastError || "",
      lastResult: runtime.lastResult ?? null,
      goal: runtime.goal || "",
      pendingPlan: runtime.pendingPlan ?? null,
    },
    logs: logs.map((log) => ({
      at: log?.at || "",
      kind: log?.kind || "event",
      message: log?.message || "",
      data: log?.data ?? null,
    })),
  };
  return JSON.stringify(transcript, null, 2);
}

async function copyChatDebugTranscript() {
  const text = buildDebugTranscript();
  try {
    await navigator.clipboard.writeText(text);
    setPairingStatus("Debug transcript copied");
  } catch {
    throw new Error("Clipboard unavailable. Copy transcript manually from devtools.");
  }
}

async function saveByokSettings() {
  const parsedMaxSteps = Number.parseInt($("localAgentMaxSteps").value.trim() || "12", 10);
  const response = await sendMessage({
    type: "save_settings",
    llmBaseUrl: $("llmBaseUrl").value.trim(),
    llmModel: $("llmModel").value.trim(),
    llmApiKey: $("llmApiKey").value.trim(),
    localAgentMaxSteps: Number.isFinite(parsedMaxSteps) ? parsedMaxSteps : 12,
    localAgentGoal: $("goalInput").value.trim(),
  });
  if (!response?.ok) throw new Error(response?.error || "Failed to save settings");
}

async function saveConnectionSettings() {
  const response = await sendMessage({
    type: "save_settings",
    pollEndpoint: $("pollEndpoint").value.trim(),
    deviceId: $("deviceId").value.trim(),
    liveListenEnabled: $("liveListenEnabled").checked,
  });
  if (!response?.ok) throw new Error(response?.error || "Failed to save connection settings");
  const s = response.settings || {};
  setPairToken(s.agentPairToken || "");
  setPairingStatus("Connection settings saved");
}

async function regenerateBrowserToken() {
  await saveConnectionSettings();
  setPairingStatus("Generating browser token...");
  const response = await sendMessage({ type: "setup_browser_token_now" });
  if (!response?.ok) throw new Error(response?.error || "Failed to generate browser token");
  setPairToken(response.agentPairToken || "");
  setPairingStatus("Browser token ready. Share it with your agent.");
  await loadSettings();
}

async function copyBrowserToken() {
  const token = String($("agentPairToken").dataset.token || "").trim();
  if (!token) throw new Error("No browser token yet. Click Regenerate first.");
  try {
    await navigator.clipboard.writeText(token);
    setPairingStatus("Browser token copied");
  } catch {
    throw new Error("Clipboard unavailable. Copy the token manually.");
  }
}

function scheduleAutosave() {
  if (bootstrapping) return;
  if (autosaveTimer) {
    window.clearTimeout(autosaveTimer);
  }
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    void saveByokSettings().catch(() => {});
  }, 350);
}

async function runAgent(mode = "continue") {
  const inputEl = $("goalInput");
  const goal = inputEl.value.trim();
  if (!goal) throw new Error("Enter a task first");
  await saveByokSettings();
  const response = await sendMessage({ type: "generate_local_agent_plan", goal, mode });
  if (!response?.ok) throw new Error(response?.error || "Failed to generate plan");
  inputEl.value = "";
}

async function stopAgent() {
  const response = await sendMessage({ type: "stop_local_agent" });
  if (!response?.ok) throw new Error(response?.error || "Failed to stop local agent");
}

async function onPrimaryAction() {
  if (latestRuntimeState?.isRunning) {
    await stopAgent();
    return;
  }
  await runAgent("continue");
}

async function continueAfterMaxSteps() {
  if (latestRuntimeState?.isRunning || continueResumePending) return;
  continueResumePending = true;
  updateContinueMaxButton(latestRuntimeState);
  try {
    await saveByokSettings();
    const response = await sendMessage({
      type: "run_local_agent_goal",
      goal: String(latestRuntimeState?.goal || ""),
      mode: "continue",
    });
    if (!response?.ok) throw new Error(response?.error || "Failed to continue run");
  } finally {
    // Runtime updates usually clear this immediately once running; this is a fallback.
    window.setTimeout(() => {
      continueResumePending = false;
      updateContinueMaxButton(latestRuntimeState);
    }, 800);
  }
}

async function approvePlan() {
  if (latestRuntimeState?.isRunning || approvePlanPending) return;
  approvePlanPending = true;
  updateApprovePlanButton(latestRuntimeState);
  try {
    await saveByokSettings();
    const response = await sendMessage({ type: "approve_local_agent_plan" });
    if (!response?.ok) throw new Error(response?.error || "Failed to approve plan");
  } finally {
    window.setTimeout(() => {
      approvePlanPending = false;
      updateApprovePlanButton(latestRuntimeState);
    }, 800);
  }
}

function wireRuntimeUpdates() {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "local_agent_runtime_update") {
      renderRuntime(message.runtime || null);
    }
  });
}

function setUiError(error) {
  const message = String(error?.message || error || "Error");
  if (/already running/i.test(message)) {
    return;
  }
  const feed = $("feed");
  const card = document.createElement("div");
  card.className = "msg error";
  card.innerHTML = `<div class="meta"><span>ui</span><span>${formatTime(new Date().toISOString())}</span></div>`;
  const body = document.createElement("div");
  body.textContent = message;
  card.appendChild(body);
  feed.prepend(card);
}

function setSettingsPanelOpen(open) {
  const panel = $("settingsPanel");
  const toggle = $("settingsToggleBtn");
  const isOpen = Boolean(open);
  panel.classList.toggle("hidden", !isOpen);
  panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

window.addEventListener("DOMContentLoaded", async () => {
  wireRuntimeUpdates();

  $("saveSettingsBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await saveByokSettings();
        await loadRuntime();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("settingsToggleBtn").addEventListener("click", () => {
    const panel = $("settingsPanel");
    const isHidden = panel.classList.contains("hidden");
    setSettingsPanelOpen(isHidden);
  });

  $("settingsCloseBtn").addEventListener("click", () => {
    setSettingsPanelOpen(false);
  });

  $("settingsPanel").addEventListener("click", (event) => {
    if (event.target === $("settingsPanel")) {
      setSettingsPanelOpen(false);
    }
  });

  $("saveConnectionBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await saveConnectionSettings();
        await loadRuntime();
        setPairingStatus("Connection settings saved");
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("setupTokenBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await regenerateBrowserToken();
      } catch (error) {
        setPairingStatus("Failed to generate browser token");
        setUiError(error);
      }
    })();
  });

  $("copyTokenBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await copyBrowserToken();
      } catch (error) {
        setPairingStatus("Failed to copy browser token");
        setUiError(error);
      }
    })();
  });

  $("copyChatDebugBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await copyChatDebugTranscript();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("refreshBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await loadSettings();
        await loadRuntime();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("continueMaxBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await continueAfterMaxSteps();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("approvePlanBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await approvePlan();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("primaryActionBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await onPrimaryAction();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  try {
    await sendMessage({ type: "ensure_local_chat_session" }).catch(() => null);
    await loadSettings();
    await loadRuntime();
    setSettingsPanelOpen(false);
  } catch (error) {
    setUiError(error);
  }
  bootstrapping = false;

  for (const id of ["goalInput", "llmBaseUrl", "llmModel", "llmApiKey", "localAgentMaxSteps"]) {
    const el = $(id);
    el.addEventListener("input", scheduleAutosave);
    el.addEventListener("change", scheduleAutosave);
    el.addEventListener("blur", scheduleAutosave);
  }

  $("localAgentMaxSteps").addEventListener("input", () => {
    updateContinueMaxButton(latestRuntimeState);
  });

  $("goalInput").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.isComposing) return;
    event.preventDefault();
    if (latestRuntimeState?.isRunning) {
      return;
    }
    void (async () => {
      try {
        await onPrimaryAction();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  window.setInterval(() => {
    void loadRuntime().catch(() => {});
  }, 1000);
});
