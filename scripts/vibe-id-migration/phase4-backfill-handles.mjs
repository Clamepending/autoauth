// Phase 4 — backfill vibe-id handles from autoauth's local human_users.
//
// For every linked human user with a non-null handle_lower, PUT the same
// handle to vibe-id /v1/users/:vibe_id_user_id/handle so the user keeps
// their existing @username on the global identity layer.
//
// Idempotent: vibe-id rejects duplicate handles for OTHER users with 409,
// but accepts re-setting your own handle to the same value as a no-op.
//
// Usage:
//   set -a; . ./.env.production.local; set +a
//   node scripts/vibe-id-migration/phase4-backfill-handles.mjs

import { createClient } from "@libsql/client";

const VIBE = (process.env.VIBE_ID_BASE_URL || "").trim().replace(/\/+$/, "");
const KEY = (process.env.VIBE_ID_INTERNAL_KEY || "").trim();
if (!VIBE || !KEY) {
  console.error("VIBE_ID_BASE_URL and VIBE_ID_INTERNAL_KEY are required.");
  process.exit(1);
}

const turso = createClient({ url: process.env.TURSO_DB_URL, authToken: process.env.TURSO_DB_AUTH_TOKEN });
const result = await turso.execute("SELECT id, vibe_id_user_id, email, handle_lower, handle_display FROM human_users WHERE vibe_id_user_id IS NOT NULL ORDER BY vibe_id_user_id");
console.log(`Found ${result.rows.length} linked humans to backfill.`);

let success = 0;
let skipped = 0;
let failed = 0;

for (const row of result.rows) {
  const vibeIdUserId = Number(row.vibe_id_user_id);
  const handleDisplay = row.handle_display ?? row.handle_lower;
  const handleLower = row.handle_lower;
  if (!handleLower) {
    console.log(`  human ${row.id} (vibe-id ${vibeIdUserId}, ${row.email}): no local handle — vibe-id will auto-assign on next sign-in`);
    skipped += 1;
    continue;
  }
  const r = await fetch(`${VIBE}/v1/users/${vibeIdUserId}/handle`, {
    method: "PUT",
    headers: { "x-internal-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ handle: handleDisplay ?? handleLower }),
  });
  const body = await r.json();
  if (r.ok) {
    console.log(`  human ${row.id} (vibe-id ${vibeIdUserId}, ${row.email}): @${body.handle_display}`);
    success += 1;
  } else if (r.status === 409) {
    // Already taken — could be the user's own handle (idempotent re-set
    // shouldn't 409, but let's check) or a genuine conflict.
    const lookup = await fetch(`${VIBE}/v1/users/by-handle/${encodeURIComponent(handleLower)}`, {
      headers: { "x-internal-key": KEY },
    }).then(r => r.json()).catch(() => null);
    if (lookup?.user?.id === vibeIdUserId) {
      console.log(`  human ${row.id} (vibe-id ${vibeIdUserId}): @${handleLower} already set (idempotent)`);
      success += 1;
    } else {
      console.error(`  human ${row.id} (vibe-id ${vibeIdUserId}): handle conflict — @${handleLower} taken by user ${lookup?.user?.id ?? "?"}`);
      failed += 1;
    }
  } else {
    console.error(`  human ${row.id} (vibe-id ${vibeIdUserId}): ${r.status} ${JSON.stringify(body)}`);
    failed += 1;
  }
}

console.log(`\n[done] ${success} backfilled, ${skipped} skipped, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
