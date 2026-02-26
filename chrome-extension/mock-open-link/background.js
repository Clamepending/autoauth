const POLL_ALARM = "ottoauth-mock-poll";
const LOCAL_AGENT_RUNTIME_KEY = "localAgentRuntime";
const LOCAL_AGENT_LOG_LIMIT = 200;
const DEFAULTS = {
  pollEnabled: false,
  pollEndpoint: "https://ottoauth.vercel.app/api/computeruse/device/next-task",
  deviceId: "local-device-1",
  authToken: "",
  agentPairToken: "",
  llmBaseUrl: "https://api.openai.com",
  llmModel: "gpt-4.1-mini",
  llmApiKey: "",
  localAgentMaxSteps: 12,
  localAgentGoal: "",
  openInBackground: false,
  liveListenEnabled: false,
  lastTaskId: "",
  lastStatus: "Idle",
};

let liveListenLoopActive = false;
let localAgentRunning = false;
let localAgentAbortController = null;
let localAgentRuntimeCache = null;

function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

function setStorage(values) {
  return chrome.storage.local.set(values);
}

function buildDefaultLocalAgentRuntime() {
  return {
    isRunning: false,
    cancelRequested: false,
    sessionId: "",
    sessionTabId: null,
    sessionTabGroupId: null,
    goal: "",
    step: 0,
    status: "idle",
    startedAt: "",
    endedAt: "",
    lastError: "",
    lastResult: null,
    pendingPlan: null,
    logs: [],
    updatedAt: new Date().toISOString(),
  };
}

async function getLocalAgentRuntime() {
  if (localAgentRuntimeCache) return localAgentRuntimeCache;
  const stored = await getStorage([LOCAL_AGENT_RUNTIME_KEY]);
  const existing = stored?.[LOCAL_AGENT_RUNTIME_KEY];
  localAgentRuntimeCache =
    existing && typeof existing === "object"
      ? { ...buildDefaultLocalAgentRuntime(), ...existing, logs: Array.isArray(existing.logs) ? existing.logs : [] }
      : buildDefaultLocalAgentRuntime();
  return localAgentRuntimeCache;
}

async function broadcastLocalAgentRuntime() {
  const runtime = await getLocalAgentRuntime();
  try {
    await chrome.runtime.sendMessage({ type: "local_agent_runtime_update", runtime });
  } catch {
    // No open popup/sidepanel listener.
  }
}

async function saveLocalAgentRuntime(nextRuntime) {
  localAgentRuntimeCache = {
    ...buildDefaultLocalAgentRuntime(),
    ...nextRuntime,
    logs: Array.isArray(nextRuntime?.logs) ? nextRuntime.logs.slice(-LOCAL_AGENT_LOG_LIMIT) : [],
    updatedAt: new Date().toISOString(),
  };
  await setStorage({ [LOCAL_AGENT_RUNTIME_KEY]: localAgentRuntimeCache });
  await broadcastLocalAgentRuntime();
  return localAgentRuntimeCache;
}

async function patchLocalAgentRuntime(patch) {
  const current = await getLocalAgentRuntime();
  return saveLocalAgentRuntime({ ...current, ...patch });
}

async function appendLocalAgentLog(kind, message, data = null) {
  const current = await getLocalAgentRuntime();
  const entry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    kind: String(kind || "info"),
    message: safeString(String(message || ""), 500) || "Event",
    data: data ?? null,
  };
  const logs = [...(Array.isArray(current.logs) ? current.logs : []), entry].slice(-LOCAL_AGENT_LOG_LIMIT);
  return saveLocalAgentRuntime({ ...current, logs });
}

function summarizeObservationForLog(observation) {
  if (!observation || typeof observation !== "object") return {};
  const candidates = Array.isArray(observation.interactiveElements)
    ? observation.interactiveElements.slice(0, 8).map((el) => ({
        role: safeString(el?.role, 30),
        text: safeString(el?.text, 80),
        label: safeString(el?.label, 80),
      }))
    : [];
  return {
    url: safeString(observation.url, 300),
    title: safeString(observation.title, 120),
    pageKind: safeString(observation.pageKind, 40),
    activeModal: observation.activeModal
      ? {
          title: safeString(observation.activeModal.title, 120),
          text: safeString(observation.activeModal.text, 240),
          interactiveCount: Number(observation.activeModal.interactiveCount || 0),
        }
      : null,
    pageTextExcerpt: safeString(observation.pageTextExcerpt, 500),
    interactiveElements: candidates,
    interactiveCount: Array.isArray(observation.interactiveElements) ? observation.interactiveElements.length : 0,
    editableFields: Array.isArray(observation.editableFields)
      ? observation.editableFields.slice(0, 6).map((f) => ({
          kind: safeString(f.kind, 30),
          role: safeString(f.role, 20),
          label: safeString(f.label, 80),
        }))
      : [],
    formControls: Array.isArray(observation.formControls)
      ? observation.formControls.slice(0, 8).map((c) => ({
          kind: safeString(c.kind, 20),
          checked: Boolean(c.checked),
          id: safeString(c.id, 80),
          selector: safeString(c.selector, 140),
          group: safeString(c.group, 80),
          label: safeString(c.label, 100),
        }))
      : [],
    formControlStateHash: safeString(observation.formControlStateHash, 40),
    quizProgress: observation.quizProgress
      ? {
          answered: Number(observation.quizProgress.answered || 0),
          total: Number(observation.quizProgress.total || 0),
        }
      : null,
  };
}

async function requestLocalAgentStop() {
  if (localAgentAbortController) {
    try {
      localAgentAbortController.abort("User requested stop");
    } catch {
      // ignore
    }
  }
  await patchLocalAgentRuntime({
    cancelRequested: true,
    status: localAgentRunning ? "stop_requested" : "idle",
  });
  await appendLocalAgentLog("control", "Stop requested");
  return { ok: true };
}

async function openSidePanelForCurrentWindow() {
  if (!chrome.sidePanel?.open) {
    throw new Error("Chrome side panel API is unavailable");
  }
  const win = await chrome.windows.getLastFocused();
  if (!win?.id) throw new Error("No focused window found");
  try {
    await chrome.sidePanel.open({ windowId: win.id });
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("user gesture")) {
      return { ok: false, error: "Open the sidebar by clicking the extension icon (direct user gesture required)." };
    }
    throw error;
  }
  return { ok: true };
}

function configureSidePanelBehavior() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
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
  const goal =
    typeof task.goal === "string" ? task.goal :
    typeof task.taskPrompt === "string" ? task.taskPrompt :
    typeof task.task_prompt === "string" ? task.task_prompt :
    null;
  const id = typeof task.id === "string" || typeof task.id === "number" ? String(task.id) : "";

  if (type === "open_url" && url) return { id, type, url };
  if (type === "start_local_agent_goal" && goal && goal.trim()) {
    return { id, type, goal: goal.trim() };
  }
  return null;
}

