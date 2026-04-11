import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3110';
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim() || '';

if (!anthropicApiKey) {
  throw new Error('Set ANTHROPIC_API_KEY before running live-local-e2e.');
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const header of setCookies) {
      const first = header.split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) {
        const name = first.slice(0, eq);
        const value = first.slice(eq + 1);
        this.cookies.set(name, value);
      }
    }
  }

  header() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

async function request(route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.json) headers.set('content-type', 'application/json');
  if (options.cookieJar) {
    const cookie = options.cookieJar.header();
    if (cookie) headers.set('cookie', cookie);
  }
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || (options.json ? 'POST' : 'GET'),
    headers,
    body: options.json ? JSON.stringify(options.json) : options.body,
    redirect: 'manual',
  });
  options.cookieJar?.capture(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data, text };
}

function spawnCommand(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:${process.env.PATH || ''}`,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      process.stdout.write(String(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      process.stderr.write(String(chunk));
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const workerRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const tempWorkerHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ottoauth-live-worker-'));
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const jar = new CookieJar();
  const humanEmail = `live-worker-${suffix}@example.com`;
  const deviceId = `live-worker-${suffix}`;
  const taskTitle = `Live headless worker smoke ${suffix}`;

  const loginRes = await request('/api/auth/dev-login', {
    cookieJar: jar,
    json: {
      email: humanEmail,
      display_name: 'Live Worker Test',
    },
  });
  assert(loginRes.response.ok, `Dev login failed: ${loginRes.text}`);

  const codeRes = await request('/api/human/devices/pairing-code', {
    cookieJar: jar,
    json: {
      device_label: deviceId,
    },
  });
  assert(codeRes.response.ok, `Pairing code create failed: ${codeRes.text}`);
  const claimCode = codeRes.data.code;
  assert(claimCode, 'Missing claim code');

  const pairRes = await spawnCommand(
    'node',
    ['./src/cli.mjs', 'pair', '--server', baseUrl, '--device-id', deviceId, '--label', deviceId, '--claim-code', claimCode],
    workerRoot,
    {
      OTTOAUTH_WORKER_HOME: tempWorkerHome,
      ANTHROPIC_API_KEY: anthropicApiKey,
    },
  );
  assert.equal(pairRes.code, 0, `Worker pair command failed: ${pairRes.stderr || pairRes.stdout}`);

  const submitRes = await request('/api/human/tasks', {
    cookieJar: jar,
    json: {
      task_title: taskTitle,
      task_prompt: 'Open https://example.com, confirm the page loaded successfully, do not sign in anywhere, do not buy anything, and return the required JSON only.',
      fulfillment_mode: 'own_device',
      max_charge_cents: 50,
    },
  });
  assert(submitRes.response.ok, `Human task submit failed: ${submitRes.text}`);
  const taskId = submitRes.data.task.id;
  assert(taskId, 'Missing human task id');

  const onceRes = await spawnCommand(
    'node',
    ['./src/cli.mjs', 'once'],
    workerRoot,
    {
      OTTOAUTH_WORKER_HOME: tempWorkerHome,
      ANTHROPIC_API_KEY: anthropicApiKey,
    },
  );
  assert.equal(onceRes.code, 0, `Worker once command failed: ${onceRes.stderr || onceRes.stdout}`);

  const detailRes = await request(`/api/human/tasks/${taskId}`, { cookieJar: jar });
  assert(detailRes.response.ok, `Task detail failed: ${detailRes.text}`);
  assert.equal(detailRes.data.task.status, 'completed', `Expected completed task, got ${detailRes.data.task.status}`);
  assert.equal(detailRes.data.task.billing_status === 'debited' || detailRes.data.task.billing_status === 'completed_no_charge', true);
  assert(detailRes.data.latest_snapshot?.image_base64, 'Expected live snapshot on task detail');
  assert(detailRes.data.task.summary, 'Expected task summary');

  const meRes = await request('/api/human/me', { cookieJar: jar });
  assert(meRes.response.ok, `Human me failed: ${meRes.text}`);
  assert.equal(meRes.data.balance_cents, 2000, `Expected self-fulfilled balance to remain 2000, got ${meRes.data.balance_cents}`);

  const traceEntries = await fs.readdir(path.join(tempWorkerHome, 'traces'));
  assert(traceEntries.length > 0, 'Expected at least one trace directory');

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    taskId,
    summary: detailRes.data.task.summary,
    billing_status: detailRes.data.task.billing_status,
    payout_status: detailRes.data.task.payout_status,
    balance_cents: meRes.data.balance_cents,
    trace_entries: traceEntries.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
