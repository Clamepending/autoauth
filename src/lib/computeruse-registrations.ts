import { ensureSchema } from "@/lib/db";
import { getTursoClient } from "@/lib/turso";

export type ComputerUseAgentDeviceRegistration = {
  agent_username_lower: string;
  device_id: string;
  browser_token: string | null;
  created_at: string;
  updated_at: string;
};

let schemaReady = false;

async function ensureComputerUseRegistrationSchema() {
  if (schemaReady) return;
  await ensureSchema();
  const client = getTursoClient();
  await client.execute(
    `CREATE TABLE IF NOT EXISTS computeruse_agent_device_registrations (
      agent_username_lower TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      browser_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_cu_reg_device_id ON computeruse_agent_device_registrations(device_id)"
  );
  schemaReady = true;
}

export async function registerAgentDefaultComputerUseDevice(params: {
  agentUsernameLower: string;
  deviceId: string;
  browserToken?: string | null;
}) {
  await ensureComputerUseRegistrationSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const existing = await getAgentDefaultComputerUseDevice(params.agentUsernameLower);
  await client.execute({
    sql: `INSERT INTO computeruse_agent_device_registrations
          (agent_username_lower, device_id, browser_token, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(agent_username_lower) DO UPDATE SET
            device_id = excluded.device_id,
            browser_token = excluded.browser_token,
            updated_at = excluded.updated_at`,
    args: [
      params.agentUsernameLower.trim().toLowerCase(),
      params.deviceId.trim(),
      params.browserToken?.trim() || null,
      existing?.created_at ?? now,
      now,
    ],
  });
  return getAgentDefaultComputerUseDevice(params.agentUsernameLower);
}

export async function getAgentDefaultComputerUseDevice(agentUsernameLower: string) {
  await ensureComputerUseRegistrationSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM computeruse_agent_device_registrations
          WHERE agent_username_lower = ? LIMIT 1`,
    args: [agentUsernameLower.trim().toLowerCase()],
  });
  return (result.rows?.[0] as unknown as ComputerUseAgentDeviceRegistration | undefined) ?? null;
}
