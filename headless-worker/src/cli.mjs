import dotenv from 'dotenv';
import { ensureWorkerLayout, getConfigPath, getProfileDir, getTraceRoot, getWorkerHome, loadWorkerConfig, parseCliArgs, saveWorkerConfig, boolFromFlag, intFromFlag } from './config.mjs';
import { pairDevice } from './ottoauth-client.mjs';
import { runWorker } from './worker.mjs';

dotenv.config();

function printUsage() {
  console.log(`OttoAuth Headless Worker

Commands:
  pair    Pair or claim this device with OttoAuth
  login   Open the dedicated worker browser profile for website sign-in
  run     Poll continuously and fulfill tasks
  once    Poll once and handle at most one task
  status  Print local worker status

Common flags:
  --server https://ottoauth.vercel.app
  --device-id raspberry-pi-worker-1
  --label "Raspberry Pi Worker"
  --claim-code XXXX-XXXX-XXXX
  --browser-path /path/to/chrome
  --site snackpass
  --url https://order.snackpass.co/
  --headful
  --headless
  --keep-tabs
  --model claude-sonnet-4-5-20250929
  --wait-ms 25000
`);
}

const LOGIN_SITE_URLS = {
  snackpass: 'https://order.snackpass.co/',
};

function requireApiKey() {
  const apiKey =
    process.env.ANTHROPIC_API_KEY?.trim()
    || process.env.CLAUDE_API_KEY?.trim()
    || '';
  if (!apiKey) {
    throw new Error('Set ANTHROPIC_API_KEY before running the worker.');
  }
  return apiKey;
}

function validatePairedConfig(config) {
  if (!config?.serverUrl || !config?.deviceId || !config?.authToken) {
    throw new Error(`This worker is not paired yet. Run "npm run pair -- --server ... --device-id ... --claim-code ..." first.`);
  }
}

async function commandPair(flags) {
  const existing = await loadWorkerConfig();
  const serverUrl = String(flags.server || existing.serverUrl || '').trim();
  const deviceId = String(flags['device-id'] || existing.deviceId || 'headless-worker-1').trim();
  const deviceLabel = String(flags.label || existing.deviceLabel || deviceId).trim();
  const pairingCode = String(flags['claim-code'] || '').trim();
  const browserPath = String(flags['browser-path'] || existing.browserPath || '').trim();

  if (!serverUrl) {
    throw new Error('--server is required.');
  }
  if (!pairingCode) {
    throw new Error('--claim-code is required.');
  }

  const paired = await pairDevice({
    serverUrl,
    deviceId,
    deviceLabel,
    pairingCode,
  });

  const nextConfig = {
    ...existing,
    serverUrl: paired.serverUrl,
    deviceId: paired.deviceId,
    deviceLabel,
    authToken: paired.authToken,
    browserPath: browserPath || existing.browserPath || null,
    pairedAt: new Date().toISOString(),
  };
  await saveWorkerConfig(nextConfig);

  console.log('Paired successfully.');
  console.log(`Server: ${nextConfig.serverUrl}`);
  console.log(`Device: ${nextConfig.deviceId}`);
  console.log(`Config: ${getConfigPath()}`);
  if (paired.human?.email) {
    console.log(`Claimed by: ${paired.human.email}`);
  }
  if (paired.note) {
    console.log(`Note: ${paired.note}`);
  }
}

async function commandStatus() {
  const config = await loadWorkerConfig();
  const paired = Boolean(config.serverUrl && config.deviceId && config.authToken);
  console.log(`Home: ${getWorkerHome()}`);
  console.log(`Config: ${getConfigPath()}`);
  console.log(`Profile: ${getProfileDir()}`);
  console.log(`Traces: ${getTraceRoot()}`);
  console.log(`Paired: ${paired ? 'yes' : 'no'}`);
  if (paired) {
    console.log(`Server: ${config.serverUrl}`);
    console.log(`Device: ${config.deviceId}`);
    console.log(`Label: ${config.deviceLabel || config.deviceId}`);
    console.log(`Paired at: ${config.pairedAt || 'unknown'}`);
    console.log(`Browser path: ${config.browserPath || process.env.OTTOAUTH_BROWSER_PATH || 'auto-detect'}`);
  }
}

