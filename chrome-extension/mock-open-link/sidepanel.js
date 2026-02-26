function $(id) {
  return document.getElementById(id);
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function pairStripEl() {
  return document.querySelector(".pairStrip");
}

let lastRenderedLogId = "";
let autosaveTimer = null;
let bootstrapping = true;
let latestRuntimeState = null;
let continueResumePending = false;
let approvePlanPending = false;
let planCardDismissedForPlanId = "";
let pairStripExpanded = false;
let planEditMode = false;
let planEditIdentity = "";
let planDraft = null;

const MODEL_CATALOG = {
  openai: [
    { id: "gpt-5.3-codex", label: "GPT 5.3-codex", description: "Coding-focused GPT-5 model" },
    { id: "gpt-5-thinking-high", label: "GPT-5-Thinking (High)", description: "High-reasoning GPT-5 mode" },
    { id: "gpt-5-mini", label: "GPT-5 mini", description: "Fast and efficient GPT-5 option" },
    { id: "gpt-5.2-pro", label: "GPT-5.2 Pro", description: "High-capability GPT-5.2 model" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", label: "Opus 4.6", description: "Most capable for ambitious work" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "Balanced performance and speed" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5", description: "Fastest for quick answers" },
  ],
  google: [
    { id: "gemini-3.1-pro", apiModel: "gemini-pro-latest", label: "Gemini 3.1 Pro", description: "Latest Gemini Pro alias" },
    { id: "gemini-3-flash", apiModel: "gemini-flash-latest", label: "Gemini 3 Flash", description: "Latest Gemini Flash alias" },
  ],
};

function providerLabel(p) {
  if (p === "anthropic") return "Anthropic";
  if (p === "google") return "Google";
  return "OpenAI";
}

function modelEntryForId(modelId) {
  const target = String(modelId || "");
  for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
    const match = (models || []).find((m) => m.id === target);
    if (match) return { provider, model: match };
  }
  return null;
}

function getConfiguredProvidersFromUi() {
  const configured = [];
  if ($("llmApiKey")?.value.trim()) configured.push("openai");
  if ($("anthropicApiKey")?.value.trim()) configured.push("anthropic");
  if ($("googleApiKey")?.value.trim()) configured.push("google");
  return configured;
}

