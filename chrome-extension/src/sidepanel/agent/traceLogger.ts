import { STORAGE_KEY_OTTOAUTH_URL } from '../../shared/constants';

export interface SemanticTarget {
  role: string;
  name: string;
  tag?: string;
  inputType?: string;
}

export interface TraceEvent {
  tool: string;
  action?: string;
  input: Record<string, unknown>;
  domain: string;
  url: string;
  timestamp: number;
  success: boolean;
  macroReplay?: boolean;
  semanticTarget?: SemanticTarget;
}

export interface TaskTrace {
  id: string;
  domain: string;
  goal: string;
  events: TraceEvent[];
  startedAt: number;
  completedAt: number;
  taskSuccess: boolean;
}

const TRACE_STORAGE_PREFIX = 'macro_traces_';
const MAX_TRACES_PER_DOMAIN = 50;
const LAST_MINE_PREFIX = 'macro_last_mine_';

let currentTrace: TaskTrace | null = null;
let insideMacroReplay = false;

export function setMacroReplayFlag(active: boolean): void {
  insideMacroReplay = active;
}

export function startTrace(goal: string): void {
  currentTrace = {
    id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    domain: '',
    goal,
    events: [],
    startedAt: Date.now(),
    completedAt: 0,
    taskSuccess: false,
  };
}

export function logEvent(
  tool: string,
  input: Record<string, unknown>,
  success: boolean,
  tabUrl?: string,
  semanticTarget?: SemanticTarget,
): void {
  if (!currentTrace) return;

  let domain = '';
  let url = tabUrl || '';
  if (url) {
    try {
      domain = new URL(url).hostname;
    } catch { /* invalid url */ }
  }

  if (domain && !currentTrace.domain) {
    currentTrace.domain = domain;
  }

  const action = tool === 'computer' ? (input.action as string) : undefined;

  const cleanInput = sanitizeInput(input);

  currentTrace.events.push({
    tool,
    action,
    input: cleanInput,
    domain,
    url,
    timestamp: Date.now(),
    success,
    ...(insideMacroReplay ? { macroReplay: true } : {}),
    ...(semanticTarget ? { semanticTarget } : {}),
  });
}

function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    if (key === 'screenshot' || key === 'imageData') continue;
    if (typeof val === 'string' && val.length > 500) {
      clean[key] = val.slice(0, 500);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export async function finalizeTrace(success: boolean): Promise<string | null> {
  if (!currentTrace) return null;

  currentTrace.completedAt = Date.now();
  currentTrace.taskSuccess = success;

  if (!currentTrace.domain && currentTrace.events.length > 0) {
    for (const ev of currentTrace.events) {
      if (ev.domain) {
        currentTrace.domain = ev.domain;
        break;
      }
    }
  }

  if (!currentTrace.domain) {
    currentTrace.domain = '_unknown';
  }

  const domain = currentTrace.domain;
  const trace = { ...currentTrace };
  currentTrace = null;

  await persistTrace(domain, trace);
  uploadTraceToBackend(domain, trace).catch((e) =>
    console.warn('[TraceLogger] backend upload failed (non-fatal):', e),
  );
  return domain;
}

export function getCurrentTrace(): TaskTrace | null {
  return currentTrace;
}

async function persistTrace(domain: string, trace: TaskTrace): Promise<void> {
  const key = TRACE_STORAGE_PREFIX + normalizeDomain(domain);
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      let traces: TaskTrace[] = (result[key] as TaskTrace[]) || [];
      traces.push(trace);
      if (traces.length > MAX_TRACES_PER_DOMAIN) {
        traces = traces.slice(traces.length - MAX_TRACES_PER_DOMAIN);
      }
      chrome.storage.local.set({ [key]: traces }, resolve);
    });
  });
}

export async function getTraces(domain: string): Promise<TaskTrace[]> {
  const key = TRACE_STORAGE_PREFIX + normalizeDomain(domain);
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve((result[key] as TaskTrace[]) || []);
    });
  });
}

export async function getTracesSinceLastMine(domain: string): Promise<TaskTrace[]> {
  const lastMineTime = await getLastMineTime(domain);
  const traces = await getTraces(domain);
  return traces.filter((t) => t.completedAt > lastMineTime);
}

export async function setLastMineTime(domain: string): Promise<void> {
  const key = LAST_MINE_PREFIX + normalizeDomain(domain);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: Date.now() }, resolve);
  });
}

async function getLastMineTime(domain: string): Promise<number> {
  const key = LAST_MINE_PREFIX + normalizeDomain(domain);
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve((result[key] as number) || 0);
    });
  });
}

function normalizeDomain(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9.-]/g, '_');
}

async function getBackendUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_OTTOAUTH_URL], (result) => {
      resolve((result[STORAGE_KEY_OTTOAUTH_URL] as string) || null);
    });
  });
}

async function uploadTraceToBackend(domain: string, trace: TaskTrace): Promise<void> {
  const backendUrl = await getBackendUrl();
  if (!backendUrl) return;

  const res = await fetch(`${backendUrl}/api/macros/traces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, trace }),
  });

  if (!res.ok) {
    console.warn(`[TraceLogger] backend returned ${res.status}`);
  }
}
