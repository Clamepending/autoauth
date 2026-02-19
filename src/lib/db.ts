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

  await client.execute(
    `CREATE TABLE IF NOT EXISTS amazon_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_lower TEXT NOT NULL,
      item_url TEXT NOT NULL,
      shipping_location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Submitted',
      stripe_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await client.execute("CREATE INDEX IF NOT EXISTS idx_amazon_orders_username ON amazon_orders(username_lower)");
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

export type AmazonOrderRecord = {
  id: number;
  username_lower: string;
  item_url: string;
  shipping_location: string;
  status: string;
  stripe_session_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function createAmazonOrder(params: {
  usernameLower: string;
  itemUrl: string;
  shippingLocation: string;
  stripeSessionId?: string | null;
}) {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const insertResult = await client.execute({
    sql: `INSERT INTO amazon_orders (username_lower, item_url, shipping_location, status, stripe_session_id, created_at, updated_at)
          VALUES (?, ?, ?, 'Submitted', ?, ?, ?)`,
    args: [
      params.usernameLower,
      params.itemUrl,
      params.shippingLocation,
      params.stripeSessionId ?? null,
      now,
      now,
    ],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  let id = rawId != null ? Number(rawId) : 0;
  if (id === 0) {
    const fallback = await client.execute({ sql: "SELECT last_insert_rowid() AS id", args: [] });
    id = (fallback.rows?.[0] as unknown as { id: number } | undefined)?.id ?? 0;
  }
  const row = await getAmazonOrderById(id);
  if (!row) throw new Error("Amazon order creation failed.");
  return row;
}

export async function getAmazonOrdersByUsername(usernameLower: string): Promise<AmazonOrderRecord[]> {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM amazon_orders WHERE username_lower = ? ORDER BY created_at DESC",
    args: [usernameLower],
  });
  return (result.rows ?? []) as unknown as AmazonOrderRecord[];
}

export async function getAmazonOrderById(id: number): Promise<AmazonOrderRecord | null> {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM amazon_orders WHERE id = ? LIMIT 1",
    args: [id],
  });
  return (result.rows?.[0] as unknown as AmazonOrderRecord | undefined) ?? null;
}

export async function updateAmazonOrderStripeSession(orderId: number, stripeSessionId: string | null): Promise<void> {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE amazon_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?",
    args: [stripeSessionId, now, orderId],
  });
}

export async function updateAmazonOrderStatus(orderId: number, status: string): Promise<void> {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE amazon_orders SET status = ?, updated_at = ? WHERE id = ?",
    args: [status, now, orderId],
  });
}

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

export async function getAllAgents(): Promise<AgentRecord[]> {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT id, username_lower, username_display, private_key, description, created_at, updated_at FROM agents ORDER BY created_at DESC",
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
