import { getTursoClient } from "@/lib/turso";

export type AgentRecord = {
  id: number;
  username_lower: string;
  username_display: string;
  private_key_hash: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

let schemaReady = false;

export async function ensureSchema() {
  if (schemaReady) return;
  const client = getTursoClient();

  const statements = [
    `CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_lower TEXT NOT NULL UNIQUE,
      username_display TEXT NOT NULL,
      private_key_hash TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_username_lower ON agents(username_lower)",
  ];

  for (const sql of statements) {
    await client.execute(sql);
  }

  schemaReady = true;
}

export async function getAgentByUsername(usernameLower: string) {
  await ensureSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM agents WHERE username_lower = ? LIMIT 1",
    args: [usernameLower],
  });
  return (result.rows?.[0] as AgentRecord | undefined) ?? null;
}

export async function createAgent(params: {
  usernameLower: string;
  usernameDisplay: string;
  privateKeyHash: string;
  description?: string | null;
}) {
  await ensureSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO agents (
      username_lower, username_display, private_key_hash, description, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)` ,
    args: [
      params.usernameLower,
      params.usernameDisplay,
      params.privateKeyHash,
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
