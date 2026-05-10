// Phase 3 cleanup: drop the legacy tables that no longer have any
// readers or writers in the autoauth code after the vibe-id cutover.
//
// Safe to run when:
//   - addCreditLedgerEntry no longer mirror-writes to credit_ledger
//   - sendHumanCreditTransfer routes through vibe-id /v1/transfer (no
//     human_credit_transfers writes/reads)
//   - dev-login is gone (no human_sessions writes)
//   - getHumanCreditBalance / listCreditLedgerEntries no longer fall
//     back to credit_ledger
//   - createPendingHumanCreditClaim / claim / expire all use vibe-id
//
// Idempotent: uses DROP TABLE IF EXISTS.
//
// Usage:
//   TURSO_DB_URL=... TURSO_DB_AUTH_TOKEN=... node scripts/vibe-id-migration/phase3-drop-legacy-tables.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DB_URL?.trim();
const authToken = process.env.TURSO_DB_AUTH_TOKEN?.trim();
if (!url) {
  console.error("TURSO_DB_URL is required.");
  process.exit(1);
}

const client = createClient({ url, authToken: authToken || undefined });

const tablesToDrop = [
  "credit_ledger",
  "human_credit_transfers",
  "human_sessions",
];

for (const table of tablesToDrop) {
  const before = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [table],
  });
  if (!before.rows?.length) {
    console.log(`[skip] ${table} — already absent`);
    continue;
  }
  const countResult = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  const rowCount = Number(countResult.rows?.[0]?.n ?? 0);
  await client.execute(`DROP TABLE IF EXISTS ${table}`);
  console.log(`[drop] ${table} — was ${rowCount} rows, now gone`);
}

const remaining = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('credit_ledger','human_credit_transfers','human_sessions')",
);
if (remaining.rows?.length) {
  console.error(
    "[fail] some tables still present:",
    remaining.rows.map((r) => r.name).join(", "),
  );
  process.exit(1);
}

console.log("[ok] all legacy tables dropped.");