async function handleDeliveredDeviceTask(task, sourceLabel) {
  const {
    lastTaskId,
    openInBackground,
  } = await getStorage(DEFAULTS);

  if (task.id && task.id === lastTaskId) {
    await setStatus(`Skipping duplicate task ${task.id}`);
    return { ok: true, duplicate: true, id: task.id };
  }

  if (task.type === "open_url") {
    let opened;
    try {
      opened = await openUrl(task.url, sourceLabel, Boolean(openInBackground));
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

  if (task.type === "start_local_agent_goal") {
    try {
      await initializeLocalChatSessionOnActiveTab({ source: "cloud_task" }).catch(() => null);
      await generateLocalAgentPlan(task.goal);
      if (task.id) {
        await setStorage({ lastTaskId: task.id });
        await reportTaskCompletion({
          taskId: task.id,
          status: "completed",
          summary: "Local browser-agent plan generated and awaiting user approval in the extension side panel.",
          url: null,
        });
      }
      await showNotification({
        title: "OttoAuth plan ready",
        message: "A cloud-triggered browser task is ready for plan approval in the side panel.",
      }).catch(() => null);
      return { ok: true, planned: true, id: task.id || null };
    } catch (error) {
      if (task.id) {
        await reportTaskCompletion({
          taskId: task.id,
          status: "failed",
          error: String(error?.message || error),
          url: null,
          summary: "Failed to generate local browser-agent plan",
        });
      }
      throw error;
    }
  }

  await setStatus(`Unhandled task type: ${String(task.type || "")}`);
  return { ok: false, error: "Unhandled task type" };
}

async function pollOnce() {
  const {
    pollEnabled,
    pollEndpoint,
    deviceId,
    authToken,
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
    await setStatus("No usable task in response");
    return { ok: true, empty: true };
  }
  return handleDeliveredDeviceTask(task, "poll");
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
          (typeof params?.summary === "string" && params.summary.trim()) ||
          (params?.status === "failed"
            ? "Extension task failed"
            : `Extension opened ${params?.url || "URL"}`),
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLlmBaseUrl(input) {
  const parsed = parseHttpUrl(input);
  if (!parsed) return null;
  try {
    const url = new URL(parsed);
    url.pathname = url.pathname.replace(/\/$/, "");
    return `${url.origin}`;
  } catch {
    return null;
  }
}

function safeString(value, maxLen = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function cheapTextHash(input) {
  const str = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function fingerprintAction(action) {
  if (!action || typeof action !== "object") return "unknown";
  const type = String(action.type || "").toLowerCase();
  if (type === "click_text") return `click_text:${String(action.text || "").trim().toLowerCase()}`;
  if (type === "click_selector") return `click_selector:${String(action.selector || "").trim()}`;
  if (type === "type_selector") return `type_selector:${String(action.selector || "").trim()}`;
  if (type === "open_url") return `open_url:${String(action.url || "").trim()}`;
  return `${type}:${JSON.stringify(action)}`;
}

function parseJsonFromModelText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Model returned empty response");

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  return JSON.parse(candidate);
}

function isGoogleDocsEditorUrl(url) {
  const value = String(url || "");
  return /^https:\/\/docs\.google\.com\/document\/d\/[^/]+\/edit/i.test(value);
}

function goalRequiresCreatingGoogleDoc(goal) {
  const g = String(goal || "").toLowerCase();
  return g.includes("google doc") && (g.includes("create") || g.includes("write") || g.includes("report"));
}

function inferPageKindFromObservation(observation) {
  const url = String(observation?.url || "");
  const title = String(observation?.title || "").toLowerCase();
  if (observation?.activeModal) return "modal";
  if (/docs\.google\.com\/document\/u\/0\/?$/.test(url)) return "google_docs_home";
  if (/docs\.google\.com\/document\/d\/[^/]+\/edit/i.test(url)) return "google_docs_editor";
  if (title.includes("youtube")) return "youtube";
  return "generic_page";
}

function didObservationMeaningfullyChange(beforeObs, afterObs) {
  if (!beforeObs || !afterObs) return false;
  if (String(beforeObs.url || "") !== String(afterObs.url || "")) return true;
  if (String(beforeObs.pageSignature || "") !== String(afterObs.pageSignature || "")) return true;
  if (String(beforeObs.formControlStateHash || "") !== String(afterObs.formControlStateHash || "")) return true;
  const beforeModal = Boolean(beforeObs.activeModal);
  const afterModal = Boolean(afterObs.activeModal);
  if (beforeModal !== afterModal) return true;
  const beforeFocused = String(beforeObs.focusedElement?.label || beforeObs.focusedElement?.role || "");
  const afterFocused = String(afterObs.focusedElement?.label || afterObs.focusedElement?.role || "");
  return beforeFocused !== afterFocused;
}

function classifyEditableTargetFromExec(execResult) {
  const role = String(execResult?.role || "").toLowerCase();
  const ariaLabel = String(execResult?.ariaLabel || "").toLowerCase();
  const tag = String(execResult?.tag || "").toLowerCase();
  if (ariaLabel.includes("search") || role === "combobox" || role === "searchbox") return "search";
  if (role === "textbox" || execResult?.mode?.includes("contenteditable")) return "rich_editor";
  if (tag === "textarea") return "textarea";
  if (tag === "input") return "input";
  return "unknown";
}

function verifyActionEffect({ action, beforeObs, afterObs, execResult }) {
  const type = String(action?.type || "").toLowerCase();
  const verification = {
    ok: true,
    code: "OK",
    message: "Action verified",
    details: {},
  };

  if (type === "open_url") {
    const expected = String(action?.url || "");
    const afterUrl = String(afterObs?.url || "");
    const beforeUrl = String(beforeObs?.url || "");
    if (!afterUrl || afterUrl === beforeUrl) {
      return {
        ok: false,
        code: "NO_NAVIGATION_CHANGE",
        message: "open_url did not change the page URL",
        details: { beforeUrl, afterUrl, expected },
      };
    }
    if (expected) {
      try {
        const expectedUrl = new URL(expected);
        const actualUrl = new URL(afterUrl);
        if (expectedUrl.hostname !== actualUrl.hostname) {
          return {
            ok: false,
            code: "WRONG_DESTINATION",
            message: "open_url navigated to a different host than requested",
            details: { expectedHost: expectedUrl.hostname, actualHost: actualUrl.hostname },
          };
        }
      } catch {
        // ignore parse failures
      }
    }
    return verification;
  }

  if (type === "click_text" || type === "click_selector" || type === "close_modal") {
    const changed = didObservationMeaningfullyChange(beforeObs, afterObs);
    if (!changed) {
      return {
        ok: false,
        code: "NO_PAGE_CHANGE",
        message: `${type} caused no visible page change`,
        details: {
          beforeUrl: beforeObs?.url || "",
          afterUrl: afterObs?.url || "",
          beforeFormControlStateHash: beforeObs?.formControlStateHash || "",
          afterFormControlStateHash: afterObs?.formControlStateHash || "",
        },
      };
    }
    return verification;
  }

  if (type === "type_selector") {
    const textLen = String(action?.text || "").length;
    const targetKind = classifyEditableTargetFromExec(execResult?.execResult || execResult || {});
    if (textLen > 80 && targetKind === "search") {
      return {
        ok: false,
        code: "WRONG_TARGET_KIND",
        message: "Long text was entered into a search-like field",
        details: { targetKind, textLen },
      };
    }
    const changed = didObservationMeaningfullyChange(beforeObs, afterObs);
    if (!changed && textLen > 0) {
      return {
        ok: false,
        code: "NO_VISIBLE_TEXT_CHANGE",
        message: "Typing produced no visible page change",
        details: { targetKind, textLen },
      };
    }
    return {
      ...verification,
      details: { targetKind, textLen },
    };
  }

  if (type === "wait") {
    return verification;
  }

  if (type === "done") {
    return verification;
  }

  return verification;
}

function validateDoneClaimFallback({ result }) {
  const summary = String(result?.summary || "").trim();
  if (!summary) {
    return { ok: false, code: "DONE_MISSING_SUMMARY", message: "done result summary is empty" };
  }
  return { ok: true, code: "OK", message: "done claim accepted by fallback validator" };
}

async function waitForTabLoad(tabId, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await sleep(250);
  }
  return chrome.tabs.get(tabId);
}

async function createLocalAgentSession(goal) {
  const tab = await chrome.tabs.create({
    // Start on an origin we can script; Chrome blocks content scripts on about:blank by default.
    url: "https://www.google.com/",
    active: true,
  });
  if (!tab?.id) {
    throw new Error("Failed to create local agent tab");
  }
  await waitForTabLoad(tab.id, 15000).catch(() => null);
  let tabGroupId = null;
  try {
    tabGroupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(tabGroupId, {
      title: "OttoAuth Agent",
      color: "blue",
      collapsed: false,
    });
  } catch (err) {
    console.warn("Failed to create tab group:", err);
  }

  return {
    id: `localsess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    goal,
    tabId: tab.id,
    tabGroupId,
    stepCount: 0,
    createdAt: new Date().toISOString(),
  };
}

async function initializeLocalChatSessionOnTab(tab, options = {}) {
  if (!tab?.id) {
    throw new Error("No active tab found to start a browser agent session");
  }
  if (localAgentRunning) {
    return { ok: true, skipped: true, reason: "agent_running" };
  }

  const tabId = tab.id;
  let tabGroupId = null;
  try {
    tabGroupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(tabGroupId, {
      title: "OttoAuth Agent",
      color: "blue",
      collapsed: false,
    });
  } catch (err) {
    console.warn("Failed to group current tab for local session:", err);
  }

  const sessionId = `localsess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const goal = "";
  await saveLocalAgentRuntime({
    isRunning: false,
    cancelRequested: false,
    sessionId,
    sessionTabId: tabId,
    sessionTabGroupId: tabGroupId ?? (typeof tab.groupId === "number" && tab.groupId >= 0 ? tab.groupId : null),
    goal,
    step: 0,
    status: "ready",
    startedAt: new Date().toISOString(),
    endedAt: "",
    lastError: "",
    lastResult: null,
    logs: [],
  });
  await appendLocalAgentLog("session", "Session attached to current tab", {
    sessionId,
    tabId,
    tabGroupId: tabGroupId ?? null,
    url: String(tab.url || ""),
    title: String(tab.title || ""),
    source: options?.source || "unknown",
  });
  await setStatus(`Local agent session ready on current tab (${sessionId})`);
  return { ok: true, sessionId, tabId, tabGroupId: tabGroupId ?? null };
}

async function initializeLocalChatSessionOnActiveTab(options = {}) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return initializeLocalChatSessionOnTab(tab, options);
}

async function captureObservation(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const currentUrl = String(tab?.url || "");
  if (!/^https?:/i.test(currentUrl)) {
    return {
      url: currentUrl || "",
      title: tab?.title || "",
      pageTextExcerpt: "",
      interactiveElements: [],
      note: "Current page is not scriptable by the extension. Navigate to an http/https page first.",
    };
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      function getRectArea(el) {
        const r = el?.getBoundingClientRect?.();
        if (!r) return 0;
        return Math.max(0, r.width) * Math.max(0, r.height);
      }

      function isVisible(el) {
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function cssEscapeMaybe(value) {
        if (!value) return "";
        try {
          return CSS.escape(value);
        } catch {
          return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
        }
      }

      function makeSelector(el) {
        if (!el || !el.tagName) return null;
        if (el.id) return `#${cssEscapeMaybe(el.id)}`;
        if (el.getAttribute("name")) {
          return `${el.tagName.toLowerCase()}[name="${String(el.getAttribute("name")).replace(/"/g, '\\"')}"]`;
        }
        if (el.getAttribute("aria-label")) {
          return `${el.tagName.toLowerCase()}[aria-label="${String(el.getAttribute("aria-label")).replace(/"/g, '\\"')}"]`;
        }
        let node = el;
        const parts = [];
        while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
          const tag = node.tagName.toLowerCase();
          let idx = 1;
          let sib = node;
          while ((sib = sib.previousElementSibling)) {
            if (sib.tagName === node.tagName) idx += 1;
          }
          parts.unshift(`${tag}:nth-of-type(${idx})`);
          node = node.parentElement;
        }
        return parts.length ? parts.join(" > ") : null;
      }

      function findActiveModal() {
        const candidates = Array.from(
          document.querySelectorAll(
            [
              "[role='dialog']",
              "[aria-modal='true']",
              ".modal",
              ".dialog",
              ".popup",
              "[class*='modal']",
              "[class*='dialog']",
              "[class*='overlay']",
            ].join(",")
          )
        ).filter((el) => isVisible(el));

        if (!candidates.length) return null;

        candidates.sort((a, b) => {
          const za = Number.parseInt(window.getComputedStyle(a).zIndex || "0", 10) || 0;
          const zb = Number.parseInt(window.getComputedStyle(b).zIndex || "0", 10) || 0;
          if (za !== zb) return zb - za;
          return getRectArea(b) - getRectArea(a);
        });

        return candidates[0] || null;
      }

      const activeModal = findActiveModal();

      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 5000);
      const rawCandidates = Array.from(
        document.querySelectorAll(
          [
            "button",
            "a",
            "input",
            "textarea",
            "select",
            "[role='button']",
            "[role='link']",
            "[role='menuitem']",
            "[role='option']",
            "[tabindex]",
          ].join(",")
        )
      )
        .filter((el) => isVisible(el))
        .map((el) => {
          const role = el.getAttribute("role") || el.tagName.toLowerCase();
          const label =
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            (el.labels && el.labels[0] ? el.labels[0].innerText : "") ||
            "";
          const textContent = (el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 140);
          return {
            role,
            text: textContent,
            label: String(label).trim().slice(0, 140),
            selector: makeSelector(el),
            tag: el.tagName.toLowerCase(),
            inModal: Boolean(activeModal && activeModal.contains(el)),
          };
        });

      rawCandidates.sort((a, b) => {
        if (a.inModal && !b.inModal) return -1;
        if (!a.inModal && b.inModal) return 1;
        return 0;
      });

      const candidates = rawCandidates.slice(0, 60);

      let modalInfo = null;
      if (activeModal) {
        const modalText = (activeModal.innerText || "").replace(/\s+/g, " ").trim();
        const modalTitleEl = activeModal.querySelector("h1, h2, h3, [role='heading']");
        modalInfo = {
          title: (modalTitleEl?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200),
          text: modalText.slice(0, 1200),
          interactiveCount: rawCandidates.filter((c) => c.inModal).length,
        };
      }

      const editableFields = rawCandidates
        .filter((el) => ["input", "textarea"].includes(el.tag) || el.role === "textbox" || el.role === "combobox")
        .slice(0, 12)
        .map((el) => {
          const labelLower = String(el.label || "").toLowerCase();
          const roleLower = String(el.role || "").toLowerCase();
          let kind = "input";
          if (roleLower === "combobox" || labelLower.includes("search")) kind = "search";
          else if (el.tag === "textarea" || roleLower === "textbox") kind = "editor";
          return {
            kind,
            role: el.role,
            label: el.label || "",
            text: el.text || "",
          };
        });

      function normalizeText(s) {
        return String(s || "").replace(/\s+/g, " ").trim();
      }

      function inferControlLabel(el) {
        return normalizeText(
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          (el.labels && el.labels[0] ? el.labels[0].innerText : "") ||
          el.closest("label")?.innerText ||
          el.parentElement?.innerText ||
          ""
        ).slice(0, 180);
      }

      const formControls = Array.from(
        document.querySelectorAll(
          [
            "input[type='radio']",
            "input[type='checkbox']",
            "[role='radio']",
            "[role='checkbox']",
          ].join(",")
        )
      )
        .filter((el) => isVisible(el))
        .slice(0, 80)
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute("role") || "";
          const type = tag === "input" ? (el.getAttribute("type") || "").toLowerCase() : role.toLowerCase();
          const checked = tag === "input"
            ? Boolean(el.checked)
            : String(el.getAttribute("aria-checked") || "").toLowerCase() === "true";
          return {
            kind: type || role || tag,
            checked,
            id: String(el.id || "").slice(0, 180),
            selector: makeSelector(el),
            group: String(el.getAttribute("name") || el.getAttribute("data-question-id") || "").slice(0, 180),
            name: String(el.getAttribute("name") || "").slice(0, 120),
            value: String(el.getAttribute("value") || "").slice(0, 160),
            label: inferControlLabel(el),
          };
        });

      const formControlStateSource = formControls
        .map((c) => `${c.kind}|${c.name}|${c.value}|${c.label}|${c.checked ? 1 : 0}`)
        .join("||");
      let formControlStateHash = "";
      if (formControlStateSource) {
        let h = 2166136261;
        for (let i = 0; i < formControlStateSource.length; i += 1) {
          h ^= formControlStateSource.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        formControlStateHash = (h >>> 0).toString(16);
      }

      const focused = document.activeElement;
      const focusedElement = focused && focused !== document.body
        ? {
            tag: focused.tagName?.toLowerCase() || "",
            role: focused.getAttribute?.("role") || "",
            label:
              focused.getAttribute?.("aria-label") ||
              focused.getAttribute?.("placeholder") ||
              focused.getAttribute?.("title") ||
              "",
          }
        : null;

      const pageSignature = [
        location.href,
        document.title || "",
        text.slice(0, 800),
        modalInfo ? modalInfo.title : "",
        modalInfo ? modalInfo.text.slice(0, 200) : "",
      ].join("|");

      let quizProgress = null;
      const progressMatch = text.match(/\b(\d+)\s*\/\s*(\d+)\s+Questions?\s+Answered\b/i);
      if (progressMatch) {
        quizProgress = {
          answered: Number(progressMatch[1] || 0),
          total: Number(progressMatch[2] || 0),
        };
      }

      return {
        url: location.href,
        title: document.title || "",
        pageTextExcerpt: text,
        interactiveElements: candidates,
        activeModal: modalInfo,
        editableFields,
        formControls: formControls.slice(0, 16),
        formControlStateHash,
        quizProgress,
        focusedElement,
        pageSignature: pageSignature,
        pageSignatureHash: (function () {
          let h = 2166136261;
          const s = pageSignature;
          for (let i = 0; i < s.length; i += 1) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return (h >>> 0).toString(16);
        })(),
      };
    },
  });

  const observation = result?.result ?? null;
  if (observation && typeof observation === "object") {
    observation.pageKind = inferPageKindFromObservation(observation);
    if (!observation.pageSignatureHash) {
      observation.pageSignatureHash = cheapTextHash(observation.pageSignature || `${observation.url}|${observation.title}|${observation.pageTextExcerpt || ""}`);
    }
    if (!observation.formControlStateHash && Array.isArray(observation.formControls) && observation.formControls.length) {
      observation.formControlStateHash = cheapTextHash(
        observation.formControls
          .map((c) => `${c.kind}|${c.name}|${c.value}|${c.label}|${c.checked ? 1 : 0}`)
          .join("||")
      );
    }
  }
  return observation;
}

