import type { ToolResultContent, TabInfo } from '../../shared/types';
import { sendToBackground } from '../../shared/messaging';
import { resizeScreenshotForModel } from '../../shared/imageUtils';
import { KEY_DEFINITIONS, SCROLL_PIXELS_PER_TICK, CLICK_DELAY_MS, MAX_A11Y_CHARS, MAX_A11Y_DEPTH, MAX_PAGE_TEXT_CHARS } from '../../shared/constants';
import { generateAccessibilityTree } from '../../content/accessibilityTree';
import { setFormValue } from '../../content/formHandler';
import { extractPageText } from '../../content/pageText';
import { useStore } from '../store';
import { permissionManager } from './permissions';
import Anthropic from '@anthropic-ai/sdk';

const screenshotStore = new Map<string, string>();
let screenshotCounter = 0;
let _screenshotSessionId: string | undefined;

function textResult(text: string): ToolResultContent[] {
  return [{ type: 'text', text }];
}

function imageResult(data: string): ToolResultContent[] {
  return [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }];
}

function getActiveTabId(): number {
  const id = useStore.getState().activeTabId;
  if (!id) throw new Error('No active tab. Open a tab first.');
  return id;
}

function getViewport() {
  return useStore.getState().viewportSize;
}

function shouldBringTabToFront(sessionId?: string): boolean {
  if (!sessionId) return true;
  const session = useStore.getState().sessionInfos[sessionId];
  return session?.source !== 'ottoauth';
}

function validateCoordinateInViewport(x: number, y: number): string | null {
  const vp = getViewport();
  if (x < 0 || y < 0 || x >= vp.width || y >= vp.height) {
    return `Coordinate [${x}, ${y}] is outside viewport ${vp.width}x${vp.height}. Take a fresh screenshot and use coordinates inside that image.`;
  }
  return null;
}

async function getTabUrl(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || '';
  } catch {
    return '';
  }
}

function isRestrictedUrl(url: string): boolean {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-search://') ||
    url.startsWith('devtools://') ||
    url === ''
  );
}

async function checkTabAccess(tabId: number, toolName: string): Promise<string | null> {
  const url = await getTabUrl(tabId);
  if (isRestrictedUrl(url)) {
    return `Cannot access ${url || 'this page'} — browser system pages block extension access. Use the navigate tool to go to a regular webpage first (e.g. navigate to "https://google.com").`;
  }
  return null;
}

async function takeScreenshot(tabId: number): Promise<ToolResultContent[]> {
  const blocked = await checkTabAccess(tabId, 'screenshot');
  if (blocked) return textResult(blocked);

  const resp = await sendToBackground({ type: 'take-screenshot', tabId });
  if (!resp.success) return textResult(`Screenshot failed: ${resp.error}`);
  const raw = (resp.data as { screenshot: string }).screenshot;
  const vp = getViewport();

  const displayDpr = window.devicePixelRatio || 1;
  let pageZoom = 1;
  const metricsResp = await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'Page.getLayoutMetrics',
  });
  if (metricsResp.success) {
    const m = metricsResp.data as { cssVisualViewport?: { pageScaleFactor?: number } };
    pageZoom = m.cssVisualViewport?.pageScaleFactor || 1;
  }
  const dpr = displayDpr * pageZoom;

  const resized = await resizeScreenshotForModel(raw, vp.width, vp.height, dpr);

  screenshotCounter++;
  const imgId = `screenshot_${screenshotCounter}`;
  screenshotStore.set(imgId, resized.data);

  useStore.getState().appendToLastAssistant({ type: 'screenshot', data: resized.data }, _screenshotSessionId);
  return imageResult(resized.data);
}

function parseModifiers(modifiers?: string): number {
  if (!modifiers) return 0;
  let flags = 0;
  const mods = modifiers.toLowerCase().split('+');
  if (mods.includes('alt')) flags |= 1;
  if (mods.includes('ctrl') || mods.includes('control')) flags |= 2;
  if (mods.includes('meta') || mods.includes('cmd') || mods.includes('command')) flags |= 4;
  if (mods.includes('shift')) flags |= 8;
  return flags;
}

