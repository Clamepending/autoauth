import type { BGMessage, BGResponse, SessionInfo } from '../shared/types';
import { STORAGE_KEY_SESSIONS } from '../shared/constants';

const attachedTabs = new Set<number>();
const consoleMessages = new Map<number, Array<{ type: string; text: string; timestamp: number }>>();
const networkRequests = new Map<number, Array<Record<string, unknown>>>();

const GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
  'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
];

const sessions = new Map<string, SessionInfo>();
const groupToSession = new Map<number, string>();
const sessionActiveTabs = new Map<string, number>();
let sessionCounter = 0;
let sessionsLoaded = false;

const sessionsReady = loadSessions();

async function loadSessions(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
    const stored = result[STORAGE_KEY_SESSIONS] as SessionInfo[] | undefined;
    if (stored?.length) {
      const existingGroups = new Set<number>();
      try {
        const groups = await chrome.tabGroups.query({});
        for (const g of groups) existingGroups.add(g.id);
      } catch { /* */ }

      for (const s of stored) {
        if (!existingGroups.has(s.groupId)) continue;
        sessions.set(s.id, s);
        groupToSession.set(s.groupId, s.id);
        const idx = parseInt(s.id.replace('session_', ''), 10);
        if (!isNaN(idx) && idx >= sessionCounter) sessionCounter = idx + 1;
      }
    }
  } finally {
    sessionsLoaded = true;
  }
}

async function ready(): Promise<void> {
  if (!sessionsLoaded) await sessionsReady;
}

async function persistSessions(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: Array.from(sessions.values()) });
}

function notifyPanels(message: { kind: 'session-removed'; sessionId: string } | { kind: 'session-created'; session: SessionInfo }): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function deleteSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  groupToSession.delete(session.groupId);
  sessionActiveTabs.delete(sessionId);
  await persistSessions();
  notifyPanels({ kind: 'session-removed', sessionId });
}