function renderModelOptions(preferredModel) {
  const modelSelect = $("modelSelect");
  if (!modelSelect) return;

  const configuredProviders = getConfiguredProvidersFromUi();
  const providerPool = configuredProviders.length ? configuredProviders : ["openai"];
  modelSelect.innerHTML = "";

  const flatModels = [];
  for (const provider of providerPool) {
    const models = MODEL_CATALOG[provider] || [];
    for (const m of models) {
      flatModels.push({ provider, ...m });
    }
  }

  for (const m of flatModels) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.label} (${providerLabel(m.provider)})`;
    opt.title = m.description || "";
    modelSelect.appendChild(opt);
  }

  if (!flatModels.length) {
    const fallback = document.createElement("option");
    fallback.value = preferredModel || "";
    fallback.textContent = preferredModel || "No models";
    modelSelect.appendChild(fallback);
  }

  const selectedModel = flatModels.some((m) => m.id === preferredModel)
    ? preferredModel
    : (flatModels[0]?.id || preferredModel || "");
  modelSelect.value = selectedModel;
}

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

function shouldRenderLogInFeed(log) {
  const kind = String(log?.kind || "");
  const message = String(log?.message || "").toLowerCase();
  // Keep the visual feed clean and user-facing.
  // Full logs remain available in the debug transcript copy button.
  return (
    kind === "user" ||
    kind === "plan" ||
    kind === "action" ||
    kind === "done" ||
    kind === "error" ||
    (kind === "system" && (
      message.includes("paused after reaching max steps") ||
      message.includes("failed") ||
      message.includes("error")
    ))
  );
}

function titleCaseWords(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeActionLabel(actionType) {
  const t = String(actionType || "").trim().toLowerCase();
  if (!t) return "";
  if (t.startsWith("click")) return "Click";
  if (t.startsWith("type")) return "Type";
  if (t.startsWith("scroll")) return "Scroll";
  if (t.startsWith("wait")) return "Wait";
  if (t.startsWith("open_url")) return "Open URL";
  if (t.startsWith("press_key")) return "Press key";
  if (t.startsWith("extract")) return "Extract";
  if (t.startsWith("close_modal")) return "Close modal";
  if (t === "done") return "Done";
  return titleCaseWords(t.replace(/_/g, " "));
}

function compactLogMessage(log) {
  const kind = String(log?.kind || "");
  const data = log?.data ?? null;

  if (kind === "planner") {
    const actionType = data?.type;
    return normalizeActionLabel(actionType) || "Plan action";
  }

  if (kind === "action") {
    const actionType = data?.action?.type || data?.type;
    return normalizeActionLabel(actionType) || "Action";
  }

  if (kind === "done") {
    const summary =
      (data && typeof data.summary === "string" && data.summary.trim()) ||
      (typeof log?.message === "string" && log.message.trim()) ||
      "";
    return summary ? `Done: ${summary}` : "Done";
  }

  if (kind === "plan") {
    return "Create plan";
  }

  if (kind === "error") {
    return log?.message || "Error";
  }

  if (kind === "system") {
    const msg = String(log?.message || "");
    if (/paused after reaching max steps/i.test(msg)) return "Paused (max steps)";
    if (/^local agent done:/i.test(msg)) {
      return msg.replace(/^local agent done:\s*/i, "Done: ");
    }
    return msg || "System";
  }

  return log?.message || "Event";
}

function renderRuntime(runtime) {
  latestRuntimeState = runtime || null;
  const status = runtime?.status || "idle";
  document.body.classList.toggle("agentRunning", Boolean(runtime?.isRunning));
  document.querySelector(".layout")?.classList.toggle("agentRunning", Boolean(runtime?.isRunning));
  const runStatusEl = $("runStatus");
  if (runStatusEl) {
    runStatusEl.textContent = status.replace(/_/g, " ");
  }
  const meta = [];
  if (runtime?.step) meta.push(`step ${runtime.step}`);
  if (runtime?.isRunning) meta.push("running");
  if (runtime?.endedAt) meta.push(`ended ${formatTime(runtime.endedAt)}`);
  if (!meta.length) meta.push("No run yet");
  $("metaText").textContent = meta.join(" • ");
  updatePrimaryActionButton(runtime);
  updateApprovePlanButton(runtime);
  updateContinueMaxButton(runtime);
  renderPlanApprovalCard(runtime);

  const logs = Array.isArray(runtime?.logs) ? runtime.logs : [];
  const latestLogId = logs.length ? String(logs[logs.length - 1].id || "") : "";
  if (latestLogId === lastRenderedLogId && logs.length > 0) {
    return;
  }
  lastRenderedLogId = latestLogId;

  const feed = $("feed");
  feed.innerHTML = "";
  const visibleLogs = logs.filter(shouldRenderLogInFeed);

  if (!visibleLogs.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "";
    feed.appendChild(empty);
    return;
  }

  for (const log of visibleLogs) {
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
      : compactLogMessage(log);
    card.appendChild(body);

    feed.appendChild(card);
  }

  const isPlanningRun =
    runtime?.status === "planning_run" &&
    !runtime?.isRunning &&
    !runtime?.pendingPlan;
  if (isPlanningRun) {
    const loading = document.createElement("div");
    loading.className = "msg agent loading";
    loading.innerHTML =
      `<div class="meta"><span>agent</span><span>${formatTime(new Date().toISOString())}</span></div>` +
      `<div>Creating plan<span class="typingDots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></div>`;
    feed.appendChild(loading);
  }

  feed.scrollTop = feed.scrollHeight;
}

function fillList(listEl, items) {
  if (!listEl) return;
  listEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = String(item || "");
    listEl.appendChild(li);
  }
}

