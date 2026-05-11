// Phase 5: garbage-collect pre-vibe-id `human_users` rows that never got
// linked. These are leftover from before the migration — users who signed
// in via the legacy Google flow but never came back after vibe-id launched.
// They can't use any post-Phase-3 feature (every credit op fails fast on
// missing vibe_id_user_id), they bloat queries, and they trip the unique
// email constraint if those users ever try to sign up fresh.
//
// Default: dry-run. Lists rows that WOULD be deleted, doesn't touch them.
// Pass --apply to actually delete.
//
// Safety:
//   - never deletes a row with vibe_id_user_id set
//   - never deletes a row that has any associated human_agent_links,
//     human_device_pairing_codes, or owns rows in ottoauth_orders /
//     amazon_orders / snackpass_orders (they tie back to human_user_id)
//
// Usage:
//   set -a; . ./.env.production.local; set +a
//   node scripts/vibe-id-migration/phase5-gc-unlinked-human-users.mjs       # dry-run
//   node scripts/vibe-id-migration/phase5-gc-unlinked-human-users.mjs --apply

import { createClient } from "@libsql/client";

const APPLY = process.argv.includes("--apply");
const turso = createClient({ url: process.env.TURSO_DB_URL, authToken: process.env.TURSO_DB_AUTH_TOKEN });

// Candidate set: unlinked human_users.
const candidates = await turso.execute(
  "SELECT id, email, auth_provider, created_at FROM human_users WHERE vibe_id_user_id IS NULL ORDER BY id ASC",
);
console.log(`Found ${candidates.rows.length} unlinked human_users rows.`);

const deletable = [];
const keepers = [];

for (const row of candidates.rows) {
  const id = Number(row.id);
  // Look for any references that would orphan if deleted.
  const refs = await turso.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM human_agent_links WHERE human_user_id = ?) AS agent_links,
            (SELECT COUNT(*) FROM human_device_pairing_codes WHERE human_user_id = ?) AS pairing_codes`,
    args: [id, id],
  });
  const r = refs.rows[0] ?? {};
  const agentLinks = Number(r.agent_links ?? 0);
  const pairingCodes = Number(r.pairing_codes ?? 0);

  // Check for orders too. Some order tables may not exist anymore, so
  // wrap each in try/catch.
  let orderCount = 0;
  for (const sql of [
    "SELECT COUNT(*) AS n FROM ottoauth_orders WHERE human_user_id = ?",
    "SELECT COUNT(*) AS n FROM amazon_orders WHERE human_user_id = ?",
    "SELECT COUNT(*) AS n FROM snackpass_orders WHERE human_user_id = ?",
  ]) {
    try {
      const result = await turso.execute({ sql, args: [id] });
      orderCount += Number(result.rows?.[0]?.n ?? 0);
    } catch {
      // Table missing — fine.
    }
  }

  const hasReferences = agentLinks > 0 || pairingCodes > 0 || orderCount > 0;
  if (hasReferences) {
    keepers.push({ id, email: row.email, agentLinks, pairingCodes, orderCount });
  } else {
    deletable.push({ id, email: row.email, auth_provider: row.auth_provider, created_at: row.created_at });
  }
}

console.log(`\n${deletable.length} deletable (no references):`);
for (const row of deletable.slice(0, 20)) {
  console.log(`  human_user_id=${row.id} email=${row.email} auth_provider=${row.auth_provider} created_at=${row.created_at}`);
}
if (deletable.length > 20) console.log(`  ...and ${deletable.length - 20} more`);

console.log(`\n${keepers.length} kept (have references):`);
for (const row of keepers.slice(0, 10)) {
  console.log(`  human_user_id=${row.id} email=${row.email} agent_links=${row.agentLinks} pairing_codes=${row.pairingCodes} orders=${row.orderCount}`);
}
if (keepers.length > 10) console.log(`  ...and ${keepers.length - 10} more`);

if (!APPLY) {
  console.log("\n[dry-run] Re-run with --apply to delete the deletable rows.");
  process.exit(0);
}

console.log(`\n[apply] deleting ${deletable.length} rows...`);
let deleted = 0;
for (const row of deletable) {
  const result = await turso.execute({
    sql: "DELETE FROM human_users WHERE id = ? AND vibe_id_user_id IS NULL",
    args: [row.id],
  });
  if (result.rowsAffected && result.rowsAffected > 0) deleted += 1;
}
console.log(`[apply] deleted ${deleted} rows.`);