const BUTTON_TO_BUTTONS: Record<string, number> = { left: 1, right: 2, middle: 4 };

async function resolveRefToCoordinate(tabId: number, ref: string): Promise<[number, number] | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (refId: string) => {
      const w = window as unknown as { __claudeElementMap?: Record<string, WeakRef<Element>> };
      const el = w.__claudeElementMap?.[refId]?.deref();
      if (!el) return null;
      (el as HTMLElement).scrollIntoView?.({ behavior: 'instant', block: 'center' });
      const rect = el.getBoundingClientRect();
      return [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)];
    },
    args: [ref],
  });
  return results?.[0]?.result as [number, number] | null;
}

async function performClick(
  tabId: number,
  action: string,
  coordinate: [number, number] | undefined,
  modifiers?: string,
  ref?: string,
): Promise<ToolResultContent[]> {
  let coords = coordinate;
  if (!coords && ref) {
    const resolved = await resolveRefToCoordinate(tabId, ref);
    if (!resolved) return textResult(`Error: ref ${ref} not found. Run read_page first.`);
    coords = resolved;
  }
  if (!coords) return textResult('Error: No coordinate or ref provided for click.');

  const x = Math.round(coords[0]);
  const y = Math.round(coords[1]);
  const coordError = validateCoordinateInViewport(x, y);
  if (coordError) return textResult(coordError);
  const button = action === 'right_click' ? 'right' : 'left';
  const buttons = BUTTON_TO_BUTTONS[button] || 1;
  const clickCount = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
  const modifierFlags = parseModifiers(modifiers);

  await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseMoved', x, y, modifiers: modifierFlags },
  });
  await delay(CLICK_DELAY_MS);

  for (let i = 1; i <= clickCount; i++) {
    await sendToBackground({
      type: 'cdp-send', tabId,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mousePressed', x, y, button, buttons, clickCount: i, modifiers: modifierFlags },
    });
    await sendToBackground({
      type: 'cdp-send', tabId,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: i, modifiers: modifierFlags },
    });
  }

  let fallbackNote = '';
  if (action === 'left_click' && !modifiers) {
    const fallbackResults = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (cx: number, cy: number) => {
        const target = document.elementFromPoint(cx, cy) as HTMLElement | null;
        if (!target) return 'fallback: no element at coordinate';

        const clickable = target.closest(
          'button, a, [role="button"], input[type="submit"], input[type="button"]',
        ) as HTMLElement | null;
        if (!clickable) return 'fallback: target is not button-like';

        const disabled =
          (clickable as HTMLButtonElement).disabled ||
          clickable.getAttribute('aria-disabled') === 'true';
        if (disabled) return 'fallback: target is disabled';

        clickable.click();
        const label = (clickable.textContent || clickable.getAttribute('aria-label') || '').trim().slice(0, 80);
        return `fallback: dom click dispatched on <${clickable.tagName.toLowerCase()}> "${label}"`;
      },
      args: [x, y],
    });
    fallbackNote = (fallbackResults?.[0]?.result as string) || 'fallback: unavailable';
  }

  await delay(300);
  const screenshot = await takeScreenshot(tabId);
  if (!fallbackNote) return screenshot;
  return [{ type: 'text', text: fallbackNote }, ...screenshot];
}

async function performHover(tabId: number, coordinate: [number, number]): Promise<ToolResultContent[]> {
  const x = Math.round(coordinate[0]);
  const y = Math.round(coordinate[1]);
  const coordError = validateCoordinateInViewport(x, y);
  if (coordError) return textResult(coordError);
  await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseMoved', x, y },
  });
  await delay(200);
  return takeScreenshot(tabId);
}

async function performType(tabId: number, text: string): Promise<ToolResultContent[]> {
  for (const char of text) {
    await sendToBackground({
      type: 'cdp-send', tabId,
      method: 'Input.insertText',
      params: { text: char },
    });
  }
  return textResult(`Typed: "${text.length > 100 ? text.slice(0, 100) + '...' : text}"`);
}