function normalizePlanListItem(item) {
  if (typeof item === "string") {
    const s = item.trim();
    return s || "";
  }
  if (!item || typeof item !== "object") return "";

  const preferredKeys = [
    "text",
    "label",
    "title",
    "step",
    "description",
    "summary",
    "reason",
    "note",
    "message",
    "action",
  ];
  for (const key of preferredKeys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  // Common structured step shape: { action, target, ... }
  const action = typeof item.action === "string" ? item.action.trim() : "";
  const target = typeof item.target === "string"
    ? item.target.trim()
    : (item.target && typeof item.target === "object"
        ? (typeof item.target.text === "string" ? item.target.text.trim() : "")
        : "");
  if (action || target) {
    return [action, target].filter(Boolean).join(": ");
  }

  return "";
}

function normalizePlanList(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizePlanListItem).filter(Boolean);
}

function buildPlanDraftFromPendingPlan(pendingPlan) {
  return {
    summary: String(pendingPlan?.summary || "").trim(),
    steps: normalizePlanList(pendingPlan?.steps),
    risks: normalizePlanList(pendingPlan?.risks),
    confirms: normalizePlanList(pendingPlan?.requiresConfirmationBefore),
  };
}

function ensurePlanDraft(identity, pendingPlan) {
  if (!identity || !pendingPlan) return null;
  if (planEditIdentity !== identity || !planDraft) {
    planEditIdentity = identity;
    planDraft = buildPlanDraftFromPendingPlan(pendingPlan);
  }
  return planDraft;
}

function readPlanDraftFromCard() {
  if (!planDraft) return null;
  const summaryEdit = $("planSummaryEdit");
  if (summaryEdit) {
    planDraft.summary = String(summaryEdit.value || "").trim();
  }

  const stepInputs = Array.from(document.querySelectorAll(".planStepEditInput"));
  if (stepInputs.length) {
    planDraft.steps = stepInputs.map((el) => String(el.value || "").trim()).filter(Boolean);
  }

  return {
    summary: planDraft.summary || "",
    steps: Array.isArray(planDraft.steps) ? planDraft.steps.slice() : [],
    risks: Array.isArray(planDraft.risks) ? planDraft.risks.slice() : [],
    requiresConfirmationBefore: Array.isArray(planDraft.confirms) ? planDraft.confirms.slice() : [],
  };
}

function renderPlanEditableList(listEl, items, inputClassName, placeholderPrefix) {
  if (!listEl) return;
  listEl.innerHTML = "";
  const rows = Array.isArray(items) && items.length ? items : [""];
  rows.forEach((value, index) => {
    const li = document.createElement("li");
    const input = document.createElement("input");
    input.type = "text";
    input.className = inputClassName;
    input.value = String(value || "");
    input.placeholder = `${placeholderPrefix} ${index + 1}`;
    li.appendChild(input);
    listEl.appendChild(li);
  });
}

function planIdentity(plan) {
  if (!plan || typeof plan !== "object") return "";
  return JSON.stringify({
    createdAt: plan.createdAt || "",
    goal: plan.goal || "",
    summary: plan.summary || "",
    steps: Array.isArray(plan.steps) ? plan.steps : [],
  });
}

function extractDomainsFromPlan(pendingPlan) {
  const texts = [];
  if (pendingPlan?.goal) texts.push(String(pendingPlan.goal));
  if (pendingPlan?.summary) texts.push(String(pendingPlan.summary));
  if (Array.isArray(pendingPlan?.steps)) texts.push(...pendingPlan.steps.map((s) => String(s || "")));

  const domains = new Set();
  const urlRegex = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi;
  const hostHintRegex = /\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi;

  for (const text of texts) {
    let m;
    while ((m = urlRegex.exec(text))) {
      domains.add(String(m[1]).toLowerCase());
    }
    while ((m = hostHintRegex.exec(text))) {
      const d = String(m[0]).toLowerCase();
      if (d.includes(".") && !d.endsWith(".json")) domains.add(d);
    }
  }

  return Array.from(domains).slice(0, 6);
}

