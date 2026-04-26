import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { extractPageText, generateAccessibilityTree, setFormValue } from './dom-helpers.mjs';

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const COMMON_BROWSER_PATHS = [
  process.env.OTTOAUTH_BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

function buildBrowserLaunchArgs() {
  const args = [
    '--no-default-browser-check',
    '--no-first-run',
    '--disable-blink-features=AutomationControlled',
  ];
  const chromeProfileName = String(process.env.OTTOAUTH_PROFILE_NAME || '').trim();
  if (chromeProfileName) {
    args.push(`--profile-directory=${chromeProfileName}`);
  }
  if (process.platform === 'linux') {
    // Keep the dedicated worker profile self-contained so a background service
    // can reuse website sessions without depending on a desktop keyring unlock.
    args.push('--password-store=basic');
  } else if (shouldUseMockKeychain()) {
    args.push('--use-mock-keychain');
  }
  return args;
}

function buildIgnoredDefaultArgs() {
  const args = ['--enable-automation'];
  if (process.platform === 'darwin' && !shouldUseMockKeychain()) {
    args.push('--use-mock-keychain');
    args.push('--disable-sync');
  }
  return args;
}

function shouldUseMockKeychain() {
  if (process.platform !== 'darwin') {
    return false;
  }

  const explicitSetting = String(process.env.OTTOAUTH_USE_MOCK_KEYCHAIN || '').trim().toLowerCase();
  if (explicitSetting) {
    return !['0', 'false', 'no', 'off'].includes(explicitSetting);
  }

  // When reusing a real Chrome user-data dir on macOS, keep the normal
  // keychain integration so existing signed-in sessions remain accessible.
  return !process.env.OTTOAUTH_PROFILE_DIR?.trim();
}

const KEY_ALIASES = {
  return: 'Enter',
  enter: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  space: 'Space',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  command: 'Meta',
  cmd: 'Meta',
  meta: 'Meta',
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

function textResult(text) {
  return [{ type: 'text', text }];
}

function imageResult(base64) {
  return [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } }];
}

function stringifyError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return lower + Math.random() * (upper - lower);
}

function nativeNavigatorPlatform() {
  if (process.platform === 'darwin') return 'MacIntel';
  if (process.platform === 'win32') return 'Win32';
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'Linux aarch64' : 'Linux x86_64';
  }
  return null;
}

function nativeUserAgentPlatformToken() {
  if (process.platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7';
  if (process.platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'X11; Linux aarch64' : 'X11; Linux x86_64';
  }
  return null;
}

function normalizeUserAgent(rawUserAgent) {
  const normalized = String(rawUserAgent || '').trim();
  if (!normalized) return normalized;

  let next = normalized.replace(/HeadlessChrome\//g, 'Chrome/');
  const platformToken = nativeUserAgentPlatformToken();
  if (platformToken && /CrOS x86_64/.test(next)) {
    next = next.replace(/CrOS x86_64/g, platformToken);
  }
  return next;
}

function buildStealthProfile(rawUserAgent) {
  return {
    language: 'en-US',
    languages: ['en-US', 'en'],
    navigatorPlatform: nativeNavigatorPlatform(),
    userAgent: normalizeUserAgent(rawUserAgent),
    vendor: 'Google Inc.',
  };
}

function installStealthOverrides(profile) {
  const defineGetter = (target, key, value) => {
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get: () => value,
      });
    } catch {
      // Ignore browsers that reject redefining a property.
    }
  };

  if (profile?.userAgent) {
    defineGetter(Navigator.prototype, 'userAgent', profile.userAgent);
  }
  if (profile?.navigatorPlatform) {
    defineGetter(Navigator.prototype, 'platform', profile.navigatorPlatform);
  }
  if (profile?.vendor) {
    defineGetter(Navigator.prototype, 'vendor', profile.vendor);
  }
  if (profile?.language) {
    defineGetter(Navigator.prototype, 'language', profile.language);
  }
  if (Array.isArray(profile?.languages) && profile.languages.length > 0) {
    defineGetter(Navigator.prototype, 'languages', profile.languages);
  }
  defineGetter(Navigator.prototype, 'webdriver', undefined);

  const chromeObject = window.chrome ?? {};
  if (!chromeObject.runtime) {
    chromeObject.runtime = {};
  }
  if (!chromeObject.app) {
    chromeObject.app = {
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
    };
  }
  window.chrome = chromeObject;
}

function isSyntheticPointerJavascript(code) {
  const normalized = String(code || '');
  if (!normalized) return false;
  return (
    /dispatchEvent/i.test(normalized) &&
    /(MouseEvent|PointerEvent|TouchEvent|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|touchmove)/i.test(
      normalized,
    )
  );
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function moveFile(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'EXDEV') {
      throw error;
    }
    await fs.copyFile(sourcePath, targetPath);
    await fs.unlink(sourcePath).catch(() => {});
  }
}