const MODIFIER_KEYS: Record<string, { key: string; code: string; keyCode: number; flag: number }> = {
  alt: { key: 'Alt', code: 'AltLeft', keyCode: 18, flag: 1 },
  ctrl: { key: 'Control', code: 'ControlLeft', keyCode: 17, flag: 2 },
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17, flag: 2 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91, flag: 4 },
  cmd: { key: 'Meta', code: 'MetaLeft', keyCode: 91, flag: 4 },
  command: { key: 'Meta', code: 'MetaLeft', keyCode: 91, flag: 4 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16, flag: 8 },
};

const KEY_TEXT_MAP: Record<string, string> = {
  Enter: '\r', Tab: '\t', ' ': ' ',
};

function getKeyText(keyDef: { key: string }, modifierFlags: number): string | undefined {
  if (KEY_TEXT_MAP[keyDef.key] !== undefined) return KEY_TEXT_MAP[keyDef.key];
  if (keyDef.key.length === 1) {
    return (modifierFlags & 8) ? keyDef.key.toUpperCase() : keyDef.key;
  }
  return undefined;
}

async function performKey(tabId: number, text: string, repeat?: number): Promise<ToolResultContent[]> {
  const combos = text.split(' ');
  const count = Math.min(repeat || 1, 100);

  for (let r = 0; r < count; r++) {
    for (const combo of combos) {
      const parts = combo.toLowerCase().split('+');
      const mainKeyName = parts[parts.length - 1];
      const modParts = parts.slice(0, -1);

      let modifierFlags = 0;
      const activeModifiers: Array<{ key: string; code: string; keyCode: number }> = [];
      for (const mod of modParts) {
        const m = MODIFIER_KEYS[mod];
        if (m) {
          modifierFlags |= m.flag;
          activeModifiers.push(m);
        }
      }

      const keyDef = KEY_DEFINITIONS[mainKeyName] || {
        key: mainKeyName.length === 1 ? mainKeyName : mainKeyName.charAt(0).toUpperCase() + mainKeyName.slice(1),
        code: mainKeyName.length === 1 ? `Key${mainKeyName.toUpperCase()}` : mainKeyName,
        keyCode: mainKeyName.length === 1 ? mainKeyName.toUpperCase().charCodeAt(0) : 0,
      };

      for (const mod of activeModifiers) {
        await sendToBackground({
          type: 'cdp-send', tabId,
          method: 'Input.dispatchKeyEvent',
          params: { type: 'rawKeyDown', key: mod.key, code: mod.code, windowsVirtualKeyCode: mod.keyCode, modifiers: modifierFlags },
        });
      }

      const keyText = getKeyText(keyDef, modifierFlags);
      const hasCommandModifier = (modifierFlags & 1) || (modifierFlags & 2) || (modifierFlags & 4);
      const shouldSendChar = keyText !== undefined && !hasCommandModifier;
      await sendToBackground({
        type: 'cdp-send', tabId,
        method: 'Input.dispatchKeyEvent',
        params: { type: 'rawKeyDown', key: keyDef.key, code: keyDef.code, windowsVirtualKeyCode: keyDef.keyCode, modifiers: modifierFlags, ...(shouldSendChar && { text: keyText }) },
      });
      if (shouldSendChar) {
        await sendToBackground({
          type: 'cdp-send', tabId,
          method: 'Input.dispatchKeyEvent',
          params: { type: 'char', key: keyDef.key, code: keyDef.code, text: keyText!, modifiers: modifierFlags },
        });
      }
      await sendToBackground({
        type: 'cdp-send', tabId,
        method: 'Input.dispatchKeyEvent',
        params: { type: 'keyUp', key: keyDef.key, code: keyDef.code, windowsVirtualKeyCode: keyDef.keyCode, modifiers: modifierFlags },
      });

      for (const mod of activeModifiers.reverse()) {
        await sendToBackground({
          type: 'cdp-send', tabId,
          method: 'Input.dispatchKeyEvent',
          params: { type: 'keyUp', key: mod.key, code: mod.code, windowsVirtualKeyCode: mod.keyCode, modifiers: 0 },
        });
      }
    }
  }

  await delay(300);
  return takeScreenshot(tabId);
}