function renderPlanApprovalCard(runtime) {
  const card = $("planApprovalCard");
  if (!card) return;
  const feedWrap = document.querySelector(".feedWrap");
  const pendingPlan = runtime?.pendingPlan && typeof runtime.pendingPlan === "object" ? runtime.pendingPlan : null;
  const identity = planIdentity(pendingPlan);
  if (identity && identity !== planCardDismissedForPlanId) {
    // New plan -> show card again even if user dismissed the previous one.
  } else if (!identity) {
    planCardDismissedForPlanId = "";
  }
  const show = runtime?.status === "awaiting_plan_approval" && !runtime?.isRunning && pendingPlan;
  const hiddenByDismiss = Boolean(identity && planCardDismissedForPlanId === identity);
  const showTakeover = Boolean(show && !hiddenByDismiss);
  card.classList.toggle("hidden", !show || hiddenByDismiss);
  card.classList.toggle("takeover", showTakeover);
  if (feedWrap) {
    feedWrap.classList.toggle("hidden", showTakeover);
  }

  if (!show) {
    planEditMode = false;
    if (!identity) {
      planEditIdentity = "";
      planDraft = null;
    }
  }

  const topApprove = $("planCardApproveBtn");
  if (topApprove) {
    topApprove.disabled = approvePlanPending || Boolean(runtime?.isRunning) || !show;
    topApprove.textContent = approvePlanPending ? "Approving..." : "Approve & Run";
  }
  const editBtn = $("planCardEditBtn");
  if (editBtn) {
    editBtn.textContent = planEditMode ? "Done editing" : "Make changes";
  }

  if (!show) return;

  if (
    planEditMode &&
    identity &&
    planEditIdentity === identity &&
    card.dataset.renderedPlanIdentity === identity &&
    card.querySelector("#planSummaryEdit, .planStepEditInput")
  ) {
    return;
  }

  const goal = String(pendingPlan.goal || "").trim();
  const subtitle = $("planApprovalSubtitle");
  if (subtitle) {
    subtitle.textContent = goal ? truncate(goal, 180) : "The agent generated a plan for this task.";
  }

  const draft = ensurePlanDraft(identity, pendingPlan);
  const summary = planEditMode && draft ? String(draft.summary || "").trim() : String(pendingPlan.summary || "").trim();
  const steps = planEditMode && draft ? normalizePlanList(draft.steps) : normalizePlanList(pendingPlan.steps);
  const domains = extractDomainsFromPlan(pendingPlan);

  $("planDomainsBlock")?.classList.toggle("hidden", !domains.length);
  $("planSummaryBlock")?.classList.toggle("hidden", !summary);
  $("planStepsBlock")?.classList.toggle("hidden", !steps.length);

  const summaryText = $("planSummaryText");
  if (summaryText) {
    if (planEditMode) {
      summaryText.innerHTML = "";
      const input = document.createElement("textarea");
      input.id = "planSummaryEdit";
      input.className = "planEditTextarea";
      input.rows = 2;
      input.value = summary;
      input.placeholder = "Plan summary";
      input.addEventListener("input", () => {
        if (!planDraft) return;
        planDraft.summary = String(input.value || "");
      });
      summaryText.appendChild(input);
    } else {
      summaryText.textContent = summary;
    }
  }
  if (planEditMode) {
    renderPlanEditableList($("planStepsList"), steps, "planStepEditInput", "Step");
    for (const [idx, input] of Array.from(document.querySelectorAll(".planStepEditInput")).entries()) {
      input.addEventListener("input", () => {
        if (!planDraft) return;
        const values = Array.from(document.querySelectorAll(".planStepEditInput"))
          .map((el) => String(el.value || ""))
          .filter((v, i, arr) => !(i === arr.length - 1 && !v.trim() && arr.length > 1));
        planDraft.steps = values;
      });
      if (idx === steps.length - 1 && String(input.value || "").trim()) {
        // Keep one blank row available while editing.
        input.addEventListener("blur", () => {
          if (!planEditMode) return;
          const current = Array.from(document.querySelectorAll(".planStepEditInput")).map((el) => String(el.value || ""));
          const hasBlank = current.some((v) => !v.trim());
          if (!hasBlank && latestRuntimeState) {
            if (planDraft) planDraft.steps = current;
            renderPlanApprovalCard(latestRuntimeState);
          }
        }, { once: true });
      }
    }
  } else {
    fillList($("planStepsList"), steps);
  }

  const domainsEl = $("planDomainsList");
  if (domainsEl) {
    domainsEl.innerHTML = "";
    for (const domain of domains) {
      const chip = document.createElement("div");
      chip.className = "domainChip";
      chip.textContent = domain;
      domainsEl.appendChild(chip);
    }
  }
  card.dataset.renderedPlanIdentity = identity || "";
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
  if (show) {
    btn.textContent = approvePlanPending ? "Approving..." : "Approve Plan";
  }
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
  if (!next) {
    pairStripExpanded = true;
  }
  syncPairStripUi();
}

