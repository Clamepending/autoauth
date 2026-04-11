import dotenv from 'dotenv';
import { ensureWorkerLayout, getConfigPath, getProfileDir, getTraceRoot, getWorkerHome, loadWorkerConfig, parseCliArgs, saveWorkerConfig, boolFromFlag, intFromFlag } from './config.mjs';
import { pairDevice } from './ottoauth-client.mjs';
import { runWorker } from './worker.mjs';

dotenv.config();

function printUsage() {
  console.log(`OttoAuth Headless Worker

Commands:
  pair    Pair or claim this device with OttoAuth
  run     Poll continuously and fulfill tasks
  once    Poll once and handle at most one task
  status  Print local worker status

Common flags:
  --server https://ottoauth.vercel.app
  --device-id raspberry-pi-worker-1
  --label "Raspberry Pi Worker"
  --claim-code XXXX-XXXX-XXXX
  --browser-path /path/to/chrome
  --headful
  --keep-tabs
  --model claude-sonnet-4-5-20250929
  --wait-ms 25000
`);
}

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
