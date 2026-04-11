import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ottoauth-headless-worker-'));
process.env.OTTOAUTH_WORKER_HOME = tempHome;
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'dummy-test-key';

const [{ getProfileDir, getTraceRoot, saveWorkerConfig, loadWorkerConfig }, { BrowserRuntime }, { pairDevice, reportTaskResult, uploadTaskSnapshot, waitForTask }, { runWorker }] =
  await Promise.all([
    import('../src/config.mjs'),
    import('../src/browser-runtime.mjs'),
    import('../src/ottoauth-client.mjs'),
    import('../src/worker.mjs'),
  ]);

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH || ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function createMockServer() {
  const state = {
    pairRequests: [],
    waitCalls: 0,
    snapshots: [],
    completions: [],
    queue: [],
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const bodyChunks = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const rawBody = Buffer.concat(bodyChunks).toString('utf8');
    const jsonBody = rawBody ? JSON.parse(rawBody) : null;

    if (req.method === 'POST' && url.pathname === '/api/computeruse/device/pair') {
      state.pairRequests.push(jsonBody);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        device: { id: jsonBody.device_id, label: jsonBody.device_label },
        deviceToken: 'mock-device-token',
        human: { email: 'human@example.com', displayName: 'Human' },
        note: 'paired',
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/computeruse/device/wait-task') {
      state.waitCalls += 1;
      const next = state.queue.shift() || null;
      if (!next) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(next));
      return;
    }

    const snapshotMatch = url.pathname.match(/^\/api\/computeruse\/device\/tasks\/([^/]+)\/snapshot$/);
    if (req.method === 'POST' && snapshotMatch) {
      state.snapshots.push({
        taskId: snapshotMatch[1],
        body: jsonBody,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const completionMatch = url.pathname.match(/^\/api\/computeruse\/device\/tasks\/([^/]+)\/local-agent-complete$/);
    if (req.method === 'POST' && completionMatch) {
      state.completions.push({
        taskId: completionMatch[1],
        body: jsonBody,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return {
    state,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert(address && typeof address === 'object');
      return `http://127.0.0.1:${address.port}`;
    },
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function main() {
  const workerRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cliPath = path.join(workerRoot, 'src', 'cli.mjs');
  const mock = createMockServer();
  const baseUrl = await mock.start();

  const help = await runCommand('node', [cliPath, 'help'], workerRoot);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /OttoAuth Headless Worker/);

  const status = await runCommand('node', [cliPath, 'status'], workerRoot);
  assert.equal(status.code, 0);
  assert.match(status.stdout, /Paired: no/);

  const missingPairArg = await runCommand('node', [cliPath, 'pair', '--server', baseUrl], workerRoot);
  assert.notEqual(missingPairArg.code, 0);
  assert.match(missingPairArg.stderr, /--claim-code is required|--server, --device-id, and --claim-code are required/);

  const pairResult = await pairDevice({
    serverUrl: baseUrl,
    deviceId: 'verify-worker-1',
    deviceLabel: 'Verify Worker',
    pairingCode: 'TEST-CODE',
  });
  assert.equal(pairResult.authToken, 'mock-device-token');

  await saveWorkerConfig({
    serverUrl: baseUrl,
    deviceId: 'verify-worker-1',
    deviceLabel: 'Verify Worker',
    authToken: 'mock-device-token',
  });
  const loadedConfig = await loadWorkerConfig();
  assert.equal(loadedConfig.deviceId, 'verify-worker-1');

  const noTask = await waitForTask(loadedConfig, 10);
  assert.equal(noTask, null);

  const runtime = new BrowserRuntime({
    profileDir: getProfileDir(),
    headless: true,
  });
  await runtime.start();
  await runtime.prepareTaskWorkspace();
  const snapshotPayload = await runtime.snapshotForOttoAuth();
  assert.equal(Array.isArray(snapshotPayload.tabs), true);
  assert.ok(snapshotPayload.image_base64.length > 0);
  await uploadTaskSnapshot(loadedConfig, 'snapshot-test', snapshotPayload);
  await runtime.startTaskTrace(path.join(getTraceRoot(), 'verify-trace.zip'));
  await runtime.snapshotForOttoAuth();
  await runtime.stopTaskTrace();
  await runtime.stop();

  assert.equal(mock.state.snapshots.length >= 1, true);

  await reportTaskResult(loadedConfig, 'result-test', {
    status: 'completed',
    result: { status: 'completed', summary: 'ok', charges: { goods_cents: 0, shipping_cents: 0, tax_cents: 0, other_cents: 0, currency: 'usd' } },
    error: null,
    usages: [],
  });
  assert.equal(mock.state.completions.length >= 1, true);

  mock.state.queue.push({
    id: 'goal-less-task',
    type: 'start_local_agent_goal',
    url: null,
    goal: null,
    taskPrompt: null,
    deviceId: 'verify-worker-1',
    createdAt: new Date().toISOString(),
  });

  await runWorker({
    config: loadedConfig,
    apiKey: 'fake-key-not-used',
    profileDir: getProfileDir(),
    traceRoot: getTraceRoot(),
    once: true,
    headless: true,
    logger: console,
  });

  const goalLessCompletion = mock.state.completions.find((entry) => entry.taskId === 'goal-less-task');
  assert(goalLessCompletion, 'Expected goal-less task completion to be reported');
  assert.equal(goalLessCompletion.body.status, 'failed');
  assert.match(goalLessCompletion.body.error, /did not include a goal or URL/);

  const dryRun = await runCommand(
    'bash',
    [
      path.join(workerRoot, 'scripts', 'bootstrap.sh'),
      '--server', baseUrl,
      '--device-id', 'verify-worker-1',
      '--claim-code', 'TEST-CODE',
      '--dry-run',
    ],
    path.dirname(workerRoot),
  );
  assert.equal(dryRun.code, 0);
  assert.match(dryRun.stdout, /Would install npm dependencies/);

  console.log('Headless worker verification passed.');
  await mock.stop();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