async function executeLocalAgentAction(session, action) {
  const type = safeString(action?.type, 64).toLowerCase();
  if (!type) throw new Error("Action missing type");

  if (type === "done") {
    return { done: true, result: action?.result || { message: "Completed" } };
  }

  if (type === "open_url") {
    const url = parseHttpUrl(action?.url);
    if (!url) throw new Error("open_url requires a valid http/https url");
    await chrome.tabs.update(session.tabId, { url });
    await waitForTabLoad(session.tabId);
    return { ok: true, action: { type, url } };
  }

  if (type === "click_selector") {
    const selector = safeString(action?.selector, 500);
    if (!selector) throw new Error("click_selector requires selector");
    const [exec] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      args: [selector],
      func: (sel) => {
        function triggerRobustClick(target) {
          const rect = target.getBoundingClientRect();
          const clientX = rect.left + Math.min(rect.width / 2, Math.max(1, rect.width - 1));
          const clientY = rect.top + Math.min(rect.height / 2, Math.max(1, rect.height - 1));
          const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
          for (const eventName of events) {
            try {
              target.dispatchEvent(
                new MouseEvent(eventName, {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  clientX,
                  clientY,
                  button: 0,
                })
              );
            } catch {}
          }
          try { target.click(); } catch {}
        }
        function toClickableAncestor(el) {
          let cur = el;
          for (let i = 0; cur && i < 8; i += 1) {
            const role = (cur.getAttribute?.("role") || "").toLowerCase();
            const style = window.getComputedStyle(cur);
            if (
              ["A", "BUTTON"].includes(cur.tagName) ||
              ["button", "link", "menuitem", "option", "tab"].includes(role) ||
              typeof cur.onclick === "function" ||
              cur.hasAttribute?.("jsaction") ||
              cur.hasAttribute?.("aria-label") ||
              style.cursor === "pointer"
            ) {
              return cur;
            }
            cur = cur.parentElement;
          }
          return el;
        }
        function norm(s) {
          return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        }
        function isVisible(el) {
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        function findActiveModal() {
          const candidates = Array.from(
            document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal, .dialog, .popup, [class*='modal'], [class*='dialog']")
          ).filter((el) => isVisible(el));
          return candidates[0] || null;
        }
        function parseHasTextSelector(input) {
          // Supports a minimal Playwright-like selector pattern: tag:has-text('Text')
          const m = String(input || "").match(/^\s*([a-zA-Z0-9_\-\[\]=:'" .#]+?)\s*:has-text\((["'])(.*?)\2\)\s*$/);
          if (!m) return null;
          return { baseSelector: m[1].trim(), text: m[3] };
        }

        let el = null;
        try {
          el = document.querySelector(sel);
        } catch (err) {
          const parsed = parseHasTextSelector(sel);
          if (parsed) {
            let candidates;
            try {
              candidates = Array.from(document.querySelectorAll(parsed.baseSelector));
            } catch (innerErr) {
              return { ok: false, error: `Invalid selector syntax (${innerErr?.message || innerErr})`, code: "INVALID_SELECTOR" };
            }
            const modal = findActiveModal();
            const filtered = candidates.filter((node) => isVisible(node) && (!modal || modal.contains(node)));
            const targetText = norm(parsed.text);
            el =
              filtered.find((node) => norm(node.innerText || node.textContent) === targetText) ||
              filtered.find((node) => norm(node.innerText || node.textContent).includes(targetText)) ||
              null;
          } else {
            return { ok: false, error: `Invalid selector syntax (${err?.message || err})`, code: "INVALID_SELECTOR" };
          }
        }

        if (!el) return { ok: false, error: "Element not found" };
        const modal = findActiveModal();
        const clickable = toClickableAncestor(el);
        if (modal && !modal.contains(clickable)) {
          return { ok: false, error: "Element is outside the active modal" };
        }
        clickable.scrollIntoView({ block: "center", behavior: "instant" });
        triggerRobustClick(clickable);
        return {
          ok: true,
          matchedTag: el.tagName.toLowerCase(),
          clickedTag: clickable.tagName.toLowerCase(),
        };
      },
    });
    const result = exec?.result;
    if (!result?.ok) throw new Error(result?.error || result?.code || "click_selector failed");
    await sleep(500);
    return { ok: true, action: { type, selector } };
  }

  if (type === "click_text") {
    const text = safeString(action?.text, 200);
    if (!text) throw new Error("click_text requires text");
    const [exec] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      args: [text],
      func: (needle) => {
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const target = norm(needle);
        const triggerRobustClick = (targetEl) => {
          const rect = targetEl.getBoundingClientRect();
          const clientX = rect.left + Math.min(rect.width / 2, Math.max(1, rect.width - 1));
          const clientY = rect.top + Math.min(rect.height / 2, Math.max(1, rect.height - 1));
          for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
            try {
              targetEl.dispatchEvent(
                new MouseEvent(eventName, {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  clientX,
                  clientY,
                  button: 0,
                })
              );
            } catch {}
          }
          try { targetEl.click(); } catch {}
        };
        const isVisible = (el) => {
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const isClickable = (el) => {
          if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
          const role = (el.getAttribute("role") || "").toLowerCase();
          if (["button", "link", "menuitem", "option", "tab"].includes(role)) return true;
          if (["A", "BUTTON"].includes(el.tagName)) return true;
          if (typeof el.onclick === "function") return true;
          const tabindex = el.getAttribute("tabindex");
          if (tabindex !== null && Number(tabindex) >= 0) return true;
          const style = window.getComputedStyle(el);
          return style.cursor === "pointer";
        };
        const toClickableAncestor = (el) => {
          let cur = el;
          for (let i = 0; cur && i < 8; i += 1) {
            if (isVisible(cur) && isClickable(cur)) return cur;
            cur = cur.parentElement;
          }
          return el;
        };
        const all = Array.from(
          document.querySelectorAll(
            [
              "button",
              "a",
              "[role='button']",
              "[role='link']",
              "[role='menuitem']",
              "[role='option']",
              "[aria-label]",
              "[tabindex]",
              "div",
              "span",
            ].join(",")
          )
        );
        const visible = all.filter((el) => isVisible(el));
        const modal = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal, .dialog, .popup, [class*='modal'], [class*='dialog']"))
          .filter((el) => isVisible(el))[0] || null;
        const els = modal ? visible.filter((el) => modal.contains(el)) : visible;
        const readText = (el) => norm(el.innerText || el.textContent || "");
        const readLabel = (el) => norm(el.getAttribute("aria-label") || el.getAttribute("title") || "");
        const scoreMatch = (el) => {
          const t = readText(el);
          const l = readLabel(el);
          const exact = t === target || l === target;
          const partial = t.includes(target) || l.includes(target);
          if (!exact && !partial) return null;
          const raw = String(el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
          const clickable = toClickableAncestor(el);
          return {
            el,
            clickable,
            exact,
            rawLen: raw.length || 9999,
            clickableDepthPenalty: clickable === el ? 0 : 1,
          };
        };
        const ranked = els.map(scoreMatch).filter(Boolean)
          .sort((a, b) => {
            if (a.exact !== b.exact) return a.exact ? -1 : 1;
            if (a.clickableDepthPenalty !== b.clickableDepthPenalty) return a.clickableDepthPenalty - b.clickableDepthPenalty;
            return a.rawLen - b.rawLen;
          });
        const fallbackRanked = modal
          ? visible.map(scoreMatch).filter(Boolean)
              .sort((a, b) => {
                if (a.exact !== b.exact) return a.exact ? -1 : 1;
                if (a.clickableDepthPenalty !== b.clickableDepthPenalty) return a.clickableDepthPenalty - b.clickableDepthPenalty;
                return a.rawLen - b.rawLen;
              })
          : [];
        const best = ranked[0] || fallbackRanked[0] || null;
        const match = best?.el || null;
        const clickable = best?.clickable || null;
        if (!match) return { ok: false, error: "No clickable element with matching text" };
        clickable.scrollIntoView({ block: "center", behavior: "instant" });
        triggerRobustClick(clickable);
        return {
          ok: true,
          clickedTag: clickable.tagName.toLowerCase(),
          matchedText: (match.innerText || match.textContent || "").trim().slice(0, 200),
          exactMatch: Boolean(best?.exact),
        };
      },
    });
    const result = exec?.result;
    if (!result?.ok) throw new Error(result?.error || "click_text failed");
    await sleep(500);
    return { ok: true, action: { type, text } };
  }

  if (type === "type_selector") {
    const selector = safeString(action?.selector, 500);
    const text = typeof action?.text === "string" ? action.text : "";
    if (!selector) throw new Error("type_selector requires selector");
    const execs = await chrome.scripting.executeScript({
      target: { tabId: session.tabId, allFrames: true },
      args: [selector, text],
      func: (sel, value) => {
        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        function findActiveModal() {
          const candidates = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal, .dialog, .popup, [class*='modal'], [class*='dialog']"));
          for (const el of candidates) {
            if (isVisible(el)) return el;
          }
          return null;
        }
        function isEditable(el) {
          if (!el) return false;
          if ("value" in el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return true;
          if (el.isContentEditable) return true;
          const role = (el.getAttribute("role") || "").toLowerCase();
          if (role === "textbox") return true;
          return false;
        }
        function isSearchLike(el) {
          if (!el) return false;
          const role = (el.getAttribute("role") || "").toLowerCase();
          const text = String(
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.getAttribute("title") ||
            ""
          ).toLowerCase();
          if (text.includes("search")) return true;
          if (role === "searchbox" || role === "combobox") return true;
          return false;
        }
        function setEditableValue(el, nextValue) {
          el.focus();
          if ("value" in el && ["INPUT", "TEXTAREA"].includes(el.tagName)) {
            el.value = nextValue;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return { ok: true, mode: "value" };
          }
          if (el.isContentEditable || (el.getAttribute("role") || "").toLowerCase() === "textbox") {
            try {
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            } catch {}
            try {
              document.execCommand("selectAll", false);
              document.execCommand("insertText", false, nextValue);
              el.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
              return { ok: true, mode: "contenteditable_execCommand" };
            } catch {}
            el.textContent = nextValue;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            return { ok: true, mode: "contenteditable_textContent" };
          }
          return { ok: false, error: "Element is not editable" };
        }

        const modal = findActiveModal();
        let el = document.querySelector(sel);
        if (el && modal && !modal.contains(el)) {
          return { ok: false, error: "Input is outside the active modal", triedSelector: sel };
        }

        // Heuristic fallback for rich editors / Google Docs-like pages when selector misses.
        if (!el) {
          const candidates = Array.from(
            document.querySelectorAll(
              [
                "[contenteditable='true']",
                "[role='textbox']",
                "textarea",
                "input[type='text']",
                "input:not([type])",
              ].join(",")
            )
          ).filter((node) => isVisible(node) && isEditable(node));
          // Prefer rich editors first; avoid search/combobox fields for long text content.
          const richCandidates = candidates.filter((node) => node.isContentEditable || (node.getAttribute("role") || "").toLowerCase() === "textbox");
          const longText = String(value || "").length > 80;
          const nonSearchCandidates = longText ? candidates.filter((node) => !isSearchLike(node)) : candidates;
          el =
            candidates.find((node) => (document.activeElement && (node === document.activeElement || node.contains(document.activeElement)))) ||
            richCandidates[0] ||
            nonSearchCandidates[0] ||
            candidates[0] ||
            null;
        }

        if (!el) return { ok: false, error: "Element not found", triedSelector: sel };
        if (!isEditable(el)) return { ok: false, error: "Element is not an input-like field", triedSelector: sel };

        const setResult = setEditableValue(el, value);
        if (!setResult.ok) return setResult;
        const meta = {
          ok: true,
          mode: setResult.mode,
          tag: el.tagName.toLowerCase(),
          role: (el.getAttribute("role") || "").toLowerCase(),
          ariaLabel: String(el.getAttribute("aria-label") || "").slice(0, 120),
          usedFallback: !document.querySelector(sel),
        };
        // Defensive guard: if a long body of text was typed into a likely search field, surface failure.
        if (String(value || "").length > 80 && isSearchLike(el)) {
          return { ok: false, error: "Refusing to type long content into a search field", ...meta };
        }
        return meta;
      },
    });

    const successful = execs.find((res) => res?.result?.ok);
    if (!successful) {
      const firstError = execs.find((res) => res?.result && res.result.ok === false)?.result;
      throw new Error(firstError?.error || "type_selector failed");
    }
    return {
      ok: true,
      action: { type, selector },
      execResult: successful.result,
    };
  }

  if (type === "close_modal") {
    const [exec] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      func: () => {
        function isVisible(el) {
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        const modal = Array.from(
          document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal, .dialog, .popup, [class*='modal'], [class*='dialog']")
        ).find((el) => isVisible(el));
        if (!modal) return { ok: false, error: "No visible modal found" };

        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const closers = Array.from(modal.querySelectorAll("button, a, [role='button']"))
          .filter((el) => isVisible(el));
        const byText =
          closers.find((el) => ["close", "cancel", "done", "ok"].includes(norm(el.innerText || el.textContent))) ||
          closers.find((el) => {
            const t = norm(el.innerText || el.textContent);
            return t.includes("close") || t.includes("cancel");
          });
        const byAria = closers.find((el) => {
          const label = norm(el.getAttribute("aria-label") || "");
          return label.includes("close") || label.includes("dismiss");
        });
        const target = byText || byAria;
        if (target) {
          target.scrollIntoView({ block: "center", behavior: "instant" });
          target.click();
          return { ok: true, mode: "close-button" };
        }

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
        return { ok: true, mode: "escape" };
      },
    });
    const result = exec?.result;
    if (!result?.ok) throw new Error(result?.error || "close_modal failed");
    await sleep(400);
    return { ok: true, action: { type, mode: result.mode || "unknown" } };
  }

  if (type === "wait") {
    const ms = Math.max(100, Math.min(Number(action?.ms || 1000), 10000));
    await sleep(ms);
    return { ok: true, action: { type, ms } };
  }

  throw new Error(`Unsupported action type: ${type}`);
}

