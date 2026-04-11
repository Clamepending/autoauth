#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.LOCAL_AGENT_HOST || '127.0.0.1';
const PORT = Number(process.env.LOCAL_AGENT_PORT || 8787);
const DEFAULT_MODEL = process.env.LOCAL_AGENT_DEFAULT_MODEL || 'claude-sonnet-4-5-20250929';
const DATA_DIR = process.env.LOCAL_AGENT_DATA_DIR || path.join(__dirname, '..', '.local-control');
const DATA_FILE = path.join(DATA_DIR, 'requests.json');
const MACROS_FILE = path.join(DATA_DIR, 'macros.json');

/** @typedef {'queued'|'running'|'completed'|'failed'|'stopped'} RequestStatus */

/** @typedef {{
 * id: string;
 * taskDescription: string;
 * model: string;
 * source: 'local_control';
 * status: RequestStatus;
 * createdAt: string;
 * updatedAt: string;
 * claimedAt?: string | null;
 * startedAt?: string | null;
 * completedAt?: string | null;
 * executionDurationMs?: number | null;
 * stopRequested?: boolean;
 * sessionId?: string | null;
 * summary?: string | null;
 * error?: string | null;
 * result?: Record<string, unknown> | null;
 * traceDirectoryName?: string | null;
 * recordingFolderName?: string | null;
 * workerId?: string | null;
 * }} LocalRequest */

/** @type {{ requests: LocalRequest[] }} */
let state = { requests: [] };
/** @type {{ macros: Record<string, unknown>[]; updatedAt: string | null }} */
let macroState = { macros: [], updatedAt: null };
let saveQueue = Promise.resolve();

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function emptyResponse(res, statusCode = 204) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end();
}

async function ensureStorage() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    await writeFile(DATA_FILE, JSON.stringify(state, null, 2));
  }
  if (!existsSync(MACROS_FILE)) {
    await writeFile(MACROS_FILE, JSON.stringify(macroState, null, 2));
  }
}

async function loadState() {
  await ensureStorage();
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.requests)) {
      state = { requests: parsed.requests };
    }
  } catch (error) {
    console.warn('[local-control-server] Failed to read state, starting fresh.', error);
    state = { requests: [] };
  }
}

async function loadMacroState() {
  await ensureStorage();
  try {
    const raw = await readFile(MACROS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.macros)) {
      macroState = {
        macros: parsed.macros,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      };
    }
  } catch (error) {
    console.warn('[local-control-server] Failed to read macro state, starting fresh.', error);
    macroState = { macros: [], updatedAt: null };
  }
}

async function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  saveQueue = saveQueue.then(async () => {
    await ensureStorage();
    const tempFile = `${DATA_FILE}.${Date.now()}.tmp`;
    await writeFile(tempFile, snapshot);
    await rename(tempFile, DATA_FILE);
  });
  return saveQueue;
}

async function saveMacroState() {
  const snapshot = JSON.stringify(macroState, null, 2);
  saveQueue = saveQueue.then(async () => {
    await ensureStorage();
    const tempFile = `${MACROS_FILE}.${Date.now()}.tmp`;
    await writeFile(tempFile, snapshot);
    await rename(tempFile, MACROS_FILE);
  });
  return saveQueue;
}

function sortRequestsNewestFirst(requests) {
  return [...requests].sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (updatedDiff !== 0) return updatedDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function nextQueuedRequest() {
  return [...state.requests]
    .filter((request) => request.status === 'queued')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0] || null;
}