async function performScroll(
  tabId: number,
  coordinate: [number, number] | undefined,
  direction: string,
  amount: number,
): Promise<ToolResultContent[]> {
  const raw = coordinate || [640, 400];
  const x = Math.round(raw[0]);
  const y = Math.round(raw[1]);
  const coordError = validateCoordinateInViewport(x, y);
  if (coordError) return textResult(coordError);
  const pixels = (amount || 3) * SCROLL_PIXELS_PER_TICK;

  let deltaX = 0;
  let deltaY = 0;
  switch (direction) {
    case 'up': deltaY = -pixels; break;
    case 'down': deltaY = pixels; break;
    case 'left': deltaX = -pixels; break;
    case 'right': deltaX = pixels; break;
  }

  await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseWheel', x, y, deltaX, deltaY },
  });

  await delay(300);
  return takeScreenshot(tabId);
}

async function performDrag(
  tabId: number,
  startCoord: [number, number],
  endCoord: [number, number],
): Promise<ToolResultContent[]> {
  const sx = Math.round(startCoord[0]);
  const sy = Math.round(startCoord[1]);
  const ex = Math.round(endCoord[0]);
  const ey = Math.round(endCoord[1]);
  const startError = validateCoordinateInViewport(sx, sy);
  if (startError) return textResult(`Invalid drag start: ${startError}`);
  const endError = validateCoordinateInViewport(ex, ey);
  if (endError) return textResult(`Invalid drag end: ${endError}`);

  await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseMoved', x: sx, y: sy },
  });
  await delay(50);

  await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1 },
  });
  await delay(100);

  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const px = Math.round(sx + ((ex - sx) * i) / steps);
    const py = Math.round(sy + ((ey - sy) * i) / steps);
    await sendToBackground({
      type: 'cdp-send', tabId,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseMoved', x: px, y: py, buttons: 1 },
    });
    await delay(20);
  }

  await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseReleased', x: ex, y: ey, button: 'left', buttons: 0, clickCount: 1 },
  });

  await delay(200);
  return takeScreenshot(tabId);
}

async function performZoom(tabId: number, region: [number, number, number, number]): Promise<ToolResultContent[]> {
  const [x0, y0, x1, y1] = region;
  const resp = await sendToBackground({ type: 'take-screenshot', tabId });
  if (!resp.success) return textResult(`Zoom screenshot failed: ${resp.error}`);

  const raw = (resp.data as { screenshot: string }).screenshot;
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = `data:image/png;base64,${raw}`;
  });

  const vp = getViewport();
  const scaleX = img.naturalWidth / vp.width;
  const scaleY = img.naturalHeight / vp.height;

  const canvas = document.createElement('canvas');
  const cropW = Math.round((x1 - x0) * scaleX);
  const cropH = Math.round((y1 - y0) * scaleY);
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, Math.round(x0 * scaleX), Math.round(y0 * scaleY), cropW, cropH, 0, 0, cropW, cropH);

  const data = canvas.toDataURL('image/png').split(',')[1];
  return imageResult(data);
}

async function performScrollTo(tabId: number, ref: string): Promise<ToolResultContent[]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (refId: string) => {
      const w = window as unknown as { __claudeElementMap?: Record<string, WeakRef<Element>> };
      const el = w.__claudeElementMap?.[refId]?.deref();
      if (!el) return 'Element not found';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return 'Scrolled into view';
    },
    args: [ref],
  });
  const msg = results?.[0]?.result as string || 'scroll_to executed';
  if (msg === 'Element not found') return textResult(`Error: ${ref} not found. Run read_page first.`);
  await delay(500);
  return takeScreenshot(tabId);
}

const MUTATING_TOOLS = new Set(['computer', 'form_input', 'javascript_tool', 'file_upload', 'upload_image']);
const MUTATING_ACTIONS = new Set(['left_click', 'right_click', 'double_click', 'triple_click', 'type', 'key', 'left_click_drag']);