async function callOpenAiCompatiblePlanner(params) {
  const baseUrl = normalizeLlmBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Invalid LLM base URL");
  if (!params.apiKey) throw new Error("Missing LLM API key (BYOK)");
  if (!params.model) throw new Error("Missing model");

  const systemPrompt = [
    "You are a browser automation planner running inside a Chrome extension.",
    "Return exactly one JSON object and no markdown.",
    "Choose one action at a time.",
    "Supported actions:",
    '{"type":"open_url","url":"https://..."}',
    '{"type":"click_text","text":"..."}',
    '{"type":"click_selector","selector":"..."}',
    '{"type":"type_selector","selector":"...","text":"..."}',
    '{"type":"wait","ms":1000}',
    '{"type":"close_modal"}',
    '{"type":"done","result":{"summary":"..."}}',
    "Prefer click_text over click_selector when possible.",
    "If observation.formControls is present, prefer using the exact selector from a matching form control rather than inventing selectors.",
    "Do not re-click a form control that is already checked unless you intentionally want to toggle a checkbox off.",
    "For quizzes/multiple-choice forms, use observation.quizProgress and observation.formControls to make progress question by question.",
    "If you use click_selector/type_selector, use querySelector-compatible CSS selectors (do not use Playwright-only syntax except :has-text if absolutely necessary).",
    "If observation.activeModal exists, prioritize actions inside the modal or use close_modal.",
    "Do not ask the user to do the requested task for you.",
    "Only return done when the requested task is actually completed, or when you are concretely blocked.",
    "If the user asks you to review/proofread/check something, do the review yourself using the page text and return your findings in done.result.",
    "Do not return done just because you navigated to the page.",
    "Do not say 'you can now ...' unless you are explicitly handing off due to a real blocker.",
    "If blocked (login required, inaccessible content, captcha, missing permissions), return done with result.blocked=true and a short reason.",
    "If the page already satisfies the goal AND you have verified the requested outcome, return done with a concrete summary of what you verified.",
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      goal: params.goal,
      step: params.step,
      plannerFeedback: params.plannerFeedback || null,
      previousActions: params.previousActions || [],
      observation: params.observation,
    },
    null,
    2
  );

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    signal: params?.signal || undefined,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM API ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM response missing message content");
  }

  return parseJsonFromModelText(content);
}