function findRequest(requestId) {
  return state.requests.find((request) => request.id === requestId) || null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function titleCaseToken(value) {
  const text = String(value || '').trim();
  if (!text) return 'Site';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeDomainPattern(value) {
  let normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/\/.*$/, '');
  normalized = normalized.replace(/^\*\./, '');
  normalized = normalized.replace(/^www\./, '');
  return normalized.replace(/\.+$/, '');
}

function labelFromDomain(value) {
  const normalized = normalizeDomainPattern(value);
  const firstToken = normalized.split('.').filter(Boolean)[0] || 'site';
  return titleCaseToken(firstToken);
}

function normalizeScope(raw) {
  if (isPlainObject(raw.scope)) {
    const scopeType = raw.scope.type === 'domain' ? 'domain' : 'global';
    if (scopeType === 'domain') {
      const domainPattern = normalizeDomainPattern(raw.scope.domainPattern || raw.domainPattern || raw.domain || raw.site);
      return {
        type: 'domain',
        label: String(raw.scope.label || labelFromDomain(domainPattern || 'site')).trim(),
        domainPattern,
      };
    }
    return { type: 'global', label: String(raw.scope.label || 'All websites').trim() || 'All websites' };
  }

  const domainPattern = normalizeDomainPattern(raw.domainPattern || raw.domain || raw.site || raw.scope);
  if (domainPattern) {
    return {
      type: 'domain',
      label: labelFromDomain(domainPattern),
      domainPattern,
    };
  }
  return { type: 'global', label: 'All websites' };
}

function normalizeMacroRecord(raw, index = 0) {
  if (!isPlainObject(raw)) {
    throw new Error(`Macro at index ${index} must be an object.`);
  }

  const name = String(raw.name || '').trim();
  if (!name) {
    throw new Error(`Macro at index ${index} is missing a name.`);
  }
  const steps = Array.isArray(raw.steps)
    ? raw.steps
    : Array.isArray(raw.actions)
      ? raw.actions
      : null;
  if (!steps || steps.length === 0) {
    throw new Error(`Macro "${name}" must include a non-empty steps array.`);
  }

  const now = new Date().toISOString();
  const id = String(raw.id || `remote_macro_${Date.now()}_${randomUUID().slice(0, 8)}`).trim();
  const normalized = {
    ...raw,
    id,
    name,
    description: String(raw.description || '').trim(),
    scope: normalizeScope(raw),
    parameters: Array.isArray(raw.parameters) ? raw.parameters : [],
    steps,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : now,
    updatedAt: now,
    origin: 'remote',
  };
  return normalized;
}

function sortMacros(macros) {
  return [...macros].sort((left, right) => {
    const leftScope = String(left.scope?.label || '');
    const rightScope = String(right.scope?.label || '');
    return leftScope.localeCompare(rightScope) || String(left.name || '').localeCompare(String(right.name || ''));
  });
}

function upsertMacros(records) {
  const byId = new Map(macroState.macros.map((macro) => [macro.id, macro]));
  for (const record of records) {
    byId.set(record.id, record);
  }
  macroState = {
    macros: sortMacros(Array.from(byId.values())),
    updatedAt: new Date().toISOString(),
  };
}

function replaceMacros(records) {
  macroState = {
    macros: sortMacros(records),
    updatedAt: new Date().toISOString(),
  };
}

function deleteMacros(ids) {
  const deleteSet = new Set(ids.map((id) => String(id || '').trim()).filter(Boolean));
  macroState = {
    macros: macroState.macros.filter((macro) => !deleteSet.has(String(macro.id || ''))),
    updatedAt: new Date().toISOString(),
  };
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function handleEnqueue(req, res) {
  const body = await parseJsonBody(req);
  const taskDescription = String(body.task_desc || '').trim();
  const model = String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  if (!taskDescription) {
    return jsonResponse(res, 400, { error: 'task_desc is required' });
  }

  const now = new Date().toISOString();
  const request = {
    id: `req_${Date.now()}_${randomUUID().slice(0, 8)}`,
    taskDescription,
    model,
    source: 'local_control',
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    executionDurationMs: null,
    stopRequested: false,
    sessionId: null,
    summary: null,
    error: null,
    result: null,
    traceDirectoryName: null,
    recordingFolderName: null,
    workerId: null,
  };

  state.requests.unshift(request);
  await saveState();
  return jsonResponse(res, 201, { ok: true, request });
}

function handleListRequests(_req, res) {
  return jsonResponse(res, 200, { ok: true, requests: sortRequestsNewestFirst(state.requests) });
}

function handleListMacros(_req, res) {
  return jsonResponse(res, 200, {
    ok: true,
    macros: macroState.macros,
    count: macroState.macros.length,
    updatedAt: macroState.updatedAt,
  });
}

function handleGetRequestInfo(reqUrl, res) {
  const requestId = reqUrl.searchParams.get('request_id');
  if (!requestId) {
    return jsonResponse(res, 400, { error: 'request_id is required' });
  }
  const request = findRequest(requestId);
  if (!request) {
    return jsonResponse(res, 404, { error: 'Request not found' });
  }
  return jsonResponse(res, 200, { ok: true, request });
}

async function handleStopRequest(req, res) {
  const body = await parseJsonBody(req);
  const requestId = String(body.request_id || '').trim();
  if (!requestId) {
    return jsonResponse(res, 400, { error: 'request_id is required' });
  }
  const request = findRequest(requestId);
  if (!request) {
    return jsonResponse(res, 404, { error: 'Request not found' });
  }

  const now = new Date().toISOString();
  if (request.status === 'queued') {
    request.status = 'stopped';
    request.stopRequested = true;
    request.summary = request.summary || 'Stopped before the worker claimed the request.';
    request.completedAt = now;
    request.executionDurationMs = null;
  } else if (request.status === 'running') {
    request.stopRequested = true;
    request.summary = request.summary || 'Stop requested.';
  }
  request.updatedAt = now;
  await saveState();
  return jsonResponse(res, 200, { ok: true, request });
}

async function handleClaimNext(req, res) {
  const body = await parseJsonBody(req);
  const workerId = String(body.worker_id || 'local-browser-worker');
  const request = nextQueuedRequest();
  if (!request) {
    return emptyResponse(res, 204);
  }
  const now = new Date().toISOString();
  request.status = 'running';
  request.claimedAt = now;
  request.startedAt = now;
  request.updatedAt = now;
  request.executionDurationMs = null;
  request.workerId = workerId;
  request.stopRequested = false;
  await saveState();
  return jsonResponse(res, 200, { ok: true, request });
}

async function handleRequestUpdate(req, res) {
  const body = await parseJsonBody(req);
  const requestId = String(body.request_id || '').trim();
  if (!requestId) {
    return jsonResponse(res, 400, { error: 'request_id is required' });
  }
  const request = findRequest(requestId);
  if (!request) {
    return jsonResponse(res, 404, { error: 'Request not found' });
  }

  const status = body.status;
  const validStatuses = new Set(['running', 'completed', 'failed', 'stopped']);
  if (typeof status === 'string' && validStatuses.has(status)) {
    request.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'summary')) {
    request.summary = typeof body.summary === 'string' ? body.summary : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'error')) {
    request.error = typeof body.error === 'string' ? body.error : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'result')) {
    request.result = body.result && typeof body.result === 'object' ? body.result : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sessionId')) {
    request.sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'traceDirectoryName')) {
    request.traceDirectoryName = typeof body.traceDirectoryName === 'string' ? body.traceDirectoryName : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'recordingFolderName')) {
    request.recordingFolderName = typeof body.recordingFolderName === 'string' ? body.recordingFolderName : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'executionDurationMs')) {
    request.executionDurationMs = typeof body.executionDurationMs === 'number' ? body.executionDurationMs : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'stopRequested')) {
    request.stopRequested = Boolean(body.stopRequested);
  }

  request.updatedAt = new Date().toISOString();
  if (request.status === 'completed' || request.status === 'failed' || request.status === 'stopped') {
    request.completedAt = request.updatedAt;
    if (request.executionDurationMs == null && request.startedAt) {
      const startedTime = new Date(request.startedAt).getTime();
      const completedTime = new Date(request.completedAt).getTime();
      if (!Number.isNaN(startedTime) && !Number.isNaN(completedTime)) {
        request.executionDurationMs = Math.max(0, completedTime - startedTime);
      }
    }
  }

  await saveState();
  return jsonResponse(res, 200, { ok: true, request });
}