async function verifyDomainUnchanged(tabId: number, originalDomain: string): Promise<string | null> {
  const normalizeDomain = (value: string) => value.trim().toLowerCase().replace(/\.+$/, '');
  const compoundSuffixes = new Set([
    'co.uk',
    'org.uk',
    'ac.uk',
    'gov.uk',
    'com.au',
    'net.au',
    'org.au',
    'co.nz',
    'com.br',
    'com.mx',
    'co.jp',
  ]);
  const baseDomain = (value: string) => {
    const normalized = normalizeDomain(value);
    const parts = normalized.split('.').filter(Boolean);
    if (parts.length <= 2) return normalized;
    const suffix2 = parts.slice(-2).join('.');
    const suffix3 = parts.slice(-3).join('.');
    if (compoundSuffixes.has(suffix2) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    if (compoundSuffixes.has(suffix3) && parts.length >= 4) {
      return parts.slice(-4).join('.');
    }
    return parts.slice(-2).join('.');
  };
  const isSameSiteDomain = (left: string, right: string) => {
    const a = normalizeDomain(left);
    const b = normalizeDomain(right);
    if (!a || !b) return false;
    return a === b || baseDomain(a) === baseDomain(b);
  };
  try {
    const tab = await chrome.tabs.get(tabId);
    const currentDomain = tab.url ? new URL(tab.url).hostname : '';
    if (originalDomain && currentDomain && !isSameSiteDomain(originalDomain, currentDomain)) {
      return `Security: tab domain changed from ${originalDomain} to ${currentDomain} during action. Aborting.`;
    }
  } catch {
    // tab may not exist
  }
  return null;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  apiKey: string,
  sessionId?: string,
): Promise<ToolResultContent[]> {
  const store = useStore.getState();
  _screenshotSessionId = sessionId;
  store.setCurrentTool(name, sessionId);

  const isMutating = MUTATING_TOOLS.has(name) &&
    (name !== 'computer' || MUTATING_ACTIONS.has(input.action as string));
  let preDomain = '';
  const targetTabId = (input.tabId as number | undefined) || store.activeTabId;

  if (isMutating && targetTabId) {
    try {
      const tab = await chrome.tabs.get(targetTabId);
      preDomain = tab.url ? new URL(tab.url).hostname : '';
    } catch { /* */ }
  }

  try {
    switch (name) {
      case 'computer':
        return await executeComputer(input, sessionId);
      case 'navigate':
        return await executeNavigate(input);
      case 'read_page':
        return await executeReadPage(input);
      case 'form_input':
        return await executeFormInput(input);
      case 'find':
        return await executeFind(input, apiKey);
      case 'get_page_text':
        return await executeGetPageText(input);
      case 'javascript_tool':
        return await executeJavascript(input);
      case 'tabs_context':
        return await executeTabsContext(sessionId);
      case 'tabs_create':
        return await executeTabsCreate(sessionId);
      case 'read_console_messages':
        return await executeReadConsole(input);
      case 'read_network_requests':
        return await executeReadNetwork(input);
      case 'upload_image':
        return await executeUploadImage(input);
      case 'file_upload':
        return await executeFileUpload(input);
      case 'resize_window':
        return await executeResizeWindow(input);
      case 'update_plan':
        return await executeUpdatePlan(input);
      case 'shortcuts_list':
        return textResult('No shortcuts configured.');
      case 'shortcuts_execute':
        return textResult('Shortcut execution not available.');
      default:
        return textResult(`Unknown tool: ${name}`);
    }
  } finally {
    if (isMutating && preDomain && targetTabId) {
      const domainErr = await verifyDomainUnchanged(targetTabId, preDomain);
      if (domainErr) {
        store.setError(domainErr, sessionId);
      }
    }
    store.setCurrentTool(null, sessionId);
  }
}

async function executeComputer(input: Record<string, unknown>, sessionId?: string): Promise<ToolResultContent[]> {
  const action = input.action as string;
  const tabId = (input.tabId as number | undefined) || getActiveTabId();

  if (action !== 'wait') {
    const blocked = await checkTabAccess(tabId, 'computer');
    if (blocked) return textResult(blocked);
  }

  // Keep the inspected tab focused so CDP input events apply reliably.
  if (action !== 'screenshot' && action !== 'wait' && shouldBringTabToFront(sessionId)) {
    await sendToBackground({
      type: 'cdp-send',
      tabId,
      method: 'Page.bringToFront',
    }).catch(() => {});
  }

  switch (action) {
    case 'screenshot':
      return takeScreenshot(tabId);
    case 'left_click':
    case 'right_click':
    case 'double_click':
    case 'triple_click':
      return performClick(tabId, action, input.coordinate as [number, number] | undefined, input.modifiers as string | undefined, input.ref as string | undefined);
    case 'hover': {
      let hoverCoords = input.coordinate as [number, number] | undefined;
      if (!hoverCoords && input.ref) {
        const resolved = await resolveRefToCoordinate(tabId, input.ref as string);
        if (!resolved) return textResult(`Error: ref ${input.ref} not found.`);
        hoverCoords = resolved;
      }
      if (!hoverCoords) return textResult('Error: No coordinate or ref provided for hover.');
      return performHover(tabId, hoverCoords);
    }
    case 'type':
      return performType(tabId, input.text as string);
    case 'key':
      return performKey(tabId, input.text as string, input.repeat as number | undefined);
    case 'scroll':
      return performScroll(
        tabId,
        input.coordinate as [number, number] | undefined,
        input.scroll_direction as string,
        input.scroll_amount as number,
      );
    case 'scroll_to':
      return performScrollTo(tabId, input.ref as string);
    case 'wait':
      await delay(((input.duration as number) || 2) * 1000);
      return takeScreenshot(tabId);
    case 'left_click_drag':
      return performDrag(
        tabId,
        input.start_coordinate as [number, number],
        input.coordinate as [number, number],
      );
    case 'zoom':
      return performZoom(tabId, input.region as [number, number, number, number]);
    default:
      return textResult(`Unknown computer action: ${action}`);
  }
}

async function executeNavigate(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const tabId = input.tabId as number;
  const url = input.url as string;
  const resp = await sendToBackground({ type: 'navigate', tabId, url });
  if (!resp.success) return textResult(`Navigation failed: ${resp.error}`);

  useStore.getState().setActiveTabId(tabId);

  const vpResp = await sendToBackground({ type: 'get-viewport-size', tabId });
  if (vpResp.success) {
    const vp = vpResp.data as { width: number; height: number };
    useStore.getState().setViewportSize(vp);
  }

  await delay(500);
  return takeScreenshot(tabId);
}

async function executeReadPage(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const tabId = input.tabId as number;
  const blocked = await checkTabAccess(tabId, 'read_page');
  if (blocked) return textResult(blocked);

  const filter = (input.filter as 'interactive' | 'all') || 'interactive';
  const depth = (input.depth as number) || MAX_A11Y_DEPTH;
  const maxChars = (input.max_chars as number) || MAX_A11Y_CHARS;
  const refId = (input.ref_id as string) || null;

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: generateAccessibilityTree,
    args: [filter, depth, maxChars, refId],
  });

  const tree = results?.[0]?.result as string;
  return textResult(tree || '(no accessibility tree data)');
}