async function closeSession(sessionId: string, closeTabs = true): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;
  const groupId = session.groupId;
  await deleteSession(sessionId);
  if (closeTabs) {
    try {
      const tabs = await chrome.tabs.query({ groupId });
      const tabIds = tabs.map((tab) => tab.id).filter((tabId): tabId is number => typeof tabId === 'number');
      if (tabIds.length > 0) {
        await chrome.tabs.remove(tabIds);
      }
    } catch {
      // Session state is already removed; stale tabs can be ignored.
    }
  }
  return true;
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.tabGroups.onRemoved.addListener(async (group) => {
  await ready();
  const sid = groupToSession.get(group.id);
  if (!sid) return;
  await deleteSession(sid);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  consoleMessages.delete(tabId);
  networkRequests.delete(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

chrome.runtime.onMessage.addListener(
  (message: BGMessage, _sender, sendResponse: (r: BGResponse) => void) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return false;
    handleMessage(message).then(sendResponse);
    return true;
  },
);

async function handleMessage(msg: BGMessage): Promise<BGResponse> {
  await ready();
  try {
    switch (msg.type) {
      case 'cdp-attach': return await attachDebugger(msg.tabId);
      case 'cdp-detach': return await detachDebugger(msg.tabId);
      case 'cdp-detach-all': return await detachAll();
      case 'cdp-send': return await sendCDP(msg.tabId, msg.method, msg.params);
      case 'take-screenshot': return await takeScreenshot(msg.tabId);
      case 'navigate': return await navigateTab(msg.tabId, msg.url);
      case 'tabs-context': return await getTabsContext(msg.sessionId);
      case 'tabs-create': return await createTabInSession(msg.sessionId);
      case 'tabs-activate': return await activateTab(msg.tabId);
      case 'resize-window': return await resizeWindow(msg.tabId, msg.width, msg.height);
      case 'get-console-messages': return getConsoleMsgs(msg.tabId, msg.onlyErrors, msg.clear, msg.pattern, msg.limit);
      case 'get-network-requests': return getNetReqs(msg.tabId, msg.urlPattern, msg.clear, msg.limit);
      case 'enable-console-capture': return await enableConsole(msg.tabId);
      case 'enable-network-capture': return await enableNetwork(msg.tabId);
      case 'get-viewport-size': return await getViewportSize(msg.tabId);
      case 'session-get-active': return await getActiveSession();
      case 'session-get-all': return { success: true, data: Array.from(sessions.values()) };
      case 'session-request-create':
        return await createSession(msg.backgroundTab, msg.source, msg.autoCloseOnIdle);
      case 'session-close': {
        const closed = await closeSession(msg.sessionId);
        return { success: closed, error: closed ? undefined : 'Session not found' };
      }
      default: return { success: false, error: 'Unknown message type' };
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- Session management ---

function getSessionForTab(tab: chrome.tabs.Tab): SessionInfo | null {
  if (!tab.groupId || tab.groupId === -1 || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
  const sid = groupToSession.get(tab.groupId);
  return sid ? sessions.get(sid) ?? null : null;
}

async function getActiveSession(): Promise<BGResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { success: true, data: null };
  return { success: true, data: getSessionForTab(tab) };
}

async function createSession(
  backgroundTab = false,
  source: 'manual' | 'ottoauth' = 'manual',
  autoCloseOnIdle = false,
): Promise<BGResponse> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const seedTab = backgroundTab
    ? await chrome.tabs.create({ active: false, url: 'about:blank' })
    : activeTab;

  if (!seedTab?.id) return { success: false, error: 'No tab available to create session' };

  const existing = getSessionForTab(seedTab);
  if (existing) return { success: true, data: existing };

  const groupId = await chrome.tabs.group({ tabIds: [seedTab.id] });
  const id = `session_${++sessionCounter}`;
  const used = new Set(Array.from(sessions.values()).map((s) => s.color));
  const color = GROUP_COLORS.find((c) => !used.has(c)) || GROUP_COLORS[sessions.size % GROUP_COLORS.length];
  const name = `Agent ${sessionCounter}`;

  await chrome.tabGroups.update(groupId, { title: name, color, collapsed: false });

  const session: SessionInfo = {
    id,
    groupId,
    name,
    color,
    createdAt: Date.now(),
    source,
    autoCloseOnIdle,
  };
  sessions.set(id, session);
  groupToSession.set(groupId, id);
  sessionActiveTabs.set(id, seedTab.id);
  await persistSessions();
  notifyPanels({ kind: 'session-created', session });
  return { success: true, data: session };
}

async function getActiveSessionForCurrentTab(): Promise<SessionInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? getSessionForTab(tab) : null;
}

// --- Debugger ---

function wrapCb<T>(fn: (cb: (v: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((val) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(val);
    });
  });
}

async function attachDebugger(tabId: number): Promise<BGResponse> {
  if (attachedTabs.has(tabId)) return { success: true };
  await wrapCb<void>((cb) => chrome.debugger.attach({ tabId }, '1.3', () => cb(undefined as never)));
  attachedTabs.add(tabId);
  return { success: true };
}

async function detachDebugger(tabId: number): Promise<BGResponse> {
  if (!attachedTabs.has(tabId)) return { success: true };
  try { await wrapCb<void>((cb) => chrome.debugger.detach({ tabId }, () => cb(undefined as never))); } catch { /* */ }
  attachedTabs.delete(tabId);
  return { success: true };
}

async function detachAll(): Promise<BGResponse> {
  for (const tabId of [...attachedTabs]) await detachDebugger(tabId);
  return { success: true };
}

async function ensureAttached(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    const r = await attachDebugger(tabId);
    if (!r.success) throw new Error(r.error || 'Failed to attach');
  }
}

async function sendCDP(tabId: number, method: string, params?: Record<string, unknown>): Promise<BGResponse> {
  await ensureAttached(tabId);
  const data = await wrapCb<unknown>((cb) => chrome.debugger.sendCommand({ tabId }, method, params || {}, cb));
  return { success: true, data };
}

async function takeScreenshot(tabId: number): Promise<BGResponse> {
  const r = await sendCDP(tabId, 'Page.captureScreenshot', { format: 'png' });
  if (!r.success) return r;
  return { success: true, data: { screenshot: (r.data as { data: string }).data } };
}

async function navigateTab(tabId: number, url: string): Promise<BGResponse> {
  if (url === 'back') await chrome.tabs.goBack(tabId);
  else if (url === 'forward') await chrome.tabs.goForward(tabId);
  else {
    let u = url;
    if (!/^(https?:\/\/|chrome:\/\/)/.test(u)) u = 'https://' + u;
    await chrome.tabs.update(tabId, { url: u });
  }
  await waitForTabLoad(tabId);
  return { success: true };
}

function waitForTabLoad(tabId: number, timeout = 15000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(l); resolve(); } };
    const l = (id: number, info: { status?: string }) => { if (id === tabId && info.status === 'complete') finish(); };
    chrome.tabs.onUpdated.addListener(l);
    setTimeout(finish, timeout);
  });
}

function getSessionActiveTabId(sessionId: string, tabs: chrome.tabs.Tab[]): number | null {
  const remembered = sessionActiveTabs.get(sessionId);
  if (remembered && tabs.some((t) => t.id === remembered)) return remembered;
  const realActive = tabs.find((t) => t.active)?.id;
  if (realActive) {
    sessionActiveTabs.set(sessionId, realActive);
    return realActive;
  }
  const fallback = tabs.find((t) => t.id !== undefined)?.id ?? null;
  if (fallback) sessionActiveTabs.set(sessionId, fallback);
  return fallback;
}

