#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.OTTOAUTH_BASE_URL || "https://ottoauth.vercel.app";
const CREDS_PATH =
  process.env.OTTOAUTH_DEMO_CREDS ||
  path.join(process.cwd(), ".demo-agent-creds.json");
const DEFAULT_DEVICE = process.env.OTTOAUTH_DEVICE_ID || "local-device-1";
const DEFAULT_BROWSER_TOKEN = process.env.OTTOAUTH_BROWSER_TOKEN || "";

function usage() {
  console.log(`Usage:
  node scripts/demo-agent.mjs init [username]
  node scripts/demo-agent.mjs register-device <browser-token>
  node scripts/demo-agent.mjs open <url-or-task-prompt...>
  node scripts/demo-agent.mjs run <task-prompt...>
  node scripts/demo-agent.mjs status <run_id>
  node scripts/demo-agent.mjs events <run_id> [limit]

Environment:
  OTTOAUTH_BASE_URL   (default: ${BASE_URL})
  OTTOAUTH_DEVICE_ID  (default: ${DEFAULT_DEVICE})
  OTTOAUTH_BROWSER_TOKEN (preferred if set; share token from extension popup)
  OTTOAUTH_DEMO_CREDS (default: ${CREDS_PATH})
`);
}

async function readCreds() {
  const raw = await fs.readFile(CREDS_PATH, "utf8").catch(() => null);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed?.username || !parsed?.private_key) return null;
  return parsed;
}

async function writeCreds(creds) {
  await fs.writeFile(CREDS_PATH, JSON.stringify(creds, null, 2) + "\n", "utf8");
}

async function postJson(pathname, body) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // leave as null
  }
  if (!res.ok) {
    const err = new Error(
      `HTTP ${res.status} ${res.statusText}${json?.error ? `: ${json.error}` : ""}`
    );
    err.response = json ?? text;
    throw err;
  }
  return json;
}

function normalizeUrlPrompt(input) {
  const joined = input.trim();
  if (!joined) return "";
  try {
    const url = new URL(joined);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `Open ${url.toString()}`;
    }
  } catch {
    // not a direct URL; treat as task prompt
  }
  return joined;
}

async function ensureAgent(username = "testagent") {
  const existing = await readCreds();
  if (existing) return existing;

  const create = await postJson("/api/agents/create", {
    username,
    description: "Local demo agent script",
  });
  const creds = {
    username: create.username,
    private_key: create.privateKey,
    created_at: new Date().toISOString(),
    base_url: BASE_URL,
  };
  await writeCreds(creds);
  return creds;
}

async function cmdInit(usernameArg) {
  const username = (usernameArg || "testagent").trim();
  const creds = await ensureAgent(username);
  console.log(JSON.stringify({
    ok: true,
    message: "Demo agent credentials ready",
    creds_path: CREDS_PATH,
    username: creds.username,
    base_url: BASE_URL,
  }, null, 2));
}

async function cmdRun(promptText) {
  if (!promptText) {
    throw new Error("Missing task prompt. Use `open <url>` or `run <task prompt>`.");
  }
  const creds = await readCreds();
  if (!creds) {
    throw new Error(`No credentials found at ${CREDS_PATH}. Run 'init' first.`);
  }

  const run = await postJson("/api/computeruse/runs", {
    username: creds.username,
    private_key: creds.private_key,
    ...(DEFAULT_BROWSER_TOKEN ? { device: DEFAULT_BROWSER_TOKEN } : { device: DEFAULT_DEVICE }),
    task_prompt: promptText,
  });

  console.log(JSON.stringify(run, null, 2));
}

async function cmdRegisterDevice(browserTokenArg) {
  const browserToken = (browserTokenArg || DEFAULT_BROWSER_TOKEN).trim();
  if (!browserToken) {
    throw new Error("Missing browser token. Pass it as an argument or set OTTOAUTH_BROWSER_TOKEN.");
  }
  const creds = await readCreds();
  if (!creds) {
    throw new Error(`No credentials found at ${CREDS_PATH}. Run 'init' first.`);
  }

  const result = await postJson("/api/computeruse/register-device", {
    username: creds.username,
    private_key: creds.private_key,
    browser_token: browserToken,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdOpen(args) {
  const joined = args.join(" ").trim();
  const taskPrompt = normalizeUrlPrompt(joined);
  await cmdRun(taskPrompt);
}

async function cmdStatus(runId) {
  if (!runId) throw new Error("Missing run_id.");
  const creds = await readCreds();
  if (!creds) throw new Error(`No credentials found at ${CREDS_PATH}. Run 'init' first.`);
  const status = await postJson(`/api/computeruse/runs/${encodeURIComponent(runId)}`, {
    username: creds.username,
    private_key: creds.private_key,
  });
  console.log(JSON.stringify(status, null, 2));
}

async function cmdEvents(runId, limitArg) {
  if (!runId) throw new Error("Missing run_id.");
  const creds = await readCreds();
  if (!creds) throw new Error(`No credentials found at ${CREDS_PATH}. Run 'init' first.`);
  const limit = limitArg ? Number(limitArg) : 50;
  const events = await postJson(`/api/computeruse/runs/${encodeURIComponent(runId)}/events`, {
    username: creds.username,
    private_key: creds.private_key,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  console.log(JSON.stringify(events, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    usage();
    process.exit(0);
  }

  if (cmd === "init") {
    await cmdInit(args[0]);
    return;
  }

  if (cmd === "open") {
    await cmdOpen(args);
    return;
  }

  if (cmd === "register-device") {
    await cmdRegisterDevice(args[0]);
    return;
  }

  if (cmd === "run") {
    await cmdRun(args.join(" ").trim());
    return;
  }

  if (cmd === "status") {
    await cmdStatus(args[0]);
    return;
  }

  if (cmd === "events") {
    await cmdEvents(args[0], args[1]);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  if (err?.response) {
    console.error(JSON.stringify(err.response, null, 2));
  }
  process.exit(1);
});