async function callOpenAiCompatiblePlanGenerator(params) {
  const baseUrl = normalizeLlmBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Invalid LLM base URL");
  if (!params.apiKey) throw new Error("Missing LLM API key (BYOK)");
  if (!params.model) throw new Error("Missing model");

  const systemPrompt = [
    "You are planning a browser automation run before execution begins.",
    "Return exactly one JSON object and no markdown.",
    'Output schema: {"summary":"...", "steps":[{"title":"...","details":"..."}], "risks":["..."], "requires_confirmation_before":["..."]}',
    "Produce a short, concrete step-by-step plan for the current page and user goal.",
    "Do not execute actions. This is planning only.",
    "If the goal appears ambiguous (e.g. target item not present), mention that in risks and plan a search/navigation step.",
    "Keep steps concise (4-10 steps typically).",
  ].join("\n");

  const userPayload = {
    goal: params.goal,
    observation: params.observation || null,
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    signal: params?.signal || undefined,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Plan LLM API ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Plan LLM response missing message content");
  }

  const parsed = parseJsonFromModelText(content);
  const steps = Array.isArray(parsed?.steps)
    ? parsed.steps
        .slice(0, 12)
        .map((s, i) => ({
          title: safeString(String(s?.title || `Step ${i + 1}`), 160) || `Step ${i + 1}`,
          details: safeString(String(s?.details || ""), 500),
        }))
    : [];
  return {
    summary: safeString(String(parsed?.summary || ""), 500),
    steps,
    risks: Array.isArray(parsed?.risks) ? parsed.risks.slice(0, 8).map((r) => safeString(String(r), 300)).filter(Boolean) : [],
    requires_confirmation_before: Array.isArray(parsed?.requires_confirmation_before)
      ? parsed.requires_confirmation_before.slice(0, 8).map((r) => safeString(String(r), 300)).filter(Boolean)
      : [],
    raw: parsed,
  };
}

