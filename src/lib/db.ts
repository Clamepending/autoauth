import { getTursoClient } from "@/lib/turso";

export type AgentRecord = {
  id: number;
  username_lower: string;
  username_display: string;
  private_key: string;
  callback_url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

let coreSchemaReady = false;

export async function ensureSchema() {
  if (coreSchemaReady) return;
  const client = getTursoClient();

  await client.execute(
    `CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_lower TEXT NOT NULL UNIQUE,
      username_display TEXT NOT NULL,
      private_key TEXT NOT NULL,
      callback_url TEXT,
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
        callback_url TEXT,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );
  }

  const hasCallbackUrl = columns.some((c) => c.name === "callback_url");
  if (!hasOldSchema && !hasCallbackUrl) {
    await client.execute("ALTER TABLE agents ADD COLUMN callback_url TEXT");
  }

  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_username_lower ON agents(username_lower)");

  await client.execute(
    `CREATE TABLE IF NOT EXISTS agent_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_lower TEXT NOT NULL,
      request_type TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolution_action TEXT,
      resolution_notes TEXT,
      resolved_at TEXT,
      callback_status TEXT NOT NULL DEFAULT 'queued',
      callback_http_status INTEGER,
      callback_error TEXT,
      callback_attempts INTEGER NOT NULL DEFAULT 0,
      callback_last_attempt_at TEXT,
      created_at TEXT NOT NULL
    )`
  );
  const requestTableInfo = await client.execute({
    sql: "PRAGMA table_info(agent_requests)",
    args: [],
  });
  const requestColumns = (requestTableInfo.rows ?? []) as unknown as { name: string }[];
  if (!requestColumns.some((c) => c.name === "resolution_action")) {
    await client.execute("ALTER TABLE agent_requests ADD COLUMN resolution_action TEXT");
  }
  if (!requestColumns.some((c) => c.name === "resolution_notes")) {
    await client.execute("ALTER TABLE agent_requests ADD COLUMN resolution_notes TEXT");
  }
  if (!requestColumns.some((c) => c.name === "resolved_at")) {
    await client.execute("ALTER TABLE agent_requests ADD COLUMN resolved_at TEXT");
  }
  if (!requestColumns.some((c) => c.name === "callback_status")) {
    await client.execute("ALTER TABLE agent_requests ADD COLUMN callback_status TEXT NOT NULL DEFAULT 'queued'");
  }
  if (!requestColumns.some((c) => c.name === "callback_http_status")) {
    await client.execute("ALTER TABLE agent_requests ADD COLUMN callback_http_status INTEGER");
  }
  if (!requestColumns.some((c) => c.name === "callback_error")) {
    await client.execute("ALTER TABLE agent_requests ADD COLUMN callback_error TEXT");
  }
  if (!requestColumns.some((c) => c.name === "callback_attempts")) {
    await client.execute("ALTER TABLE agent_requests ADD COLUMN callback_attempts INTEGER NOT NULL DEFAULT 0");
  }
  if (!requestColumns.some((c) => c.name === "callback_last_attempt_at")) {
    await client.execute("ALTER TABLE agent_requests ADD COLUMN callback_last_attempt_at TEXT");
  }
  await client.execute("CREATE INDEX IF NOT EXISTS idx_agent_requests_username ON agent_requests(username_lower)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_agent_requests_status ON agent_requests(status)");

  coreSchemaReady = true;
}

export type AgentRequestRecord = {
  id: number;
  username_lower: string;
  request_type: string;
  message: string | null;
  status: string;
  resolution_action: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  callback_status: string;
  callback_http_status: number | null;
  callback_error: string | null;
  callback_attempts: number;
  callback_last_attempt_at: string | null;
  created_at: string;
};

export type AdminAgentRequestRecord = AgentRequestRecord & {
  username_display: string;
  callback_url: string | null;
};

export async function createAgentRequest(params: {
  usernameLower: string;
  requestType: string;
  message?: string | null;
}) {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const insertResult = await client.execute({
    sql: `INSERT INTO agent_requests (username_lower, request_type, message, status, callback_status, created_at)
          VALUES (?, ?, ?, 'pending', 'queued', ?)`,
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

export async function getAgentRequestById(id: number): Promise<AdminAgentRequestRecord | null> {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT
            r.id,
            r.username_lower,
            a.username_display,
            a.callback_url,
            r.request_type,
            r.message,
            r.status,
            r.resolution_action,
            r.resolution_notes,
            r.resolved_at,
            r.callback_status,
            r.callback_http_status,
            r.callback_error,
            r.callback_attempts,
            r.callback_last_attempt_at,
            r.created_at
          FROM agent_requests r
          LEFT JOIN agents a ON a.username_lower = r.username_lower
          WHERE r.id = ?
          LIMIT 1`,
    args: [id],
  });
  return (result.rows?.[0] as unknown as AdminAgentRequestRecord | undefined) ?? null;
}