async function handleReplaceMacros(req, res) {
  const body = await parseJsonBody(req);
  return await applyReplaceMacros(body, res);
}

async function applyReplaceMacros(body, res) {
  if (!Array.isArray(body.macros)) {
    return jsonResponse(res, 400, { error: 'macros array is required' });
  }
  const normalized = body.macros.map((macro, index) => normalizeMacroRecord(macro, index));
  replaceMacros(normalized);
  await saveMacroState();
  return jsonResponse(res, 200, {
    ok: true,
    macros: macroState.macros,
    count: macroState.macros.length,
    updatedAt: macroState.updatedAt,
  });
}

async function handleUpsertMacros(req, res) {
  const body = await parseJsonBody(req);
  return await applyUpsertMacros(body, res);
}

async function applyUpsertMacros(body, res) {
  const incoming = Array.isArray(body.macros)
    ? body.macros
    : isPlainObject(body.macro)
      ? [body.macro]
      : isPlainObject(body)
        ? [body]
        : null;
  if (!incoming || incoming.length === 0) {
    return jsonResponse(res, 400, { error: 'Provide a macro object or macros array.' });
  }
  const normalized = incoming.map((macro, index) => normalizeMacroRecord(macro, index));
  upsertMacros(normalized);
  await saveMacroState();
  return jsonResponse(res, 200, {
    ok: true,
    macros: normalized,
    count: macroState.macros.length,
    updatedAt: macroState.updatedAt,
  });
}

