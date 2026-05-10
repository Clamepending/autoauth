/**
 * One-shot migration: link every existing autoauth human_user to a vibe-id
 * user, then copy their local credit balance into vibe-id's ledger.
 *
 * Run with `--dry-run` first (default) to see what it WOULD do without
 * writing. Re-runs are safe: vibe-id /v1/grant uses an idempotency key
 * derived from `migration-v1-${humanUserId}`, so a second run won't
 * double-grant.
 *
 *   npx tsx scripts/vibe-id-migration/migrate-balances-to-vibe-id.ts          # dry-run
 *   npx tsx scripts/vibe-id-migration/migrate-balances-to-vibe-id.ts --apply  # real
 *
 * Required env: VIBE_ID_BASE_URL, VIBE_ID_INTERNAL_KEY, plus whatever
 * autoauth needs to talk to its own SQLite/Turso DB.
 */

import {
  ensureHumanAccountSchema,
  getHumanCreditBalance,
  setVibeIdUserIdForHuman,
  type HumanUserRecord,
} from "../../src/lib/human-accounts.js";
import {
  grantCreditsToUser,
  upsertVibeUserByGoogleSubject,
} from "../../src/lib/vibe-id-client.js";
import { getTursoClient } from "../../src/lib/turso.js";

const DRY_RUN = !process.argv.includes("--apply");

interface MigrationResult {
  humanUserId: number;
  email: string;
  outcome:
    | "linked_and_granted"
    | "already_linked"
    | "skipped_no_google_sub"
    | "skipped_zero_balance"
    | "failed";
  vibeIdUserId?: number;
  balanceCents?: number;
  errorMessage?: string;
}

async function main() {
  console.log(`[migrate-balances] DRY_RUN=${DRY_RUN}`);
  await ensureHumanAccountSchema();

  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT id, email, email_verified, google_sub, auth_provider,
                 handle_lower, handle_display, display_name, picture_url,
                 vibe_id_user_id, created_at, updated_at
          FROM human_users
          ORDER BY id`,
    args: [],
  });

  const allHumanUsers = (result.rows ?? []) as unknown as Array<HumanUserRecord & {
    vibe_id_user_id: number | bigint | null;
    google_sub: string | null;
    picture_url: string | null;
  }>;

  console.log(`[migrate-balances] inspecting ${allHumanUsers.length} human_users rows`);

  const outcomes: MigrationResult[] = [];

  for (const humanUserRow of allHumanUsers) {
    const humanUserId = Number(humanUserRow.id);
    const email = String(humanUserRow.email);
    const googleSubject = humanUserRow.google_sub ? String(humanUserRow.google_sub) : null;
    const existingVibeIdUserId = humanUserRow.vibe_id_user_id != null
      ? Number(humanUserRow.vibe_id_user_id)
      : null;

    if (existingVibeIdUserId) {
      outcomes.push({
        humanUserId,
        email,
        outcome: "already_linked",
        vibeIdUserId: existingVibeIdUserId,
      });
      continue;
    }

    if (!googleSubject) {
      // Dev-mode users (auth_provider='dev') don't have a Google subject.
      // We can't create a matching vibe-id user without one. Skip — these
      // users will get linked when they next sign in via vibe-id (their
      // first vibe-id sign-in upserts a row by Google sub).
      outcomes.push({ humanUserId, email, outcome: "skipped_no_google_sub" });
      continue;
    }

    const balanceCents = await getHumanCreditBalance(humanUserId);

    if (DRY_RUN) {
      outcomes.push({
        humanUserId,
        email,
        outcome: balanceCents > 0 ? "linked_and_granted" : "skipped_zero_balance",
        balanceCents,
      });
      continue;
    }

    try {
      const upsertResult = await upsertVibeUserByGoogleSubject({
        googleSubject,
        email,
        displayName: humanUserRow.display_name,
        pictureUrl: humanUserRow.picture_url,
      });
      if (!upsertResult.ok) {
        outcomes.push({
          humanUserId, email, outcome: "failed",
          errorMessage: `upsert failed: ${upsertResult.status} ${upsertResult.error}`,
        });
        continue;
      }
      const vibeIdUserId = upsertResult.user.id;

      await setVibeIdUserIdForHuman(humanUserId, vibeIdUserId);

      if (balanceCents > 0) {
        const grantResult = await grantCreditsToUser({
          vibeIdUserId,
          amountCents: balanceCents,
          reason: `autoauth migration v1: copied local credit_ledger SUM (humanUserId=${humanUserId})`,
          idempotencyKey: `migration-v1-${humanUserId}`,
        });
        if (!grantResult.ok) {
          outcomes.push({
            humanUserId, email, vibeIdUserId, outcome: "failed",
            errorMessage: `grant failed: ${grantResult.status} ${grantResult.error}`,
          });
          continue;
        }
      }

      outcomes.push({
        humanUserId, email, vibeIdUserId, balanceCents,
        outcome: balanceCents > 0 ? "linked_and_granted" : "skipped_zero_balance",
      });
    } catch (error) {
      outcomes.push({
        humanUserId, email, outcome: "failed",
        errorMessage: (error as Error).message,
      });
    }
  }

  const summary = outcomes.reduce<Record<string, number>>((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n[migrate-balances] ${DRY_RUN ? "DRY-RUN " : ""}summary:`, summary);

  for (const row of outcomes) {
    const balanceLabel = row.balanceCents != null ? ` $${(row.balanceCents / 100).toFixed(2)}` : "";
    const linkLabel = row.vibeIdUserId != null ? ` → vibe_id_user_id=${row.vibeIdUserId}` : "";
    const errorLabel = row.errorMessage ? ` ERROR: ${row.errorMessage}` : "";
    console.log(`  [${row.outcome}] human_user_id=${row.humanUserId} ${row.email}${linkLabel}${balanceLabel}${errorLabel}`);
  }

  const failed = outcomes.filter((row) => row.outcome === "failed").length;
  if (failed > 0) {
    console.error(`\n[migrate-balances] ${failed} row(s) failed. Check the log and re-run after fixing.`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(`\n[migrate-balances] DRY-RUN complete. Re-run with --apply to actually write.`);
  } else {
    console.log(`\n[migrate-balances] Migration complete.`);
  }
}

main().catch((error) => {
  console.error(`[migrate-balances] unhandled error`, error);
  process.exit(1);
});