async function executeFormInput(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const tabId = input.tabId as number;
  const blocked = await checkTabAccess(tabId, 'form_input');
  if (blocked) return textResult(blocked);
  const ref = input.ref as string;
  const value = input.value as string | boolean | number;

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: setFormValue,
    args: [ref, value],
  });

  const msg = results?.[0]?.result as string;
  return textResult(msg || 'form_input executed');
}

async function executeFind(input: Record<string, unknown>, apiKey: string): Promise<ToolResultContent[]> {
  const tabId = input.tabId as number;
  const blocked = await checkTabAccess(tabId, 'find');
  if (blocked) return textResult(blocked);
  const query = input.query as string;

  const treeResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: generateAccessibilityTree,
    // Parity with real extension behavior: find should reason over full page tree.
    args: ['all', 15, 50000, null],
  });
  const tree = treeResults?.[0]?.result as string;
  if (!tree) return textResult('Could not read page for find.');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const findPrompt = `You are helping find elements on a web page. Given this accessibility tree and a search query, return the matching elements.

Accessibility tree:
${tree}

Search query: "${query}"

Return your results in this exact format:
FOUND: <number of matches>
Then for each match, one per line:
<ref_id> | <role> | <name> | <reason for match>

Return at most 20 matches. If no matches found, return:
FOUND: 0`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{ role: 'user', content: findPrompt }],
  });

  const responseText = (response.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('');

  return textResult(responseText);
}