async function handleDeleteMacros(req, res) {
  const body = await parseJsonBody(req);
  return await applyDeleteMacros(body, res);
}

async function applyDeleteMacros(body, res) {
  const ids = Array.isArray(body.macro_ids)
    ? body.macro_ids
    : body.macro_id
      ? [body.macro_id]
      : body.id
        ? [body.id]
        : [];
  if (ids.length === 0) {
    return jsonResponse(res, 400, { error: 'Provide macro_id, id, or macro_ids.' });
  }
  deleteMacros(ids);
  await saveMacroState();
  return jsonResponse(res, 200, {
    ok: true,
    count: macroState.macros.length,
    updatedAt: macroState.updatedAt,
  });
}

async function handlePostMacros(req, res) {
  const body = await parseJsonBody(req);
  const mode = String(body.mode || body.action || body.operation || '').trim().toLowerCase();
  if (mode === 'replace' || body.replace === true) {
    return await applyReplaceMacros(body, res);
  }
  if (mode === 'delete' || mode === 'remove' || body.delete === true || body.remove === true) {
    return await applyDeleteMacros(body, res);
  }
  return await applyUpsertMacros(body, res);
}

await loadState();
await loadMacroState();

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    return jsonResponse(res, 400, { error: 'Missing URL' });
  }
  if (req.method === 'OPTIONS') {
    return emptyResponse(res, 204);
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      return jsonResponse(res, 200, {
        ok: true,
        host: HOST,
        port: PORT,
        requestCount: state.requests.length,
        macroCount: macroState.macros.length,
        capabilities: {
          enqueue: 'POST /enqueue',
          requestList: 'GET /list_requests',
          requestInfo: 'GET /get_request_info?request_id=...',
          requestStop: 'POST /stop_request',
          macrosList: 'GET /macros',
          macrosPost: 'POST /macros',
          macrosPostModes: ['upsert (default)', 'replace', 'delete'],
          macrosPostBodies: [
            '{ name, scope, steps, ... }',
            '{ macro: { ... } }',
            '{ macros: [ ... ] }',
            '{ mode: "replace", macros: [ ... ] }',
            '{ mode: "delete", macro_id: "..." }',
          ],
          macrosUpsert: 'POST /macros/upsert',
          macrosReplace: 'POST /macros/replace',
          macrosDelete: 'POST /macros/delete',
        },
      });
    }
    if (req.method === 'POST' && reqUrl.pathname === '/enqueue') {
      return await handleEnqueue(req, res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/list_requests') {
      return handleListRequests(req, res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/get_request_info') {
      return handleGetRequestInfo(reqUrl, res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/macros') {
      return handleListMacros(req, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/macros') {
      return await handlePostMacros(req, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/stop_request') {
      return await handleStopRequest(req, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/macros/replace') {
      return await handleReplaceMacros(req, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/macros/upsert') {
      return await handleUpsertMacros(req, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/macros/delete') {
      return await handleDeleteMacros(req, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/internal/claim_next') {
      return await handleClaimNext(req, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/internal/request_update') {
      return await handleRequestUpdate(req, res);
    }
    return jsonResponse(res, 404, { error: 'Not found' });
  } catch (error) {
    return jsonResponse(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[local-control-server] listening on http://${HOST}:${PORT}`);
  console.log(`[local-control-server] persisting requests in ${DATA_FILE}`);
  console.log(`[local-control-server] persisting macros in ${MACROS_FILE}`);
});