function setPairingStatus(text) {
  const el = $("pairingStatusText");
  if (el) {
    el.textContent = text || "Generate a browser token, then give it to your agent once.";
  }
}

function syncPairStripUi() {
  const strip = pairStripEl();
  if (!strip) return;
  const token = String($("agentPairToken")?.dataset?.token || "").trim();
  const isPaired = Boolean(token);
  strip.classList.toggle("isPaired", isPaired);
  strip.classList.toggle("isCollapsed", isPaired && !pairStripExpanded);
}

function autoResizeGoalInput() {
  const el = $("goalInput");
  if (!el) return;
  el.style.height = "0px";
  const max = 160;
  const nextHeight = Math.min(Math.max(el.scrollHeight, 38), max);
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
}

async function loadSettings() {
  const response = await sendMessage({ type: "get_settings" });
  if (!response?.ok) throw new Error(response?.error || "Failed to load settings");
  const s = response.settings || {};
  $("goalInput").value = s.localAgentGoal || "";
  autoResizeGoalInput();
  if ($("llmBaseUrl")) $("llmBaseUrl").value = s.llmBaseUrl || "";
  $("llmApiKey").value = s.llmApiKey || "";
  $("anthropicApiKey").value = s.anthropicApiKey || "";
  $("googleApiKey").value = s.googleApiKey || "";
  $("approvalModeSelect").value = s.planApprovalMode === "act_without_asking" ? "act_without_asking" : "ask_first";
  $("localAgentMaxSteps").value = String(s.localAgentMaxSteps ?? 12);
  $("pollEndpoint").value = s.pollEndpoint || "";
  $("deviceId").value = s.deviceId || "";
  $("liveListenEnabled").checked = Boolean(s.liveListenEnabled);
  setPairToken(s.agentPairToken || "");
  setPairingStatus(s.agentPairToken ? "Share this token with your agent, then call register-device once." : "Generate a browser token, then give it to your agent once.");
  renderModelOptions(String(s.llmModel || ""));
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

async function clearChatFeed() {
  const response = await sendMessage({ type: "clear_local_agent_chat" });
  if (!response?.ok) throw new Error(response?.error || "Failed to clear chat");
  setPairingStatus("Chat cleared");
}

async function saveByokSettings() {
  const parsedMaxSteps = Number.parseInt($("localAgentMaxSteps").value.trim() || "12", 10);
  const model = $("modelSelect")?.value || "";
  const inferredProvider = modelEntryForId(model)?.provider || "openai";
  const response = await sendMessage({
    type: "save_settings",
    llmBaseUrl: $("llmBaseUrl")?.value.trim() || "",
    llmProvider: inferredProvider,
    llmModel: model,
    llmApiKey: $("llmApiKey").value.trim(),
    anthropicApiKey: $("anthropicApiKey").value.trim(),
    googleApiKey: $("googleApiKey").value.trim(),
    planApprovalMode: $("approvalModeSelect")?.value || "ask_first",
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
  const approvalMode = String($("approvalModeSelect")?.value || "ask_first");
  let response;
  if (approvalMode === "act_without_asking") {
    setOptimisticRunningUi(true);
    response = await sendMessage({ type: "run_local_agent_goal", goal, mode });
    if (!response?.ok) {
      setOptimisticRunningUi(false);
      throw new Error(response?.error || "Failed to start local agent");
    }
  } else {
    response = await sendMessage({ type: "generate_local_agent_plan", goal, mode });
    if (!response?.ok) throw new Error(response?.error || "Failed to generate plan");
  }
  inputEl.value = "";
  autoResizeGoalInput();
}

async function stopAgent() {
  setOptimisticRunningUi(false);
  const response = await sendMessage({ type: "stop_local_agent" });
  if (!response?.ok) throw new Error(response?.error || "Failed to stop local agent");
}

function setOptimisticRunningUi(isRunning) {
  const base = latestRuntimeState && typeof latestRuntimeState === "object" ? latestRuntimeState : {};
  const next = { ...base, isRunning: Boolean(isRunning) };
  latestRuntimeState = next;
  updatePrimaryActionButton(next);
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
    setOptimisticRunningUi(true);
    const response = await sendMessage({
      type: "run_local_agent_goal",
      goal: String(latestRuntimeState?.goal || ""),
      mode: "continue",
    });
    if (!response?.ok) {
      setOptimisticRunningUi(false);
      throw new Error(response?.error || "Failed to continue run");
    }
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
    planCardDismissedForPlanId = "";
    const editedPlan = planEditMode ? readPlanDraftFromCard() : null;
    setOptimisticRunningUi(true);
    const response = await sendMessage({ type: "approve_local_agent_plan", editedPlan });
    if (!response?.ok) {
      setOptimisticRunningUi(false);
      throw new Error(response?.error || "Failed to approve plan");
    }
    planEditMode = false;
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

  const pairingStrip = pairStripEl();
  if (pairingStrip) {
    pairingStrip.addEventListener("click", (event) => {
      const token = String($("agentPairToken")?.dataset?.token || "").trim();
      if (!token) return;
      if (event.target.closest("button")) return;
      pairStripExpanded = !pairStripExpanded;
      syncPairStripUi();
    });
  }

  $("copyChatDebugBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await copyChatDebugTranscript();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("clearChatBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await clearChatFeed();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("refreshBtn")?.addEventListener("click", () => {
    void (async () => {
      try {
        await loadSettings();
        await loadRuntime();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("modelSelect").addEventListener("change", scheduleAutosave);
  $("approvalModeSelect").addEventListener("change", scheduleAutosave);

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

  $("planCardApproveBtn").addEventListener("click", () => {
    void (async () => {
      try {
        await approvePlan();
      } catch (error) {
        setUiError(error);
      }
    })();
  });

  $("planCardEditBtn").addEventListener("click", () => {
    if (latestRuntimeState?.status === "awaiting_plan_approval" && latestRuntimeState?.pendingPlan) {
      if (planEditMode) {
        readPlanDraftFromCard();
      }
      planEditMode = !planEditMode;
      renderPlanApprovalCard(latestRuntimeState);
      if (planEditMode) {
        const first = $("planSummaryEdit") || document.querySelector(".planStepEditInput");
        if (first && typeof first.focus === "function") first.focus();
      }
      return;
    }
    const goalInput = $("goalInput");
    if (goalInput) {
      goalInput.focus();
      goalInput.select();
    }
  });

  $("planCardDismissBtn").addEventListener("click", () => {
    const pendingPlan = latestRuntimeState?.pendingPlan;
    const identity = planIdentity(pendingPlan);
    if (identity) {
      planCardDismissedForPlanId = identity;
      renderPlanApprovalCard(latestRuntimeState);
    }
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

  for (const id of ["goalInput", "llmBaseUrl", "llmApiKey", "anthropicApiKey", "googleApiKey", "localAgentMaxSteps"]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", scheduleAutosave);
    el.addEventListener("change", scheduleAutosave);
    el.addEventListener("blur", scheduleAutosave);
  }

  $("goalInput").addEventListener("input", autoResizeGoalInput);

  for (const id of ["llmApiKey", "anthropicApiKey", "googleApiKey"]) {
    $(id).addEventListener("input", () => {
      renderModelOptions($("modelSelect")?.value || "");
    });
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

  autoResizeGoalInput();

  window.setInterval(() => {
    void loadRuntime().catch(() => {});
  }, 1000);
});
