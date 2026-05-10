// Exercises autoauth's library functions DIRECTLY (not via HTTP) to
// verify the autoauth → vibe-id wrappers work in production. Uses
// production env (TURSO + VIBE_ID_INTERNAL_KEY) to read/write real state,
// then restores the starting balance so it's a no-op net effect.

import {
  addCreditLedgerEntry,
  getHumanCreditBalance,
  listCreditLedgerEntries,
  sendHumanCreditTransfer,
  createPendingHumanCreditClaim,
  expireExpiredHumanCreditClaims,
  claimPendingHumanCreditClaimsForUser,
  ensureHumanForVibeIdUser,
  qualifyHumanReferralAfterDeposit,
  findHumanByVibeIdUserId,
  getVibeIdUserIdForHuman,
} from "@/lib/human-accounts";
import { getCreditsBalanceForVibeUser } from "@/lib/vibe-id-client";
import { getTursoClient } from "@/lib/turso";

const HUMAN_USER_ID = 1;
const VIBE_ID_USER_ID = 1;
const SECONDARY_HUMAN_USER_ID = 17; // local id 17 = vibe-id user 2 (nautiyal@berkeley.edu)

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  [PASS] ${label} ${detail}`);
  } else {
    fail += 1;
    console.log(`  [FAIL] ${label} ${detail}`);
  }
}

async function main() {
  console.log("=== A: autoauth wrappers around vibe-id reads ===");

  const linkedFromHuman = await getVibeIdUserIdForHuman(HUMAN_USER_ID);
  check("getVibeIdUserIdForHuman(1) → 1", linkedFromHuman === VIBE_ID_USER_ID, `→ ${linkedFromHuman}`);

  const linkedFromVibe = await findHumanByVibeIdUserId(VIBE_ID_USER_ID);
  check("findHumanByVibeIdUserId(1) → human", linkedFromVibe?.id === HUMAN_USER_ID, `→ id=${linkedFromVibe?.id} email=${linkedFromVibe?.email}`);

  const balanceFromAutoauth = await getHumanCreditBalance(HUMAN_USER_ID);
  const balanceFromVibe = await getCreditsBalanceForVibeUser(VIBE_ID_USER_ID);
  check(
    "getHumanCreditBalance matches vibe-id direct",
    balanceFromVibe.ok && balanceFromAutoauth === balanceFromVibe.balanceCents,
    `autoauth=${balanceFromAutoauth} vibe-id=${balanceFromVibe.ok ? balanceFromVibe.balanceCents : "?"}`,
  );

  const ledger = await listCreditLedgerEntries(HUMAN_USER_ID, 5);
  check("listCreditLedgerEntries returns array", Array.isArray(ledger), `→ ${ledger.length} entries`);

  console.log("\n=== B: autoauth addCreditLedgerEntry round-trip ===");

  const beforeBalance = await getHumanCreditBalance(HUMAN_USER_ID);
  const idemSuffix = `phase3-tsx-${Date.now()}`;

  await addCreditLedgerEntry({
    humanUserId: HUMAN_USER_ID,
    amountCents: 100,
    entryType: "phase3_test_grant",
    description: "Phase 3 wrapper test grant",
    referenceType: "phase3_test",
    referenceId: idemSuffix,
  });
  const afterGrant = await getHumanCreditBalance(HUMAN_USER_ID);
  check("addCreditLedgerEntry +100 changed balance", afterGrant === beforeBalance + 100, `${beforeBalance} → ${afterGrant}`);

  // Idempotent — same reference should be a no-op
  await addCreditLedgerEntry({
    humanUserId: HUMAN_USER_ID,
    amountCents: 100,
    entryType: "phase3_test_grant",
    description: "Phase 3 wrapper test grant",
    referenceType: "phase3_test",
    referenceId: idemSuffix,
  });
  const afterIdem = await getHumanCreditBalance(HUMAN_USER_ID);
  check("addCreditLedgerEntry idempotent", afterIdem === afterGrant, `still ${afterIdem}`);

  await addCreditLedgerEntry({
    humanUserId: HUMAN_USER_ID,
    amountCents: -100,
    entryType: "phase3_test_charge",
    description: "Phase 3 wrapper test charge",
    referenceType: "phase3_test",
    referenceId: idemSuffix,
  });
  const afterCharge = await getHumanCreditBalance(HUMAN_USER_ID);
  check("addCreditLedgerEntry -100 charged", afterCharge === afterGrant - 100, `${afterGrant} → ${afterCharge}`);
  check("net change is zero", afterCharge === beforeBalance, `before=${beforeBalance} after=${afterCharge}`);

  console.log("\n=== C: sendHumanCreditTransfer round-trip ===");

  const senderBefore = await getHumanCreditBalance(HUMAN_USER_ID);
  const recipientBefore = await getHumanCreditBalance(SECONDARY_HUMAN_USER_ID);
  console.log(`  Before: human ${HUMAN_USER_ID}=${senderBefore} human ${SECONDARY_HUMAN_USER_ID}=${recipientBefore}`);

  const transfer = await sendHumanCreditTransfer({
    senderHumanUserId: HUMAN_USER_ID,
    recipientHumanUserId: SECONDARY_HUMAN_USER_ID,
    amountCents: 25,
    note: "Phase 3 wrapper test transfer",
  });
  check("transfer returned ok", Boolean(transfer.transfer.transfer_public_id), `tr=${transfer.transfer.transfer_public_id}`);
  check("sender balance dropped 25", transfer.senderBalanceCents === senderBefore - 25, `→ ${transfer.senderBalanceCents}`);
  const recipientAfter = await getHumanCreditBalance(SECONDARY_HUMAN_USER_ID);
  check("recipient balance rose 25", recipientAfter === recipientBefore + 25, `→ ${recipientAfter}`);

  // Reverse the transfer
  await sendHumanCreditTransfer({
    senderHumanUserId: SECONDARY_HUMAN_USER_ID,
    recipientHumanUserId: HUMAN_USER_ID,
    amountCents: 25,
    note: "Phase 3 wrapper test reverse",
  });
  const senderFinal = await getHumanCreditBalance(HUMAN_USER_ID);
  const recipientFinal = await getHumanCreditBalance(SECONDARY_HUMAN_USER_ID);
  check("transfers reversed, balances restored", senderFinal === senderBefore && recipientFinal === recipientBefore, `${senderFinal}/${senderBefore}, ${recipientFinal}/${recipientBefore}`);

  console.log("\n=== D: claim flow round-trip ===");

  const claimSenderBefore = await getHumanCreditBalance(HUMAN_USER_ID);
  const testEmail = `phase3-test-${Date.now()}@example.com`;
  const claimResult = await createPendingHumanCreditClaim({
    senderHumanUserId: HUMAN_USER_ID,
    recipientEmail: testEmail,
    amountCents: 50,
    note: "Phase 3 claim test",
  });
  check("createPendingHumanCreditClaim ok", Boolean(claimResult.claim.claim_public_id), `id=${claimResult.claim.claim_public_id}`);
  check("sender debited", claimResult.senderBalanceCents === claimSenderBefore - 50, `${claimSenderBefore} → ${claimResult.senderBalanceCents}`);

  // Force-expire by setting expires_at to past, then run expiry
  const turso = getTursoClient();
  await turso.execute({
    sql: "UPDATE human_credit_claims SET expires_at = ? WHERE claim_public_id = ?",
    args: ["2020-01-01T00:00:00.000Z", claimResult.claim.claim_public_id],
  });
  const expired = await expireExpiredHumanCreditClaims();
  check(
    "claim expired and refunded",
    expired.expired.some((c) => c.claim_public_id === claimResult.claim.claim_public_id),
    `total refunded cents=${expired.totalRefundedCents}`,
  );

  const claimSenderAfter = await getHumanCreditBalance(HUMAN_USER_ID);
  check("expired refund restored sender balance", claimSenderAfter === claimSenderBefore, `${claimSenderBefore} → ${claimSenderAfter}`);

  // Cleanup the claim row
  await turso.execute({ sql: "DELETE FROM human_credit_claims WHERE claim_public_id = ?", args: [claimResult.claim.claim_public_id] });

  console.log("\n=== E: claim accept flow round-trip ===");

  const acceptSenderBefore = await getHumanCreditBalance(HUMAN_USER_ID);
  const acceptRecipientBefore = await getHumanCreditBalance(SECONDARY_HUMAN_USER_ID);
  const recipient = await findHumanByVibeIdUserId(2);
  if (!recipient) throw new Error("vibe-id user 2 not found");

  // Use a unique email for this round and then UPDATE the row to point at user 2's email
  // (createPendingHumanCreditClaim refuses if the email already has an account)
  const tempEmail = `phase3-acceptflow-${Date.now()}@example.com`;
  const accept = await createPendingHumanCreditClaim({
    senderHumanUserId: HUMAN_USER_ID,
    recipientEmail: tempEmail,
    amountCents: 30,
    note: "Phase 3 accept flow",
  });
  // Rewire the row so the claim function picks it up for user 2
  await turso.execute({
    sql: "UPDATE human_credit_claims SET recipient_email = ? WHERE claim_public_id = ?",
    args: [recipient.email.toLowerCase(), accept.claim.claim_public_id],
  });
  const claimed = await claimPendingHumanCreditClaimsForUser(SECONDARY_HUMAN_USER_ID);
  check(
    "claim was accepted",
    claimed.claimed.some((c) => c.claim_public_id === accept.claim.claim_public_id),
    `total claimed cents=${claimed.totalClaimedCents}`,
  );

  const acceptSenderAfter = await getHumanCreditBalance(HUMAN_USER_ID);
  const acceptRecipientAfter = await getHumanCreditBalance(SECONDARY_HUMAN_USER_ID);
  check("sender stayed -30 (already debited at create)", acceptSenderAfter === acceptSenderBefore - 30, `${acceptSenderBefore} → ${acceptSenderAfter}`);
  check("recipient gained 30", acceptRecipientAfter === acceptRecipientBefore + 30, `${acceptRecipientBefore} → ${acceptRecipientAfter}`);

  // Reverse: send 30 back to user 1 from user 2
  await sendHumanCreditTransfer({
    senderHumanUserId: SECONDARY_HUMAN_USER_ID,
    recipientHumanUserId: HUMAN_USER_ID,
    amountCents: 30,
    note: "Phase 3 accept flow reverse",
  });
  const acceptSenderRestored = await getHumanCreditBalance(HUMAN_USER_ID);
  const acceptRecipientRestored = await getHumanCreditBalance(SECONDARY_HUMAN_USER_ID);
  check(
    "accept flow balances restored",
    acceptSenderRestored === acceptSenderBefore && acceptRecipientRestored === acceptRecipientBefore,
    `${acceptSenderRestored}/${acceptSenderBefore}, ${acceptRecipientRestored}/${acceptRecipientBefore}`,
  );

  // Cleanup
  await turso.execute({ sql: "DELETE FROM human_credit_claims WHERE claim_public_id = ?", args: [accept.claim.claim_public_id] });

  console.log("\n=========================================");
  console.log(`Result: ${pass} pass, ${fail} fail`);
  console.log("=========================================");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[ERROR]", e);
  process.exit(1);
});
