import type { BGMessage, BGResponse } from '../shared/types';

const attachedTabs = new Set<number>();
const consoleMessages = new Map<number, Array<{ type: string; text: string; timestamp: number }>>();
const networkRequests = new Map<number, Array<Record<string, unknown>>>();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener(
  (message: BGMessage, _sender: chrome.runtime.MessageSender, sendResponse: (r: BGResponse) => void) => {
    handleMessage(message).then(sendResponse);
    return true;
  },
);

async function handleMessage(msg: BGMessage): Promise<BGResponse> {
  try {
    switch (msg.type) {
      case 'cdp-attach':
        return await attachDebugger(msg.tabId);
      case 'cdp-detach':
        return await detachDebugger(msg.tabId);
      case 'cdp-detach-all':
        return await detachAll();
      case 'cdp-send':
        return await sendCDP(msg.tabId, msg.method, msg.params);
      case 'take-screenshot':
        return await takeScreenshot(msg.tabId);
      case 'navigate':
        return await navigateTab(msg.tabId, msg.url);
      case 'tabs-context':
        return await getTabsContext();
      case 'tabs-create':
        return await createTab();
      case 'tabs-activate':
        return await activateTab(msg.tabId);
      case 'resize-window':
        return await resizeWindow(msg.tabId, msg.width, msg.height);
      case 'get-console-messages':
        return getConsoleMsgs(msg.tabId, msg.onlyErrors, msg.clear, msg.pattern, msg.limit);
      case 'get-network-requests':
        return getNetReqs(msg.tabId, msg.urlPattern, msg.clear, msg.limit);
      case 'enable-console-capture':
        return await enableConsole(msg.tabId);
      case 'enable-network-capture':
        return await enableNetwork(msg.tabId);
      case 'get-viewport-size':
        return await getViewportSize(msg.tabId);
      default:
        return { success: false, error: `Unknown message type` };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

function wrapChromeCallback<T>(
  fn: (resolve: (val: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((val: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(val);
      }
    });
  });
}

async function attachDebugger(tabId: number): Promise<BGResponse> {
  if (attachedTabs.has(tabId)) return { success: true };
  await wrapChromeCallback<void>((cb) => chrome.debugger.attach({ tabId }, '1.3', () => cb(undefined as never)));
  attachedTabs.add(tabId);
  return { success: true };
}

async function detachDebugger(tabId: number): Promise<BGResponse> {
  if (!attachedTabs.has(tabId)) return { success: true };
  try {
    await wrapChromeCallback<void>((cb) => chrome.debugger.detach({ tabId }, () => cb(undefined as never)));
  } catch {
    // already detached
  }
  attachedTabs.delete(tabId);
  return { success: true };
}

async function detachAll(): Promise<BGResponse> {
  const ids = [...attachedTabs];
  for (const tabId of ids) {
    await detachDebugger(tabId);
  }
  return { success: true };
}

async function ensureAttached(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    const r = await attachDebugger(tabId);
    if (!r.success) throw new Error(r.error || 'Failed to attach debugger');
  }
}

async function sendCDP(tabId: number, method: string, params?: Record<string, unknown>): Promise<BGResponse> {
  await ensureAttached(tabId);
  const data = await wrapChromeCallback<unknown>((cb) =>
    chrome.debugger.sendCommand({ tabId }, method, params || {}, cb),
  );
  return { success: true, data };
}

async function takeScreenshot(tabId: number): Promise<BGResponse> {
  const result = await sendCDP(tabId, 'Page.captureScreenshot', { format: 'png' });
  if (!result.success) return result;
  const cdpResult = result.data as { data: string };
  return { success: true, data: { screenshot: cdpResult.data } };
}

async function navigateTab(tabId: number, url: string): Promise<BGResponse> {
  if (url === 'back') {
    await chrome.tabs.goBack(tabId);
  } else if (url === 'forward') {
    await chrome.tabs.goForward(tabId);
  } else {
    let targetUrl = url;
    if (!/^(https?:\/\/|chrome:\/\/)/.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }
    await chrome.tabs.update(tabId, { url: targetUrl });
  }

  await waitForTabLoad(tabId);
  return { success: true };
}

function waitForTabLoad(tabId: number, timeout = 15000): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    const listener = (updatedId: number, info: { status?: string }) => {
      if (updatedId === tabId && info.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(done, timeout);
  });
}