async function generateLocalAgentPlan(goalInput) {
  if (localAgentRunning) {
    throw new Error("A local browser agent session is already running");
  }
  const settings = await getStorage(DEFAULTS);
  const goal = safeString(goalInput || settings.localAgentGoal, 2000);
  if (!goal) throw new Error("Missing local agent goal");
  const session = await getContinuableLocalAgentSession(goal);
  await patchLocalAgentRuntime({
    goal,
    status: "planning_run",
    lastError: "",
    lastResult: null,
    pendingPlan: null,
    endedAt: "",
  });
  await appendLocalAgentLog("user", "Send message", {
    goal,
    mode: "continue",
    maxSteps: Math.max(1, Math.min(Number(settings.localAgentMaxSteps || 12), 200)),
  });
  await appendLocalAgentLog("session", "Planning run before execution", {
    sessionId: session.id,
    tabId: session.tabId,
    tabGroupId: session.tabGroupId ?? null,
    goal,
  });
  const observation = await captureObservation(session.tabId);
  await appendLocalAgentLog("observation", "Read browser state for planning", summarizeObservationForLog(observation));
  const plan = await callOpenAiCompatiblePlanGenerator({
    baseUrl: settings.llmBaseUrl,
    apiKey: settings.llmApiKey,
    model: settings.llmModel,
    goal,
    observation,
  });
  const pendingPlan = {
    createdAt: new Date().toISOString(),
    goal,
    summary: plan.summary || "",
    steps: plan.steps || [],
    risks: plan.risks || [],
    requiresConfirmationBefore: plan.requires_confirmation_before || [],
  };
  await patchLocalAgentRuntime({
    status: "awaiting_plan_approval",
    pendingPlan,
    goal,
  });
  await appendLocalAgentLog("plan", "Plan ready for approval", pendingPlan);
  await setStatus("Plan ready for approval");
  return { ok: true, pendingPlan };
}

async function approvePendingLocalAgentPlan() {
  const runtime = await getLocalAgentRuntime();
  const pendingPlan = runtime?.pendingPlan;
  if (!pendingPlan || typeof pendingPlan !== "object") {
    throw new Error("No pending plan to approve");
  }
  const goal = safeString(String(pendingPlan.goal || runtime.goal || ""), 2000);
  if (!goal) throw new Error("Pending plan is missing a goal");
  await appendLocalAgentLog("control", "Plan approved, starting execution", {
    approvedAt: new Date().toISOString(),
    goal,
  });
  await patchLocalAgentRuntime({
    pendingPlan: null,
    status: "starting_run",
  });
  return runLocalAgentGoal(goal, { mode: "continue", skipPlan: true });
}