async function executeGetPageText(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const tabId = input.tabId as number;
  const blocked = await checkTabAccess(tabId, 'get_page_text');
  if (blocked) return textResult(blocked);
  const maxChars = (input.max_chars as number) || MAX_PAGE_TEXT_CHARS;

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageText,
    args: [maxChars],
  });

  const text = results?.[0]?.result as string;
  return textResult(text || '(no text content)');
}

async function executeJavascript(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const tabId = input.tabId as number;
  const blocked = await checkTabAccess(tabId, 'javascript_tool');
  if (blocked) return textResult(blocked);
  const code = input.text as string;

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (jsCode: string) => {
      try {
        const result = eval(jsCode);
        return String(result);
      } catch (e) {
        return `Error: ${e}`;
      }
    },
    args: [code],
  });

  const result = results?.[0]?.result as string;
  return textResult(result ?? 'undefined');
}

async function executeTabsContext(sessionId?: string): Promise<ToolResultContent[]> {
  const resp = await sendToBackground({ type: 'tabs-context', sessionId });
  if (!resp.success) return textResult(`Failed: ${resp.error}`);
  const tabs = resp.data as TabInfo[];
  const lines = tabs.map(
    (t) => `Tab ${t.id}: "${t.title}" (${t.url})${t.active ? ' [ACTIVE]' : ''}`,
  );
  return textResult(lines.join('\n') || 'No tabs found.');
}

async function executeTabsCreate(sessionId?: string): Promise<ToolResultContent[]> {
  const resp = await sendToBackground({ type: 'tabs-create', sessionId });
  if (!resp.success) return textResult(`Failed: ${resp.error}`);
  const data = resp.data as { id: number; url: string; title: string };
  await sendToBackground({ type: 'enable-console-capture', tabId: data.id }).catch(() => {});
  await sendToBackground({ type: 'enable-network-capture', tabId: data.id }).catch(() => {});
  return textResult(`Created new tab with ID ${data.id}`);
}

async function executeReadConsole(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const resp = await sendToBackground({
    type: 'get-console-messages',
    tabId: input.tabId as number,
    onlyErrors: input.onlyErrors as boolean | undefined,
    clear: input.clear as boolean | undefined,
    pattern: input.pattern as string | undefined,
    limit: input.limit as number | undefined,
  });
  if (!resp.success) return textResult(`Failed: ${resp.error}`);
  const msgs = resp.data as Array<{ type: string; text: string }>;
  if (msgs.length === 0) return textResult('No console messages.');
  return textResult(msgs.map((m) => `[${m.type}] ${m.text}`).join('\n'));
}

async function executeReadNetwork(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const resp = await sendToBackground({
    type: 'get-network-requests',
    tabId: input.tabId as number,
    urlPattern: input.urlPattern as string | undefined,
    clear: input.clear as boolean | undefined,
    limit: input.limit as number | undefined,
  });
  if (!resp.success) return textResult(`Failed: ${resp.error}`);
  const reqs = resp.data as Array<Record<string, unknown>>;
  if (reqs.length === 0) return textResult('No network requests captured.');
  return textResult(
    reqs
      .map((r) => `${r.method || 'GET'} ${r.url}${r.status ? ` -> ${r.status}` : ''}`)
      .join('\n'),
  );
}

