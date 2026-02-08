import { createClient, type Client } from "@libsql/client";

let tursoClient: Client | null = null;

export function getTursoClient() {
  if (!tursoClient) {
    const url = process.env.TURSO_DB_URL ?? "file:./local.db";
    const authToken = process.env.TURSO_DB_AUTH_TOKEN;
    tursoClient = createClient({ url, authToken });
  }
  return tursoClient;
}