async function callOpenAiCompatibleDoneChecker(params) {
  const baseUrl = normalizeLlmBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Invalid LLM base URL");
  if (!params.apiKey) throw new Error("Missing LLM API key (BYOK)");
  if (!params.model) throw new Error("Missing model");

  const systemPrompt = [
    "You are a completion verifier for a browser automation agent.",
    "Decide whether a proposed done result is actually supported by the evidence.",
    "Return exactly one JSON object and no markdown.",
    'Output schema: {"accept": boolean, "reason": string, "guidance": string}',
    "Reject when the agent claims task completion without sufficient evidence.",
    "Reject when the summary hands the task to the user instead of completing it.",
    "Prefer concrete reasons tied to the observations and recent actions.",
    "guidance should be a short next-step suggestion for the planner if accept=false.",
  ].join("\n");

  const payloadForChecker = {
    goal: params.goal,
    doneResult: params.doneResult || null,
    observationBeforeDone: params.beforeObs || null,
    observationAtDone: params.afterObs || null,
    recentActions: (params.previousActions || []).slice(-8),
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    signal: params?.signal || undefined,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payloadForChecker, null, 2) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Done-check LLM API ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Done-check LLM response missing message content");
  }

  const parsed = parseJsonFromModelText(content);
  return {
    ok: true,
    accept: Boolean(parsed?.accept),
    reason: safeString(String(parsed?.reason || ""), 500) || (parsed?.accept ? "Accepted" : "Rejected"),
    guidance: safeString(String(parsed?.guidance || ""), 500),
    raw: parsed,
  };
}

async function getContinuableLocalAgentSession(goal) {
  const runtime = await getLocalAgentRuntime();
  const sessionId = String(runtime?.sessionId || "").trim();
  const tabId = Number(runtime?.sessionTabId);
  if (!sessionId || !Number.isFinite(tabId)) {
    throw new Error("No active chat session. Click the extension icon to start one on this tab.");
  }
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error("The session tab is no longer available. Click the extension icon to start a new session.");
  }
  return {
    id: sessionId,
    goal,
    tabId,
    tabGroupId:
      typeof runtime?.sessionTabGroupId === "number" ? runtime.sessionTabGroupId :
      typeof tab?.groupId === "number" && tab.groupId >= 0 ? tab.groupId : null,
    stepCount: 0,
    createdAt: runtime?.startedAt || new Date().toISOString(),
    resumed: true,
  };
}

async function runLocalAgentGoal(goalInput, options = {}) {
  if (localAgentRunning) {
    throw new Error("A local browser agent session is already running");
  }
  localAgentRunning = true;
  const settings = await getStorage(DEFAULTS);
  const goal = safeString(goalInput || settings.localAgentGoal, 2000);
  if (!goal) throw new Error("Missing local agent goal");
  const mode = String(options?.mode || "new").toLowerCase() === "continue" ? "continue" : "new";
  const session =
    mode === "continue"
      ? await getContinuableLocalAgentSession(goal)
      : await createLocalAgentSession(goal);
  const previousActions = [];
  let plannerFeedback = null;
  const configuredMaxSteps = Number(settings.localAgentMaxSteps);
  const maxSteps = Math.max(1, Math.min(Number.isFinite(configuredMaxSteps) ? configuredMaxSteps : 12, 200));
  try {
    if (mode === "new") {
      await saveLocalAgentRuntime({
        isRunning: true,
        cancelRequested: false,
        sessionId: session.id,
        sessionTabId: session.tabId,
        sessionTabGroupId: session.tabGroupId ?? null,
        goal: session.goal,
        step: 0,
        status: "running",
        startedAt: new Date().toISOString(),
        endedAt: "",
        lastError: "",
        lastResult: null,
        pendingPlan: null,
        logs: [],
      });
    } else {
      await patchLocalAgentRuntime({
        isRunning: true,
        cancelRequested: false,
        sessionId: session.id,
        sessionTabId: session.tabId,
        sessionTabGroupId: session.tabGroupId ?? null,
        goal: session.goal,
        step: 0,
        status: "running",
        endedAt: "",
        lastError: "",
        lastResult: null,
        pendingPlan: null,
      });
    }
    await appendLocalAgentLog("user", mode === "new" ? "Create run" : "Send message", {
      goal: session.goal,
      mode,
      maxSteps,
    });
    await appendLocalAgentLog("session", mode === "new" ? "Started local browser agent session" : "Continuing local browser agent session", {
      sessionId: session.id,
      tabId: session.tabId,
      tabGroupId: session.tabGroupId ?? null,
      goal: session.goal,
    });
    await setStatus(`Local agent session started (${session.id})`);
    for (let step = 1; step <= maxSteps; step += 1) {
      const runtime = await getLocalAgentRuntime();
      if (runtime.cancelRequested) {
        throw new Error("Local browser agent stopped by user");
      }
      session.stepCount = step;
      await patchLocalAgentRuntime({ step, status: "reading_browser" });
      const observation = await captureObservation(session.tabId);
      if (!observation) {
        throw new Error("Failed to read browser observation");
      }
      await appendLocalAgentLog("observation", `Read browser state at step ${step}`, summarizeObservationForLog(observation));

      await patchLocalAgentRuntime({ status: "planning" });
      await setStatus(`Local agent step ${step}: planning`);
      localAgentAbortController = new AbortController();
      const action = await callOpenAiCompatiblePlanner({
        baseUrl: settings.llmBaseUrl,
        apiKey: settings.llmApiKey,
        model: settings.llmModel,
        goal: session.goal,
        step,
        plannerFeedback,
        previousActions,
        observation,
        signal: localAgentAbortController.signal,
      });
      plannerFeedback = null;
      localAgentAbortController = null;
      await appendLocalAgentLog("planner", `Planner chose ${safeString(action?.type, 60) || "action"}`, action);
      const actionFingerprint = fingerprintAction(action);
      const repeatedFailedCount = previousActions
        .slice(-6)
        .filter((a) => a && a.action && fingerprintAction(a.action) === actionFingerprint)
        .filter((a) => a?.execResult?.verificationFailed || a?.execResult?.code === "ACTION_EXECUTION_ERROR")
        .length;
      if (repeatedFailedCount >= 2) {
        const msg = `Action repeated after multiple failures: ${actionFingerprint}`;
        await appendLocalAgentLog("system", msg, { action, repeatedFailedCount });
        plannerFeedback = `${msg}. Do not repeat this same action/target. Try a different action or target.`;
        await patchLocalAgentRuntime({ status: "planning" });
        continue;
      }

      await patchLocalAgentRuntime({ status: "executing_action" });
      await setStatus(`Local agent step ${step}: ${safeString(action?.type, 40) || "action"}`);
      const observationBeforeAction = observation;
      let execResult;
      try {
        execResult = await executeLocalAgentAction(session, action);
      } catch (error) {
        const toolError = String(error?.message || error);
        const failure = {
          ok: false,
          code: "ACTION_EXECUTION_ERROR",
          message: toolError,
          actionType: safeString(action?.type, 60) || "unknown",
        };
        await appendLocalAgentLog(
          "system",
          `Action execution failed (${failure.actionType}): ${toolError}`,
          { action, failure }
        );
        plannerFeedback = `Previous action execution failed (${failure.actionType}): ${toolError}. Try a different action or target.`;
        await patchLocalAgentRuntime({ status: "planning" });
        previousActions.push({
          step,
          action,
          execResult: failure,
          observedUrl: observationBeforeAction?.url,
        });
        continue;
      }
      let observationAfterAction = observationBeforeAction;
      if (String(action?.type || "").toLowerCase() !== "done") {
        await patchLocalAgentRuntime({ status: "verifying_action" });
        observationAfterAction = await captureObservation(session.tabId);
      }
      const verification = verifyActionEffect({
        action,
        beforeObs: observationBeforeAction,
        afterObs: observationAfterAction,
        execResult,
      });
      await appendLocalAgentLog("action", `Executed ${safeString(action?.type, 60) || "action"}`, {
        action,
        execResult,
        verification,
      });
      if (!verification.ok) {
        await appendLocalAgentLog("system", `Rejected action result: ${verification.message}`, verification);
        plannerFeedback = `Previous action failed verification (${verification.code}): ${verification.message}`;
        await patchLocalAgentRuntime({ status: "planning" });
        previousActions.push({
          step,
          action,
          execResult: { ok: false, verificationFailed: true, verification },
          observedUrl: observationBeforeAction?.url,
        });
        continue;
      }
      previousActions.push({
        step,
        action,
        execResult,
        observedUrl: observationAfterAction?.url || observationBeforeAction?.url,
      });

      if (execResult?.done) {
        let doneValidation;
        try {
          doneValidation = await callOpenAiCompatibleDoneChecker({
            baseUrl: settings.llmBaseUrl,
            apiKey: settings.llmApiKey,
            model: settings.llmModel,
            goal: session.goal,
            doneResult: execResult.result || null,
            beforeObs: observationBeforeAction,
            afterObs: observationAfterAction,
            previousActions,
            signal: localAgentAbortController?.signal,
          });
        } catch (error) {
          doneValidation = validateDoneClaimFallback({ result: execResult.result || null });
          await appendLocalAgentLog("system", "LLM done-check failed; used fallback validator", {
            error: String(error?.message || error),
            fallback: doneValidation,
          });
        }
        if (!doneValidation.ok || doneValidation.accept === false) {
          const reason = doneValidation.message || doneValidation.reason || "Completion not supported by evidence";
          await appendLocalAgentLog("system", `Rejected done: ${reason}`, doneValidation);
          plannerFeedback = `Done was rejected: ${reason}${doneValidation.guidance ? `. Guidance: ${doneValidation.guidance}` : ""}`;
          await patchLocalAgentRuntime({ status: "planning" });
          continue;
        }
        if (
          goalRequiresCreatingGoogleDoc(session.goal) &&
          !isGoogleDocsEditorUrl(observationAfterAction?.url || observationBeforeAction?.url || "")
        ) {
          await appendLocalAgentLog(
            "system",
            "Rejected done: goal requires creating a Google Doc but the current page is not a Docs editor yet.",
            { observedUrl: observationAfterAction?.url || observationBeforeAction?.url || "" }
          );
          await patchLocalAgentRuntime({ status: "planning" });
          continue;
        }
        await patchLocalAgentRuntime({
          isRunning: false,
          status: "completed",
          endedAt: new Date().toISOString(),
          lastResult: execResult.result || null,
          cancelRequested: false,
          sessionTabId: session.tabId,
          sessionTabGroupId: session.tabGroupId ?? null,
        });
        await appendLocalAgentLog(
          "done",
          safeString(execResult?.result?.summary || "Completed", 200),
          execResult?.result || null
        );
        await setStatus(`Local agent done: ${safeString(execResult?.result?.summary || "Completed", 120)}`);
        return {
          ok: true,
          sessionId: session.id,
          tabId: session.tabId,
          tabGroupId: session.tabGroupId,
          result: execResult.result || null,
          steps: step,
        };
      }

      await waitForTabLoad(session.tabId, 5000).catch(() => null);
    }

    await patchLocalAgentRuntime({
      isRunning: false,
      status: "paused_max_steps",
      endedAt: new Date().toISOString(),
      lastError: "",
      cancelRequested: false,
      sessionTabId: session.tabId ?? null,
      sessionTabGroupId: session.tabGroupId ?? null,
    });
    await appendLocalAgentLog(
      "system",
      `Paused after reaching max steps (${maxSteps}). Increase Max Agent Steps or click Continue.`,
      { reason: "max_steps_reached", maxSteps }
    );
    await setStatus(`Local agent paused at max steps (${maxSteps})`);
    return {
      ok: true,
      paused: true,
      reason: "max_steps_reached",
      sessionId: session.id,
      tabId: session.tabId,
      tabGroupId: session.tabGroupId,
      steps: maxSteps,
    };
  } catch (error) {
    const message = String(error?.message || error);
    await patchLocalAgentRuntime({
      isRunning: false,
      status: /stopped by user/i.test(message) ? "stopped" : "failed",
      endedAt: new Date().toISOString(),
      lastError: message,
      cancelRequested: false,
      sessionTabId: session.tabId ?? null,
      sessionTabGroupId: session.tabGroupId ?? null,
    });
    await appendLocalAgentLog("error", message);
    throw error;
  } finally {
    localAgentAbortController = null;
    localAgentRunning = false;
  }
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
    await setStatus("Live wait returned no usable task");
    return { ok: true, empty: true };
  }
  return handleDeliveredDeviceTask(task, "live-listen");
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
  const runtime = await getLocalAgentRuntime();
  if (!runtime || typeof runtime !== "object") {
    await saveLocalAgentRuntime(buildDefaultLocalAgentRuntime());
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
  configureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  ensureDefaultsAndAlarm().catch((err) => {
    console.error("Failed to initialize on startup:", err);
  });
  configureSidePanelBehavior();
});

