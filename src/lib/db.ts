import { getTursoClient } from "@/lib/turso";
import { SUPPORTED_SERVICE_IDS } from "@/lib/services";

export type AgentRecord = {
  id: number;
  username_lower: string;
  username_display: string;
  private_key: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

let schemaReady = false;

export async function ensureSchema() {
  if (schemaReady) return;
  const client = getTursoClient();

  await client.execute(
    `CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_lower TEXT NOT NULL UNIQUE,
      username_display TEXT NOT NULL,
      private_key TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );

  const tableInfo = await client.execute({
    sql: "PRAGMA table_info(agents)",
    args: [],
  });
  const columns = (tableInfo.rows ?? []) as unknown as { name: string }[];
  const hasOldSchema = columns.some((c) => c.name === "private_key_hash") && !columns.some((c) => c.name === "private_key");
  if (hasOldSchema) {
    await client.execute("DROP TABLE agents");
    await client.execute(
      `CREATE TABLE agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username_lower TEXT NOT NULL UNIQUE,
        username_display TEXT NOT NULL,
        private_key TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );
  }

  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_username_lower ON agents(username_lower)");

  await client.execute(
    `CREATE TABLE IF NOT EXISTS agent_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_lower TEXT NOT NULL,
      request_type TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    )`
  );
  await client.execute("CREATE INDEX IF NOT EXISTS idx_agent_requests_username ON agent_requests(username_lower)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_agent_requests_status ON agent_requests(status)");
  schemaReady = true;
}

export type AgentRequestRecord = {
  id: number;
  username_lower: string;
  request_type: string;
  message: string | null;
  status: string;
  created_at: string;
};

export const REQUEST_TYPES = SUPPORTED_SERVICE_IDS;

export type RequestType = (typeof REQUEST_TYPES)[number];

export async function createAgentRequest(params: {
  usernameLower: string;
  requestType: string;
  message?: string | null;
}) {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const insertResult = await client.execute({
    sql: `INSERT INTO agent_requests (username_lower, request_type, message, status, created_at)
          VALUES (?, ?, ?, 'pending', ?)`,
    args: [
      params.usernameLower,
      params.requestType,
      params.message ?? null,
      now,
    ],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  let id = rawId != null ? Number(rawId) : 0;
  if (id === 0) {
    const fallback = await client.execute({ sql: "SELECT last_insert_rowid() AS id", args: [] });
    id = (fallback.rows?.[0] as unknown as { id: number } | undefined)?.id ?? 0;
  }
  if (id === 0) throw new Error("Request creation failed.");
  const getResult = await client.execute({
    sql: "SELECT * FROM agent_requests WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = getResult.rows?.[0] as unknown as AgentRequestRecord | undefined;
  if (!row) throw new Error("Request creation failed.");
  return row;
}

export async function getAgentByUsername(usernameLower: string) {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM agents WHERE username_lower = ? LIMIT 1",
    args: [usernameLower],
  });
  return (result.rows?.[0] as unknown as AgentRecord | undefined) ?? null;
}

export async function createAgent(params: {
  usernameLower: string;
  usernameDisplay: string;
  privateKey: string;
  description?: string | null;
}) {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO agents (
      username_lower, username_display, private_key, description, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)` ,
    args: [
      params.usernameLower,
      params.usernameDisplay,
      params.privateKey,
      params.description ?? null,
      now,
      now,
    ],
  });
  const created = await getAgentByUsername(params.usernameLower);
  if (!created) throw new Error("Agent creation failed.");
  return created;
}

export async function updateAgentDescription(params: {
  usernameLower: string;
  description: string | null;
}) {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE agents SET description = ?, updated_at = ? WHERE username_lower = ?",
    args: [params.description, now, params.usernameLower],
  });
  return getAgentByUsername(params.usernameLower);
}
