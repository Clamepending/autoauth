// Phase 4 cleanup: drop the legacy autoauth-local tables that are now
// owned by vibe-id (handles, referrals, email-claims).
//
// Safe to run after deploy when:
//   - autoauth uses vibe-id /v1/users/by-handle for handle lookups
//   - autoauth uses vibe-id /v1/claims for email-claim creation
//   - autoauth uses vibe-id Stripe webhook for referral qualification
//   - ensureHumanAccountSchema no longer creates human_referrals or
//     human_credit_claims
//
// Idempotent: DROP TABLE IF EXISTS.
//
// Usage:
//   set -a; . ./.env.production.local; set +a
//   node scripts/vibe-id-migration/phase4-drop-local-claims-referrals.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DB_URL?.trim();
const authToken = process.env.TURSO_DB_AUTH_TOKEN?.trim();
if (!url) {
  console.error("TURSO_DB_URL is required.");
  process.exit(1);
}

const client = createClient({ url, authToken: authToken || undefined });

const tablesToDrop = [
  "human_credit_claims",
  "human_referrals",
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
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('human_credit_claims','human_referrals')",
);
if (remaining.rows?.length) {
  console.error(
    "[fail] some tables still present:",
    remaining.rows.map((r) => r.name).join(", "),
  );
  process.exit(1);
}

console.log("[ok] all phase 4 legacy tables dropped.");