function resolveLoginUrl(flags) {
  const explicitUrl = typeof flags.url === 'string' ? flags.url.trim() : '';
  if (explicitUrl) return explicitUrl;
  const site = typeof flags.site === 'string' ? flags.site.trim().toLowerCase() : 'snackpass';
  return LOGIN_SITE_URLS[site] || LOGIN_SITE_URLS.snackpass;
}

async function waitForLoginExit(runtime, autoCloseMs) {
  const context = runtime.context;
  if (!context) return;

  await new Promise((resolve) => {
    let settled = false;
    let intervalId = null;
    let timeoutId = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
      resolve();
    };

    context.once('close', finish);

    intervalId = setInterval(() => {
      try {
        const openPages = context.pages().filter((page) => !page.isClosed());
        if (openPages.length === 0) {
          finish();
        }
      } catch {
        finish();
      }
    }, 500);
    intervalId.unref?.();

    if (autoCloseMs > 0) {
      timeoutId = setTimeout(finish, autoCloseMs);
      timeoutId.unref?.();
    }
  });
}

async function commandLogin(flags) {
  const config = await loadWorkerConfig();
  const browserPath = String(flags['browser-path'] || config.browserPath || '').trim() || null;
  const headless = boolFromFlag(flags.headless, false);
  const keepTabs = boolFromFlag(flags['keep-tabs'], true);
  const url = resolveLoginUrl(flags);
  const autoCloseMs = intFromFlag(flags['auto-close-ms'], 0);

  const runtime = new (await import('./browser-runtime.mjs')).BrowserRuntime({
    profileDir: getProfileDir(),
    browserPath,
    headless,
    keepTabs,
  });

  console.log(`[ottoauth-headless] Opening worker browser profile at ${url}`);
  if (!headless) {
    console.log('[ottoauth-headless] Close the browser window when you are done signing in.');
  }

  try {
    await runtime.start();
    const page = await runtime.getActivePage();
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(async () => {
      await page.goto(url).catch(() => {});
    });
    await page.bringToFront?.().catch(() => {});
    await waitForLoginExit(runtime, autoCloseMs);
  } finally {
    await runtime.stop().catch(() => {});
  }
}

async function commandRun(flags, once) {
  const config = await loadWorkerConfig();
  validatePairedConfig(config);
  const apiKey = requireApiKey();
  const browserPath = String(flags['browser-path'] || config.browserPath || '').trim() || null;
  const headless = !boolFromFlag(flags.headful, false);
  const keepTabs = boolFromFlag(flags['keep-tabs'], false);
  const waitMs = intFromFlag(flags['wait-ms'], 25000);
  const model = typeof flags.model === 'string' && flags.model.trim() ? flags.model.trim() : null;

  console.log(`[ottoauth-headless] Starting ${once ? 'one-shot' : 'continuous'} worker for ${config.deviceId} on ${config.serverUrl}.`);
  await runWorker({
    config,
    apiKey,
    profileDir: getProfileDir(),
    traceRoot: getTraceRoot(),
    once,
    headless,
    browserPath,
    keepTabs,
    waitMs,
    model,
    logger: console,
  });
}

async function main() {
  await ensureWorkerLayout();
  const argv = process.argv.slice(2);
  const command = argv[0];
  const { flags } = parseCliArgs(argv.slice(1));

  if (!command || command === '--help' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'pair') {
    await commandPair(flags);
    return;
  }
  if (command === 'status') {
    await commandStatus();
    return;
  }
  if (command === 'login') {
    await commandLogin(flags);
    return;
  }
  if (command === 'run') {
    await commandRun(flags, false);
    return;
  }
  if (command === 'once') {
    await commandRun(flags, true);
    return;
  }

  throw new Error(`Unknown command "${command}".`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