configureSidePanelBehavior();

chrome.action.onClicked.addListener((tab) => {
  void initializeLocalChatSessionOnTab(tab, { source: "action_click" }).catch((err) => {
    console.error("Failed to initialize local chat session from action click:", err);
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

    if (message.type === "generate_local_agent_plan") {
      if (localAgentRunning) {
        sendResponse({ ok: false, error: "A local browser agent session is already running" });
        return;
      }
      void generateLocalAgentPlan(message.goal).catch(async (err) => {
        console.error("Local agent plan generation failed:", err);
        await patchLocalAgentRuntime({
          status: "failed",
          lastError: String(err?.message || err),
        });
        await appendLocalAgentLog("error", String(err?.message || err));
        await setStatus(`Local agent plan error: ${String(err?.message || err)}`);
      });
      sendResponse({ ok: true, started: true, mode: "plan" });
      return;
    }

    if (message.type === "approve_local_agent_plan") {
      if (localAgentRunning) {
        sendResponse({ ok: false, error: "A local browser agent session is already running" });
        return;
      }
      void approvePendingLocalAgentPlan().catch(async (err) => {
        console.error("Approving local agent plan failed:", err);
        await patchLocalAgentRuntime({
          status: "failed",
          lastError: String(err?.message || err),
        });
        await appendLocalAgentLog("error", String(err?.message || err));
        await setStatus(`Local agent start error: ${String(err?.message || err)}`);
      });
      sendResponse({ ok: true, started: true, mode: "approved_plan" });
      return;
    }

    if (message.type === "run_local_agent_goal") {
      if (localAgentRunning) {
        sendResponse({ ok: false, error: "A local browser agent session is already running" });
        return;
      }
      void runLocalAgentGoal(message.goal, { mode: message.mode }).catch(async (err) => {
        console.error("Local agent run failed:", err);
        await setStatus(`Local agent error: ${String(err?.message || err)}`);
      });
      sendResponse({ ok: true, started: true, mode: String(message.mode || "new") });
      return;
    }

    if (message.type === "ensure_local_chat_session") {
      const result = await initializeLocalChatSessionOnActiveTab({ source: "sidepanel" });
      sendResponse(result);
      return;
    }

    if (message.type === "stop_local_agent") {
      const result = await requestLocalAgentStop();
      sendResponse(result);
      return;
    }

    if (message.type === "get_local_agent_runtime") {
      const runtime = await getLocalAgentRuntime();
      sendResponse({ ok: true, runtime });
      return;
    }

    if (message.type === "open_side_panel") {
      const result = await openSidePanelForCurrentWindow();
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
      if ("llmBaseUrl" in message) next.llmBaseUrl = String(message.llmBaseUrl ?? "");
      if ("llmModel" in message) next.llmModel = String(message.llmModel ?? "");
      if ("llmApiKey" in message) next.llmApiKey = String(message.llmApiKey ?? "");
      if ("localAgentMaxSteps" in message) {
        const parsed = Number(message.localAgentMaxSteps ?? DEFAULTS.localAgentMaxSteps);
        next.localAgentMaxSteps = Math.max(
          1,
          Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULTS.localAgentMaxSteps, 200)
        );
      }
      if ("localAgentGoal" in message) next.localAgentGoal = String(message.localAgentGoal ?? "");
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