async function getTabsContext(): Promise<BGResponse> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const data = tabs
    .filter((t) => t.id !== undefined)
    .map((t) => ({
      id: t.id!,
      url: t.url || '',
      title: t.title || '',
      active: t.active,
    }));
  return { success: true, data };
}

async function createTab(): Promise<BGResponse> {
  const tab = await chrome.tabs.create({ active: false });
  return {
    success: true,
    data: { id: tab.id, url: tab.url || '', title: tab.title || '' },
  };
}

async function activateTab(tabId: number): Promise<BGResponse> {
  await chrome.tabs.update(tabId, { active: true });
  return { success: true };
}

async function resizeWindow(tabId: number, width: number, height: number): Promise<BGResponse> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { width, height });
  }
  return { success: true };
}

async function getViewportSize(tabId: number): Promise<BGResponse> {
  await ensureAttached(tabId);
  const metrics = await sendCDP(tabId, 'Page.getLayoutMetrics');
  if (!metrics.success) return metrics;
  const m = metrics.data as {
    cssVisualViewport?: { clientWidth: number; clientHeight: number };
    visualViewport?: { clientWidth: number; clientHeight: number };
  };
  const vp = m.cssVisualViewport || m.visualViewport;
  if (vp) {
    return { success: true, data: { width: Math.round(vp.clientWidth), height: Math.round(vp.clientHeight) } };
  }
  return { success: true, data: { width: 1280, height: 800 } };
}

// --- Console & Network Capture ---

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
      msgs.push({
        type: String(p.type || 'log'),
        text: args.map((a) => a.value ?? a.description ?? '').join(' '),
        timestamp: Number(p.timestamp || Date.now()),
      });
      if (msgs.length > 1000) msgs.shift();
    }
  }

  if (method === 'Network.requestWillBeSent') {
    const reqs = networkRequests.get(tabId);
    if (reqs) {
      const req = p.request as Record<string, unknown> | undefined;
      reqs.push({
        id: p.requestId,
        url: req?.url,
        method: req?.method,
        type: p.type,
        timestamp: p.timestamp,
      });
      if (reqs.length > 1000) reqs.shift();
    }
  }

  if (method === 'Network.responseReceived') {
    const reqs = networkRequests.get(tabId);
    if (reqs) {
      const resp = p.response as Record<string, unknown> | undefined;
      const existing = reqs.find((r) => r.id === p.requestId);
      if (existing && resp) {
        existing.status = resp.status;
        existing.statusText = resp.statusText;
        existing.mimeType = resp.mimeType;
      }
    }
  }
});

function getConsoleMsgs(
  tabId: number,
  onlyErrors?: boolean,
  clear?: boolean,
  pattern?: string,
  limit?: number,
): BGResponse {
  let msgs = consoleMessages.get(tabId) || [];
  if (onlyErrors) msgs = msgs.filter((m) => m.type === 'error');
  if (pattern) {
    const re = new RegExp(pattern);
    msgs = msgs.filter((m) => re.test(m.text));
  }
  const result = msgs.slice(-(limit || 100));
  if (clear) consoleMessages.set(tabId, []);
  return { success: true, data: result };
}

function getNetReqs(tabId: number, urlPattern?: string, clear?: boolean, limit?: number): BGResponse {
  let reqs = networkRequests.get(tabId) || [];
  if (urlPattern) {
    const re = new RegExp(urlPattern);
    reqs = reqs.filter((r) => re.test(String(r.url || '')));
  }
  const result = reqs.slice(-(limit || 100));
  if (clear) networkRequests.set(tabId, []);
  return { success: true, data: result };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  consoleMessages.delete(tabId);
  networkRequests.delete(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});