async function getTabsContext(sessionId?: string): Promise<BGResponse> {
  const session = sessionId
    ? sessions.get(sessionId) ?? null
    : await getActiveSessionForCurrentTab();
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const scopedTabs = allTabs.filter(
    (t) => t.id !== undefined && (!session || t.groupId === session.groupId),
  );
  const sessionActiveTabId = session ? getSessionActiveTabId(session.id, scopedTabs) : null;
  const data = scopedTabs.map((t) => ({
    id: t.id!,
    url: t.url || '',
    title: t.title || '',
    active: session ? t.id === sessionActiveTabId : t.active,
    groupId: t.groupId ?? -1,
  }));
  return { success: true, data };
}

async function createTabInSession(sessionId?: string): Promise<BGResponse> {
  const session = sessionId
    ? sessions.get(sessionId) ?? null
    : await getActiveSessionForCurrentTab();
  const tab = await chrome.tabs.create({ active: false });
  if (session && tab.id) {
    try { await chrome.tabs.group({ tabIds: [tab.id], groupId: session.groupId }); } catch { /* */ }
  }
  return { success: true, data: { id: tab.id, url: tab.url || '', title: tab.title || '' } };
}

async function activateTab(tabId: number): Promise<BGResponse> {
  await chrome.tabs.update(tabId, { active: true });
  return { success: true };
}

async function resizeWindow(tabId: number, width: number, height: number): Promise<BGResponse> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId) await chrome.windows.update(tab.windowId, { width, height });
  return { success: true };
}

async function getViewportSize(tabId: number): Promise<BGResponse> {
  await ensureAttached(tabId);
  const r = await sendCDP(tabId, 'Page.getLayoutMetrics');
  if (!r.success) return r;
  const m = r.data as { cssVisualViewport?: { clientWidth: number; clientHeight: number }; visualViewport?: { clientWidth: number; clientHeight: number } };
  const vp = m.cssVisualViewport || m.visualViewport;
  return { success: true, data: vp ? { width: Math.round(vp.clientWidth), height: Math.round(vp.clientHeight) } : { width: 1280, height: 800 } };
}

// --- Console & Network ---

async function enableConsole(tabId: number): Promise<BGResponse> {
  if (!consoleMessages.has(tabId)) consoleMessages.set(tabId, []);
  await sendCDP(tabId, 'Runtime.enable');
  return { success: true };
}

async function enableNetwork(tabId: number): Promise<BGResponse> {
  if (!networkRequests.has(tabId)) networkRequests.set(tabId, []);
  await sendCDP(tabId, 'Network.enable');
  return { success: true };
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!tabId) return;
  const p = params as Record<string, unknown>;
  if (method === 'Runtime.consoleAPICalled') {
    const msgs = consoleMessages.get(tabId);
    if (msgs) {
      const args = (p.args as Array<{ value?: string; description?: string }>) || [];
      msgs.push({ type: String(p.type || 'log'), text: args.map((a) => a.value ?? a.description ?? '').join(' '), timestamp: Number(p.timestamp || Date.now()) });
      if (msgs.length > 1000) msgs.shift();
    }
  }
  if (method === 'Network.requestWillBeSent') {
    const reqs = networkRequests.get(tabId);
    if (reqs) {
      const req = p.request as Record<string, unknown> | undefined;
      reqs.push({ id: p.requestId, url: req?.url, method: req?.method, type: p.type, timestamp: p.timestamp });
      if (reqs.length > 1000) reqs.shift();
    }
  }
  if (method === 'Network.responseReceived') {
    const reqs = networkRequests.get(tabId);
    if (reqs) {
      const resp = p.response as Record<string, unknown> | undefined;
      const existing = reqs.find((r) => r.id === p.requestId);
      if (existing && resp) { existing.status = resp.status; existing.statusText = resp.statusText; existing.mimeType = resp.mimeType; }
    }
  }
});

function getConsoleMsgs(tabId: number, onlyErrors?: boolean, clear?: boolean, pattern?: string, limit?: number): BGResponse {
  let msgs = consoleMessages.get(tabId) || [];
  if (onlyErrors) msgs = msgs.filter((m) => m.type === 'error');
  if (pattern) { const re = new RegExp(pattern); msgs = msgs.filter((m) => re.test(m.text)); }
  const result = msgs.slice(-(limit || 100));
  if (clear) consoleMessages.set(tabId, []);
  return { success: true, data: result };
}

function getNetReqs(tabId: number, urlPattern?: string, clear?: boolean, limit?: number): BGResponse {
  let reqs = networkRequests.get(tabId) || [];
  if (urlPattern) { const re = new RegExp(urlPattern); reqs = reqs.filter((r) => re.test(String(r.url || ''))); }
  const result = reqs.slice(-(limit || 100));
  if (clear) networkRequests.set(tabId, []);
  return { success: true, data: result };
}