export async function getAdminAgentRequests(statuses?: string[]): Promise<AdminAgentRequestRecord[]> {
  await ensureSchema();
  const client = getTursoClient();
  if (statuses && statuses.length > 0) {
    const placeholders = statuses.map(() => "?").join(", ");
    const result = await client.execute({
      sql: `SELECT
              r.id,
              r.username_lower,
              a.username_display,
              a.callback_url,
              r.request_type,
              r.message,
              r.status,
              r.resolution_action,
              r.resolution_notes,
              r.resolved_at,
              r.callback_status,
              r.callback_http_status,
              r.callback_error,
              r.callback_attempts,
              r.callback_last_attempt_at,
              r.created_at
            FROM agent_requests r
            LEFT JOIN agents a ON a.username_lower = r.username_lower
            WHERE r.status IN (${placeholders})
            ORDER BY r.created_at DESC`,
      args: statuses,
    });
    return (result.rows ?? []) as unknown as AdminAgentRequestRecord[];
  }

  const result = await client.execute({
    sql: `SELECT
            r.id,
            r.username_lower,
            a.username_display,
            a.callback_url,
            r.request_type,
            r.message,
            r.status,
            r.resolution_action,
            r.resolution_notes,
            r.resolved_at,
            r.callback_status,
            r.callback_http_status,
            r.callback_error,
            r.callback_attempts,
            r.callback_last_attempt_at,
            r.created_at
          FROM agent_requests r
          LEFT JOIN agents a ON a.username_lower = r.username_lower
          ORDER BY r.created_at DESC`,
    args: [],
  });
  return (result.rows ?? []) as unknown as AdminAgentRequestRecord[];
}

export async function finalizeAgentRequest(params: {
  id: number;
  action: "resolved" | "rejected";
  notes: string | null;
  callbackOk: boolean;
  callbackStatusCode?: number | null;
  callbackError?: string | null;
}) {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE agent_requests
          SET status = ?,
              resolution_action = ?,
              resolution_notes = ?,
              resolved_at = ?,
              callback_status = ?,
              callback_http_status = ?,
              callback_error = ?,
              callback_attempts = COALESCE(callback_attempts, 0) + 1,
              callback_last_attempt_at = ?
          WHERE id = ?`,
    args: [
      params.callbackOk ? params.action : "notify_failed",
      params.action,
      params.notes,
      params.callbackOk ? now : null,
      params.callbackOk ? "sent" : "failed",
      params.callbackStatusCode ?? null,
      params.callbackError ?? null,
      now,
      params.id,
    ],
  });
  return getAgentRequestById(params.id);
}

export async function createAgent(params: {
  usernameLower: string;
  usernameDisplay: string;
  privateKey: string;
  callbackUrl: string;
  description?: string | null;
}) {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO agents (
      username_lower, username_display, private_key, callback_url, description, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)` ,
    args: [
      params.usernameLower,
      params.usernameDisplay,
      params.privateKey,
      params.callbackUrl,
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

export async function getAllAgents(): Promise<AgentRecord[]> {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT id, username_lower, username_display, private_key, callback_url, description, created_at, updated_at FROM agents ORDER BY created_at DESC",
    args: [],
  });
  return (result.rows ?? []) as unknown as AgentRecord[];
}

export async function getAgentById(id: number): Promise<AgentRecord | null> {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM agents WHERE id = ? LIMIT 1",
    args: [id],
  });
  return (result.rows?.[0] as unknown as AgentRecord | undefined) ?? null;
}

export async function deleteAgent(id: number): Promise<void> {
  await ensureSchema();
  const client = getTursoClient();
  const agent = await getAgentById(id);
  if (!agent) return;
  await client.execute({
    sql: "DELETE FROM agent_requests WHERE username_lower = ?",
    args: [agent.username_lower],
  });
  await client.execute({
    sql: "DELETE FROM agents WHERE id = ?",
    args: [id],
  });
}

export async function updateAgentUsername(params: {
  id: number;
  newUsernameLower: string;
  newUsernameDisplay: string;
}): Promise<AgentRecord | null> {
  await ensureSchema();
  const client = getTursoClient();
  const agent = await getAgentById(params.id);
  if (!agent) return null;
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE agent_requests SET username_lower = ? WHERE username_lower = ?",
    args: [params.newUsernameLower, agent.username_lower],
  });
  await client.execute({
    sql: "UPDATE agents SET username_lower = ?, username_display = ?, updated_at = ? WHERE id = ?",
    args: [params.newUsernameLower, params.newUsernameDisplay, now, params.id],
  });
  return getAgentByUsername(params.newUsernameLower);
}