export async function resolveBrowserExecutable(preferredPath = null) {
  const candidates = [preferredPath, ...COMMON_BROWSER_PATHS].filter(Boolean);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'Could not find a Chrome/Chromium executable. Set OTTOAUTH_BROWSER_PATH or pass --browser-path.',
  );
}

export class BrowserRuntime {
  constructor(options = {}) {
    this.profileDir = options.profileDir;
    this.browserPath = options.browserPath || null;
    this.headless = options.headless !== false;
    this.keepTabs = Boolean(options.keepTabs);
    this.strictHumanInput = Boolean(options.strictHumanInput);
    this.viewport = options.viewport || DEFAULT_VIEWPORT;
    this.recordVideo = Boolean(options.recordVideo && options.videoDir);
    this.videoDir = options.videoDir || null;
    this.videoEntries = [];
    this.context = null;
    this.browserExecutablePath = null;
    this.pageIds = new WeakMap();
    this.pagesById = new Map();
    this.nextPageId = 1;
    this.activePageId = null;
    this.currentTracePath = null;
    this.stealthProfile = null;
    this.mousePosition = {
      x: Math.round(this.viewport.width / 2),
      y: Math.round(this.viewport.height / 2),
    };
  }

  async start() {
    this.browserExecutablePath = await resolveBrowserExecutable(this.browserPath);
    if (this.recordVideo) {
      await fs.mkdir(this.videoDir, { recursive: true });
    }
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      executablePath: this.browserExecutablePath,
      headless: this.headless,
      viewport: this.viewport,
      ...(this.recordVideo
        ? {
            recordVideo: {
              dir: this.videoDir,
              size: this.viewport,
            },
          }
        : {}),
      locale: 'en-US',
      ignoreHTTPSErrors: true,
      chromiumSandbox: false,
      // Playwright's default automation flag is a direct anti-bot signal.
      ignoreDefaultArgs: buildIgnoredDefaultArgs(),
      args: buildBrowserLaunchArgs(),
    });
    this.context.setDefaultNavigationTimeout(45000);
    this.context.setDefaultTimeout(45000);

    const bootstrapPage = this.context.pages()[0] || (await this.context.newPage());
    const rawUserAgent = await bootstrapPage.evaluate(() => navigator.userAgent).catch(() => '');
    this.stealthProfile = buildStealthProfile(rawUserAgent);
    await this.context.addInitScript(installStealthOverrides, this.stealthProfile);
    await this.context.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      ...(this.stealthProfile?.userAgent
        ? { 'User-Agent': this.stealthProfile.userAgent }
        : {}),
    });

    for (const page of this.context.pages()) {
      this.#registerPage(page);
    }
    this.context.on('page', (page) => this.#registerPage(page));

    if (this.context.pages().length === 0) {
      await this.createTab();
    } else if (this.activePageId == null) {
      this.activePageId = this.#getPageId(this.context.pages()[0]);
    }
  }

  async stop() {
    if (!this.context) return;
    try {
      if (this.currentTracePath) {
        await this.stopTaskTrace().catch(() => {});
      }
      await this.context.close();
    } finally {
      this.context = null;
      this.currentTracePath = null;
    }
  }

  async prepareTaskWorkspace() {
    if (!this.context) {
      throw new Error('Browser runtime is not started.');
    }
    if (!this.keepTabs) {
      const existingPages = [...this.context.pages()];
      const reusablePage = existingPages[0] || null;
      const pagesToClose = reusablePage ? existingPages.slice(1) : existingPages;
      await Promise.all(
        pagesToClose.map((page) =>
          page.close().catch(() => {}),
        ),
      );
      this.pagesById.clear();
      this.pageIds = new WeakMap();
      this.activePageId = null;
      this.nextPageId = 1;
      if (reusablePage && !reusablePage.isClosed()) {
        const id = this.#registerPage(reusablePage);
        this.activePageId = id;
        await reusablePage.bringToFront().catch(() => {});
        try {
          await reusablePage.goto('about:blank', { waitUntil: 'domcontentloaded' });
        } catch {
          // about:blank is best-effort only
        }
        return { id, page: reusablePage };
      }
    }
    try {
      const tab = await this.createTab();
      try {
        await tab.page.goto('about:blank', { waitUntil: 'domcontentloaded' });
      } catch {
        // about:blank is best-effort only
      }
      return tab;
    } catch (error) {
      const page = await this.getActivePage();
      const id = this.#getPageId(page);
      try {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
      } catch {
        // about:blank is best-effort only
      }
      return { id, page };
    }
  }

  async startTaskTrace(tracePath) {
    if (!this.context) return;
    this.currentTracePath = tracePath;
    await this.context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
  }

  async stopTaskTrace() {
    if (!this.context || !this.currentTracePath) return;
    const tracePath = this.currentTracePath;
    this.currentTracePath = null;
    await this.context.tracing.stop({ path: tracePath });
  }

  async saveTaskVideos(primaryVideoPath) {
    if (!this.context || !this.recordVideo || !primaryVideoPath) return [];

    const openPages = this.context.pages().filter((page) => !page.isClosed());
    await Promise.all(openPages.map((page) => page.close().catch(() => {})));

    const entries = this.videoEntries.length > 0
      ? this.videoEntries
      : openPages.map((page) => ({
          pageId: this.pageIds.get(page) || null,
          video: typeof page.video === 'function' ? page.video() : null,
        }));
    const artifacts = [];
    const extension = path.extname(primaryVideoPath) || '.webm';
    const base = primaryVideoPath.slice(0, primaryVideoPath.length - extension.length);

    for (const entry of entries) {
      if (!entry.video) continue;
      const sourcePath = await entry.video.path().catch(() => null);
      if (!sourcePath) continue;
      const stats = await fs.stat(sourcePath).catch(() => null);
      if (!stats || stats.size <= 0) continue;

      const index = artifacts.length + 1;
      const targetPath = index === 1 ? primaryVideoPath : `${base}-${index}${extension}`;
      await moveFile(sourcePath, targetPath);
      artifacts.push({
        path: path.basename(targetPath),
        page_id: entry.pageId,
        primary: index === 1,
        bytes: stats.size,
      });
    }

    return artifacts;
  }

  async createTab() {
    if (!this.context) throw new Error('Browser runtime is not started.');
    const page = await this.context.newPage();
    const id = this.#registerPage(page);
    this.activePageId = id;
    await page.bringToFront().catch(() => {});
    return { id, page };
  }

  async tabsContext() {
    if (!this.context) throw new Error('Browser runtime is not started.');
    const pages = this.context.pages();
    if (pages.length === 0) {
      await this.createTab();
    }
    const records = [];
    for (const page of this.context.pages()) {
      const id = this.#registerPage(page);
      records.push({
        id,
        title: await page.title().catch(() => ''),
        url: page.url() || 'about:blank',
        active: id === this.activePageId,
        groupId: -1,
      });
    }
    records.sort((a, b) => a.id - b.id);
    return records;
  }

  getViewport() {
    return this.viewport;
  }

  async snapshotForOttoAuth() {
    const page = await this.getActivePage();
    const tabs = await this.tabsContext();
    const ottoFormat =
      String(process.env.OTTOAUTH_SNAPSHOT_FORMAT || 'jpeg').toLowerCase() === 'png'
        ? 'png'
        : 'jpeg';
    const ottoQuality = Math.max(
      20,
      Math.min(95, Number(process.env.OTTOAUTH_SNAPSHOT_QUALITY) || 60),
    );
    const shot = await this.takeScreenshot(page, null, {
      format: ottoFormat,
      quality: ottoQuality,
    });
    return {
      image_base64: shot.base64,
      image_mime: shot.mime,
      width: shot.width,
      height: shot.height,
      tabs: tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active,
      })),
    };
  }

  getToolDefinitions() {
    const tools = [
      {
        name: 'computer',
        type: 'computer_20250124',
        display_width_px: this.viewport.width,
        display_height_px: this.viewport.height,
        display_number: 1,
      },
      {
        name: 'navigate',
        description: 'Navigate to a URL, or go back/forward in browser history.',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            tabId: { type: 'number' },
          },
          required: ['url'],
        },
      },
      {
        name: 'read_page',
        description: 'Read an accessibility-style tree of elements and refs on the page.',
        input_schema: {
          type: 'object',
          properties: {
            filter: { type: 'string', enum: ['interactive', 'all'] },
            tabId: { type: 'number' },
            depth: { type: 'number' },
            ref_id: { type: 'string' },
            max_chars: { type: 'number' },
          },
          required: [],
        },
      },
      {
        name: 'find',
        description: 'Search the page tree in natural language and return matching refs.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            tabId: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_page_text',
        description: 'Extract the main text content from the current page.',
        input_schema: {
          type: 'object',
          properties: {
            tabId: { type: 'number' },
            max_chars: { type: 'number' },
          },
          required: [],
        },
      },
      {
        name: 'tabs_context',
        description: 'List all current tabs with ids and active state.',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'tabs_create',
        description: 'Create a new blank tab.',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'tabs_activate',
        description: 'Switch the active browser tab to an existing tab ID.',
        input_schema: {
          type: 'object',
          properties: {
            tabId: { type: 'number' },
          },
          required: ['tabId'],
        },
      },
      {
        name: 'resize_window',
        description: 'Resize the browser viewport for the current task.',
        input_schema: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
            tabId: { type: 'number' },
          },
          required: ['width', 'height'],
        },
      },
    ];

    if (!this.strictHumanInput) {
      tools.splice(3, 0, {
        name: 'form_input',
        description: 'Set the value of a form field by reference id.',
        input_schema: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
            value: {},
            tabId: { type: 'number' },
          },
          required: ['ref', 'value'],
        },
      });
      tools.splice(6, 0, {
        name: 'javascript_tool',
        description: 'Execute JavaScript in the current page context.',
        input_schema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            text: { type: 'string' },
            tabId: { type: 'number' },
          },
          required: ['text'],
        },
      });
    }

    return tools;
  }

  async executeTool(name, input, context = {}) {
    switch (name) {
      case 'computer':
        return this.#executeComputer(input);
      case 'navigate':
        return this.#executeNavigate(input);
      case 'read_page':
        return this.#executeReadPage(input);
      case 'form_input':
        if (this.strictHumanInput) {
          return textResult('form_input is unavailable in strict human-input mode.');
        }
        return this.#executeFormInput(input);
      case 'find':
        return this.#executeFind(input, context);
      case 'get_page_text':
        return this.#executeGetPageText(input);
      case 'javascript_tool':
        if (this.strictHumanInput) {
          return textResult('javascript_tool is unavailable in strict human-input mode.');
        }
        return this.#executeJavascript(input);
      case 'tabs_context':
        return this.#executeTabsContext();
      case 'tabs_create':
        return this.#executeTabsCreate();
      case 'tabs_activate':
        return this.#executeTabsActivate(input);
      case 'resize_window':
        return this.#executeResizeWindow(input);
      default:
        return textResult(`Unknown tool: ${name}`);
    }
  }

  async getActivePage() {
    const page = this.activePageId != null ? this.pagesById.get(this.activePageId) : null;
    if (page && !page.isClosed()) {
      await page.bringToFront().catch(() => {});
      return page;
    }
    const pages = this.context?.pages() || [];
    if (pages.length > 0) {
      const next = pages[0];
      this.activePageId = this.#registerPage(next);
      await next.bringToFront().catch(() => {});
      return next;
    }
    const created = await this.createTab();
    return created.page;
  }

  async takeScreenshot(page, clip = null, options = {}) {
    const format = options.format === 'jpeg' ? 'jpeg' : 'png';
    const buffer = await page.screenshot({
      type: format,
      scale: 'css',
      ...(format === 'jpeg'
        ? {
            quality:
              typeof options.quality === 'number'
                ? Math.max(1, Math.min(100, options.quality))
                : 60,
          }
        : {}),
      ...(clip ? { clip } : {}),
    });
    const viewport = page.viewportSize() || this.viewport;
    return {
      base64: buffer.toString('base64'),
      mime: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      width: clip ? Math.round(clip.width) : viewport.width,
      height: clip ? Math.round(clip.height) : viewport.height,
    };
  }

  #registerPage(page) {
    const existingId = this.pageIds.get(page);
    if (existingId) {
      if (!this.pagesById.has(existingId)) {
        this.pagesById.set(existingId, page);
      }
      return existingId;
    }

    const id = this.nextPageId;
    this.nextPageId += 1;
    this.pageIds.set(page, id);
    this.pagesById.set(id, page);
    if (this.recordVideo && typeof page.video === 'function') {
      const video = page.video();
      if (video) {
        this.videoEntries.push({ pageId: id, video });
      }
    }
    if (this.activePageId == null) {
      this.activePageId = id;
    }
    page.on('close', () => {
      this.pagesById.delete(id);
      if (this.activePageId === id) {
        const nextPage = this.context?.pages().find((candidate) => !candidate.isClosed()) || null;
        this.activePageId = nextPage ? this.#getPageId(nextPage) : null;
      }
    });
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    return id;
  }

  #getPageId(page) {
    return this.pageIds.get(page) || this.#registerPage(page);
  }

  async #getPageForInput(input = {}) {
    const explicitTabId = Number(input.tabId);
    if (Number.isFinite(explicitTabId) && this.pagesById.has(explicitTabId)) {
      this.activePageId = explicitTabId;
      const page = this.pagesById.get(explicitTabId);
      await page?.bringToFront().catch(() => {});
      return page;
    }
    return this.getActivePage();
  }

  async #resolveRefToCoordinate(page, refId) {
    return page.evaluate((ref) => {
      const el = window.__claudeElementMap?.[ref]?.deref?.();
      if (!el) return null;
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      const rect = el.getBoundingClientRect();
      return [
        Math.round(rect.x + rect.width / 2),
        Math.round(rect.y + rect.height / 2),
      ];
    }, refId);
  }

  async #moveMouseHuman(page, x, y) {
    const startX = Number.isFinite(this.mousePosition?.x)
      ? this.mousePosition.x
      : Math.round(this.viewport.width / 2);
    const startY = Number.isFinite(this.mousePosition?.y)
      ? this.mousePosition.y
      : Math.round(this.viewport.height / 2);
    const distance = Math.hypot(x - startX, y - startY);
    const steps = Math.max(6, Math.min(30, Math.round(distance / 40)));
    await page.mouse.move(x, y, { steps });
    this.mousePosition = { x, y };
    await sleep(randomBetween(40, 120));
  }

  async #moveMouse(page, x, y) {
    if (this.strictHumanInput) {
      await this.#moveMouseHuman(page, x, y);
      return;
    }
    await page.mouse.move(x, y);
    this.mousePosition = { x, y };
  }

  async #clickMouse(page, x, y, { button = 'left', clickCount = 1 } = {}) {
    if (this.strictHumanInput) {
      await this.#moveMouseHuman(page, x, y);
      for (let index = 0; index < clickCount; index += 1) {
        await page.mouse.down({ button, clickCount: 1 });
        await sleep(randomBetween(25, 80));
        await page.mouse.up({ button, clickCount: 1 });
        if (index < clickCount - 1) {
          await sleep(randomBetween(40, 100));
        }
      }
      return;
    }
    await page.mouse.click(x, y, { button, clickCount });
    this.mousePosition = { x, y };
  }

  async #typeText(page, text) {
    const value = String(text || '');
    if (!this.strictHumanInput) {
      await page.keyboard.type(value);
      return;
    }
    for (const character of value) {
      await page.keyboard.type(character, {
        delay: Math.round(randomBetween(35, 120)),
      });
    }
  }

  async #readVerificationState(page) {
    const fallbackUrl = page.url() || 'about:blank';
    try {
      const state = await page.evaluate(() => {
        const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
        const hasPressAndHoldText = /press\s*&?\s*hold/i.test(bodyText);
        const hasTryAgainText = /please try again/i.test(bodyText);
        const hasEmailVerificationStep =
          Boolean(
            document.querySelector(
              'input[type="email"], input[name*="email" i], input[placeholder*="email" i]',
            ),
          ) ||
          /temporary verification code|enter your email address/i.test(bodyText);
        const hasBlockedText =
          /access to this page has been blocked|verify you are human|human verification|captcha/i.test(
            bodyText,
          );
        const hasPxCaptcha = Boolean(
          document.querySelector('#px-captcha, .px-captcha, [id*="px-captcha"]'),
        );
        return {
          url: window.location.href,
          hasPressAndHoldText,
          hasTryAgainText,
          hasEmailVerificationStep,
          hasBlockedText,
          hasPxCaptcha,
        };
      });

      const isVerificationBarrier =
        state.url.includes('/captcha/verify') ||
        state.hasPxCaptcha ||
        state.hasPressAndHoldText ||
        state.hasEmailVerificationStep ||
        state.hasBlockedText;
      const isVerificationPending =
        isVerificationBarrier &&
        !state.hasPressAndHoldText &&
        !state.hasEmailVerificationStep &&
        !state.hasTryAgainText;

      return {
        ...state,
        isVerificationBarrier,
        isVerificationPending,
        isPressAndHoldBarrier: isVerificationBarrier && !state.hasEmailVerificationStep && !isVerificationPending,
      };
    } catch {
      return {
        url: fallbackUrl,
        hasPressAndHoldText: false,
        hasTryAgainText: false,
        hasEmailVerificationStep: false,
        hasBlockedText: false,
        hasPxCaptcha: false,
        isVerificationBarrier: fallbackUrl.includes('/captcha/verify'),
        isVerificationPending: false,
        isPressAndHoldBarrier: fallbackUrl.includes('/captcha/verify'),
      };
    }
  }

  async #waitForVerificationOutcome(page, currentState, timeoutMs = 8000) {
    let latestState = currentState;
    if (!latestState.isVerificationPending) return latestState;

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await page.waitForTimeout(400);
      latestState = await this.#readVerificationState(page);
      if (!latestState.isVerificationPending) {
        return latestState;
      }
    }

    return latestState;
  }

  async #performPlaywrightPressAndHold(page, x, y, holdMs) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    const startedAt = Date.now();
    let tick = 0;
    while (Date.now() - startedAt < holdMs) {
      const remaining = holdMs - (Date.now() - startedAt);
      await page.waitForTimeout(Math.min(250, Math.max(50, remaining)));
      tick += 1;
      const offset = tick % 2 === 0 ? 0 : 1;
      await page.mouse.move(x + offset, y, { steps: 2 }).catch(() => {});
    }
    await page.mouse.up();
  }

  async #performCdpMousePressAndHold(page, x, y, holdMs) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        button: 'none',
        buttons: 0,
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });

      const startedAt = Date.now();
      let tick = 0;
      while (Date.now() - startedAt < holdMs) {
        const remaining = holdMs - (Date.now() - startedAt);
        await page.waitForTimeout(Math.min(250, Math.max(50, remaining)));
        tick += 1;
        const offset = tick % 2 === 0 ? 0 : 1;
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: x + offset,
          y,
          button: 'none',
          buttons: 1,
        });
      }

      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
      return true;
    } finally {
      await session.detach().catch(() => {});
    }
  }

  async #performCdpTouchPressAndHold(page, x, y, holdMs) {
    const session = await page.context().newCDPSession(page);
    const pointForOffset = (offset) => [
      {
        x: x + offset,
        y,
        radiusX: 2,
        radiusY: 2,
        rotationAngle: 0,
        force: 1,
        id: 1,
      },
    ];

    try {
      await session.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 1,
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: pointForOffset(0),
        modifiers: 0,
      });

      const startedAt = Date.now();
      let tick = 0;
      while (Date.now() - startedAt < holdMs) {
        const remaining = holdMs - (Date.now() - startedAt);
        await page.waitForTimeout(Math.min(250, Math.max(50, remaining)));
        tick += 1;
        const offset = tick % 2 === 0 ? 0 : 1;
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: pointForOffset(offset),
          modifiers: 0,
        });
      }

      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
        modifiers: 0,
      });
      return true;
    } finally {
      await session
        .send('Emulation.setTouchEmulationEnabled', {
          enabled: false,
          maxTouchPoints: 1,
        })
        .catch(() => {});
      await session.detach().catch(() => {});
    }
  }

  async #executeComputer(input) {
    const page = await this.#getPageForInput(input);
    const action = String(input.action || '');
    switch (action) {
      case 'screenshot': {
        const shot = await this.takeScreenshot(page);
        return imageResult(shot.base64);
      }
      case 'left_click':
      case 'right_click':
      case 'double_click':
      case 'triple_click': {
        let coords = Array.isArray(input.coordinate) ? input.coordinate : null;
        if (!coords && input.ref) {
          coords = await this.#resolveRefToCoordinate(page, input.ref);
        }
        if (!coords) return textResult('Error: No coordinate or ref provided for click.');
        const [x, y] = coords.map((value) => Math.round(Number(value)));
        const button = action === 'right_click' ? 'right' : 'left';
        const clickCount =
          action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
        await this.#clickMouse(page, x, y, { button, clickCount });
        await page.waitForTimeout(300);
        const shot = await this.takeScreenshot(page);
        return imageResult(shot.base64);
      }
      case 'hover': {
        let coords = Array.isArray(input.coordinate) ? input.coordinate : null;
        if (!coords && input.ref) {
          coords = await this.#resolveRefToCoordinate(page, input.ref);
        }
        if (!coords) return textResult('Error: No coordinate or ref provided for hover.');
        const [x, y] = coords.map((value) => Math.round(Number(value)));
        await this.#moveMouse(page, x, y);
        await page.waitForTimeout(200);
        const shot = await this.takeScreenshot(page);
        return imageResult(shot.base64);
      }
      case 'type': {
        await this.#typeText(page, input.text);
        return textResult(`Typed ${String(input.text || '').length} characters.`);
      }
      case 'key': {
        const repeat = Math.max(1, Math.min(20, Number(input.repeat) || 1));
        const normalized = String(input.text || '')
          .split('+')
          .map((part) => KEY_ALIASES[part.trim().toLowerCase()] || part.trim())
          .filter(Boolean)
          .join('+');
        if (!normalized) return textResult('Error: key text is required.');
        for (let index = 0; index < repeat; index += 1) {
          await page.keyboard.press(normalized);
        }
        return textResult(`Pressed ${normalized}${repeat > 1 ? ` x${repeat}` : ''}.`);
      }
      case 'scroll': {
        const direction = String(input.scroll_direction || 'down').toLowerCase();
        const amount = Math.max(120, Math.min(5000, Number(input.scroll_amount) || 800));
        const deltaY = direction === 'up' ? -amount : amount;
        await page.mouse.wheel(0, deltaY);
        await page.waitForTimeout(250);
        const shot = await this.takeScreenshot(page);
        return imageResult(shot.base64);
      }
      case 'scroll_to': {
        if (!input.ref) return textResult('Error: ref is required for scroll_to.');
        const ok = await page.evaluate((ref) => {
          const el = window.__claudeElementMap?.[ref]?.deref?.();
          if (!el) return false;
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          return true;
        }, String(input.ref));
        if (!ok) return textResult(`Error: ref ${input.ref} not found.`);
        const shot = await this.takeScreenshot(page);
        return imageResult(shot.base64);
      }
      case 'wait': {
        const seconds = Math.max(1, Math.min(30, Number(input.duration) || 2));
        await page.waitForTimeout(seconds * 1000);
        const shot = await this.takeScreenshot(page);
        return imageResult(shot.base64);
      }
      case 'left_click_drag': {
        const start = Array.isArray(input.start_coordinate) ? input.start_coordinate : null;
        const end = Array.isArray(input.coordinate) ? input.coordinate : null;
        if (!start || !end) return textResult('Error: start_coordinate and coordinate are required for drag.');
        await page.mouse.move(Math.round(start[0]), Math.round(start[1]));
        await page.mouse.down();
        await page.mouse.move(Math.round(end[0]), Math.round(end[1]), { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const shot = await this.takeScreenshot(page);
        return imageResult(shot.base64);
      }
      case 'press_and_hold': {
        let coords = Array.isArray(input.coordinate) ? input.coordinate : null;
        if (!coords && input.ref) {
          coords = await this.#resolveRefToCoordinate(page, input.ref);
        }
        if (!coords) return textResult('Error: No coordinate or ref provided for press_and_hold.');
        const [x, y] = coords.map((value) => Math.round(Number(value)));
        const beforeState = await this.#readVerificationState(page);
        const requestedHoldMs = Math.round(
          Math.max(0.2, Math.min(30, Number(input.duration) || 2)) * 1000,
        );
        const holdMs = beforeState.isPressAndHoldBarrier
          ? Math.max(requestedHoldMs, 3500)
          : requestedHoldMs;
        const touchHoldMs = beforeState.isPressAndHoldBarrier
          ? Math.min(Math.max(holdMs + 1000, 4500), 8000)
          : holdMs;
        let cdpMouseAttempted = false;
        let cdpTouchAttempted = false;

        try {
          await this.#performCdpMousePressAndHold(page, x, y, holdMs);
          cdpMouseAttempted = true;
        } catch {
          await this.#performPlaywrightPressAndHold(page, x, y, holdMs);
        }

        await page.waitForTimeout(beforeState.isVerificationBarrier ? 1800 : 1200);
        let afterState = await this.#waitForVerificationOutcome(
          page,
          await this.#readVerificationState(page),
          8000,
        );

        if (afterState.isPressAndHoldBarrier && beforeState.isPressAndHoldBarrier) {
          try {
            await this.#performCdpTouchPressAndHold(page, x, y, touchHoldMs);
            cdpTouchAttempted = true;
            await page.waitForTimeout(1800);
            afterState = await this.#waitForVerificationOutcome(
              page,
              await this.#readVerificationState(page),
              10000,
            );
          } catch {
            // Mouse hold already ran; keep the best effort result.
          }
        }

        const shot = await this.takeScreenshot(page);
        const detailParts = [`Pressed and held for ${(holdMs / 1000).toFixed(1)}s.`];
        if (cdpMouseAttempted) {
          detailParts.push('Used native CDP mouse hold.');
        } else {
          detailParts.push('Used Playwright mouse hold fallback.');
        }
        if (cdpTouchAttempted) {
          detailParts.push(
            `Retried with native touch hold for ${(touchHoldMs / 1000).toFixed(1)}s because the verification barrier stayed visible.`,
          );
        }
        if (beforeState.isPressAndHoldBarrier && afterState.hasEmailVerificationStep) {
          detailParts.push(`Verification advanced to the follow-up email step at ${afterState.url}.`);
        } else if (afterState.isVerificationPending) {
          detailParts.push(`Verification is still processing at ${afterState.url}; wait before retrying.`);
        } else if (afterState.isPressAndHoldBarrier) {
          detailParts.push(`Verification barrier still visible at ${afterState.url}.`);
        } else if (beforeState.isVerificationBarrier) {
          detailParts.push(`Verification state changed after the hold at ${afterState.url}.`);
        }
        return [
          { type: 'text', text: detailParts.join(' ') },
          ...imageResult(shot.base64),
        ];
      }
      case 'zoom': {
        const region = Array.isArray(input.region) ? input.region : null;
        if (!region || region.length < 4) {
          return textResult('Error: region [x, y, width, height] is required for zoom.');
        }
        const clip = {
          x: Math.max(0, Math.round(Number(region[0]) || 0)),
          y: Math.max(0, Math.round(Number(region[1]) || 0)),
          width: Math.max(1, Math.round(Number(region[2]) || 1)),
          height: Math.max(1, Math.round(Number(region[3]) || 1)),
        };
        const shot = await this.takeScreenshot(page, clip);
        return imageResult(shot.base64);
      }
      default:
        return textResult(`Unknown computer action: ${action}`);
    }
  }

  async #executeNavigate(input) {
    const page = await this.#getPageForInput(input);
    const url = String(input.url || '').trim();
    if (!url) return textResult('Navigation failed: url is required.');
    if (url === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    } else if (url === 'forward') {
      await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => null);
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const shot = await this.takeScreenshot(page);
    return imageResult(shot.base64);
  }

  async #executeReadPage(input) {
    const page = await this.#getPageForInput(input);
    const tree = await page.evaluate(
      generateAccessibilityTree,
      {
        filter: input.filter === 'all' ? 'all' : 'interactive',
        maxDepth: Number(input.depth) || 12,
        maxChars: Number(input.max_chars) || 15000,
        scopeRefId: input.ref_id ? String(input.ref_id) : null,
      },
    );
    return textResult(tree || '(no accessibility tree data)');
  }

  async #executeFormInput(input) {
    const page = await this.#getPageForInput(input);
    const result = await page.evaluate(
      setFormValue,
      {
        refId: String(input.ref || ''),
        value: input.value,
      },
    );
    return textResult(result || 'form_input executed');
  }

  async #executeFind(input, context) {
    if (!context.anthropicClient) {
      return textResult('Error: find is unavailable because no Anthropic client is configured.');
    }
    const page = await this.#getPageForInput(input);
    const query = String(input.query || '').trim();
    if (!query) return textResult('Error: query is required.');
    const tree = await page.evaluate(
      generateAccessibilityTree,
      {
        filter: 'all',
        maxDepth: 15,
        maxChars: 50000,
        scopeRefId: null,
      },
    );
    if (!tree) return textResult('Could not read page for find.');

    const response = await context.anthropicClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: `You are helping find elements on a web page. Given this accessibility tree and a search query, return the matching elements.\n\nAccessibility tree:\n${tree}\n\nSearch query: "${query}"\n\nReturn your results in this exact format:\nFOUND: <number of matches>\nThen for each match, one per line:\n<ref_id> | <role> | <name> | <reason for match>\n\nReturn at most 20 matches. If no matches found, return:\nFOUND: 0`,
        },
      ],
    });
    if (((response.usage?.input_tokens || 0) > 0 || (response.usage?.output_tokens || 0) > 0) && typeof context.onModelUsage === 'function') {
      context.onModelUsage({
        model: 'claude-haiku-4-5-20251001',
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
        source: 'tool_find',
      });
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text || '')
      .join('\n');
    return textResult(text || 'FOUND: 0');
  }

  async #executeGetPageText(input) {
    const page = await this.#getPageForInput(input);
    const text = await page.evaluate(extractPageText, Number(input.max_chars) || 10000);
    return textResult(text || '(no page text)');
  }

  async #executeJavascript(input) {
    const page = await this.#getPageForInput(input);
    const code = String(input.text || '');
    const verificationState = await this.#readVerificationState(page);
    if (verificationState.isPressAndHoldBarrier && isSyntheticPointerJavascript(code)) {
      return textResult(
        'Error: Synthetic DOM mouse/touch events are unreliable on this verification page. Use the computer tool with action "press_and_hold" instead.',
      );
    }
    const result = await page.evaluate((evalCode) => {
      try {
        const value = eval(evalCode);
        if (typeof value === 'undefined') return 'undefined';
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }, code);
    return textResult(String(result || 'undefined'));
  }

  async #executeTabsContext() {
    const tabs = await this.tabsContext();
    const lines = tabs.map((tab) => `Tab ${tab.id}: "${tab.title}" (${tab.url})${tab.active ? ' [ACTIVE]' : ''}`);
    return textResult(lines.join('\n') || 'No tabs found.');
  }

  async #executeTabsCreate() {
    const tab = await this.createTab();
    return textResult(`Created and activated new tab with ID ${tab.id}.`);
  }

  async #executeTabsActivate(input) {
    const requestedTabId = Number(input.tabId);
    if (!Number.isFinite(requestedTabId)) {
      return textResult('Error: tabId is required for tabs_activate.');
    }
    const page = this.pagesById.get(requestedTabId);
    if (!page || page.isClosed()) {
      return textResult(`Error: Tab ${requestedTabId} not found.`);
    }
    this.activePageId = requestedTabId;
    await page.bringToFront().catch(() => {});
    return textResult(`Activated tab ${requestedTabId}.`);
  }

  async #executeResizeWindow(input) {
    const width = Math.max(320, Math.min(2400, Number(input.width) || this.viewport.width));
    const height = Math.max(240, Math.min(1600, Number(input.height) || this.viewport.height));
    this.viewport = { width, height };
    const page = await this.#getPageForInput(input);
    await page.setViewportSize({ width, height });
    const shot = await this.takeScreenshot(page);
    return [{ type: 'text', text: `Viewport resized to ${width}x${height}.` }, ...imageResult(shot.base64)];
  }
}