async function executeUploadImage(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const imageId = input.imageId as string;
  const tabId = input.tabId as number;
  const ref = input.ref as string | undefined;
  const filename = (input.filename as string) || 'image.png';

  const base64Data = screenshotStore.get(imageId);
  if (!base64Data) return textResult(`Image ${imageId} not found. Take a screenshot first.`);

  if (ref) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (refId: string, b64: string, fname: string) => {
        const w = window as unknown as { __claudeElementMap?: Record<string, WeakRef<Element>> };
        const el = w.__claudeElementMap?.[refId]?.deref() as HTMLInputElement | null;
        if (!el || el.tagName !== 'INPUT' || el.type !== 'file') return 'Error: Not a file input';
        const binary = atob(b64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
        const file = new File([array], fname, { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'Image uploaded to file input';
      },
      args: [ref, base64Data, filename],
    });
    return textResult(results?.[0]?.result as string || 'Upload executed');
  }

  return textResult('Specify a ref for file input or coordinate for drag-and-drop.');
}

async function executeFileUpload(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const tabId = input.tabId as number;
  const blocked = await checkTabAccess(tabId, 'file_upload');
  if (blocked) return textResult(blocked);
  const ref = input.ref as string;
  const paths = input.paths as string[];

  const selectorResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: (refId: string) => {
      const w = window as unknown as { __claudeElementMap?: Record<string, WeakRef<Element>> };
      const el = w.__claudeElementMap?.[refId]?.deref() as HTMLInputElement | null;
      if (!el) return { error: 'Element not found. Run read_page first.' };
      if (el.tagName !== 'INPUT' || el.type !== 'file') return { error: 'Element is not a file input.' };

      let selector = '';
      if (el.id) {
        selector = `#${el.id}`;
      } else if (el.name) {
        selector = `input[type="file"][name="${el.name}"]`;
      } else {
        const inputs = document.querySelectorAll('input[type="file"]');
        const idx = Array.from(inputs).indexOf(el);
        selector = `input[type="file"]:nth-of-type(${idx + 1})`;
      }
      return { selector };
    },
    args: [ref],
  });

  const info = selectorResult?.[0]?.result as { error?: string; selector?: string } | null;
  if (!info || info.error) {
    return textResult(`Error: ${info?.error || 'Could not resolve file input.'}`);
  }

  const docResp = await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'DOM.getDocument',
    params: { depth: 0 },
  });
  if (!docResp.success) return textResult(`Error: ${docResp.error}`);
  const rootNodeId = (docResp.data as { root: { nodeId: number } }).root.nodeId;

  const queryResp = await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'DOM.querySelector',
    params: { nodeId: rootNodeId, selector: info.selector },
  });
  if (!queryResp.success) return textResult(`Error finding file input via CDP: ${queryResp.error}`);
  const fileNodeId = (queryResp.data as { nodeId: number }).nodeId;
  if (!fileNodeId) return textResult('Error: CDP could not find the file input element.');

  const setResp = await sendToBackground({
    type: 'cdp-send', tabId,
    method: 'DOM.setFileInputFiles',
    params: { files: paths, nodeId: fileNodeId },
  });
  if (!setResp.success) return textResult(`File upload failed: ${setResp.error}`);
  return textResult(`Uploaded ${paths.length} file(s) to file input.`);
}

async function executeResizeWindow(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const resp = await sendToBackground({
    type: 'resize-window',
    tabId: input.tabId as number,
    width: input.width as number,
    height: input.height as number,
  });
  if (!resp.success) return textResult(`Failed: ${resp.error}`);
  return textResult(`Window resized to ${input.width}x${input.height}`);
}

async function executeUpdatePlan(input: Record<string, unknown>): Promise<ToolResultContent[]> {
  const domains = input.domains as string[];
  const approach = input.approach as string[];

  return new Promise((resolve) => {
    useStore.getState().setPlanRequest({
      id: `plan_${Date.now()}`,
      plan: { domains, approach },
      resolve: (approved) => {
        useStore.getState().setPlanRequest(null);
        if (approved) {
          permissionManager.approvePlanDomains(domains);
          resolve(textResult('Plan approved by user. Proceeding.'));
        } else {
          resolve(textResult('Plan rejected by user. Please revise your approach.'));
        }
      },
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
