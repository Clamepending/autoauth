import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_HOME = process.env.OTTOAUTH_WORKER_HOME?.trim()
  ? expandUserPath(process.env.OTTOAUTH_WORKER_HOME.trim())
  : path.join(os.homedir(), '.ottoauth-headless-worker');
const PROFILE_DIR_OVERRIDE = process.env.OTTOAUTH_PROFILE_DIR?.trim()
  ? expandUserPath(process.env.OTTOAUTH_PROFILE_DIR.trim())
  : null;

export function expandUserPath(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function getWorkerHome() {
  return DEFAULT_HOME;
}

export function getConfigPath() {
  return path.join(DEFAULT_HOME, 'config.json');
}

export function getProfileDir() {
  return PROFILE_DIR_OVERRIDE || path.join(DEFAULT_HOME, 'profile');
}

export function getTraceRoot() {
  return path.join(DEFAULT_HOME, 'traces');
}

export async function ensureWorkerLayout() {
  await fs.mkdir(DEFAULT_HOME, { recursive: true });
  await fs.mkdir(getProfileDir(), { recursive: true });
  await fs.mkdir(getTraceRoot(), { recursive: true });
}

export async function loadWorkerConfig() {
  await ensureWorkerLayout();
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function saveWorkerConfig(config) {
  await ensureWorkerLayout();
  await fs.writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function parseCliArgs(argv) {
  const args = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.trim();
    if (!key) continue;
    if (inlineValue != null) {
      flags[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { args, flags };
}

export function boolFromFlag(value, defaultValue = false) {
  if (value == null) return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export function intFromFlag(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : defaultValue;
}
