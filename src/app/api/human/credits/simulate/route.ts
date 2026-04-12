import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  addCreditLedgerEntry,
  getHumanCreditBalance,
} from "@/lib/human-accounts";
import {
  isCreditRefillSimulationEnabled,
  parsePositiveInteger,
  validateRefillAmountCents,
} from "@/lib/credit-refill";
import { requireCurrentHumanUser } from "@/lib/human-session";

export async function POST(request: Request) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!isCreditRefillSimulationEnabled()) {
    return NextResponse.json(
      { error: "Test refills are not enabled on this deployment." },
      { status: 403 },
    );
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const amountCents = parsePositiveInteger(payload.amount_cents);
  const amountError = validateRefillAmountCents(amountCents);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  await addCreditLedgerEntry({
    humanUserId: user.id,
    amountCents,
    entryType: "credit_refill_test",
    description: `Test credit refill ($${(amountCents / 100).toFixed(2)})`,
    referenceType: "test_refill",
    referenceId: randomUUID(),
    metadata: {
      source: "ottoauth_test_refill",
      amount_cents: amountCents,
      email: user.email,
    },
  });

  const balanceCents = await getHumanCreditBalance(user.id);
  return NextResponse.json({
    ok: true,
    amount_cents: amountCents,
    balance_cents: balanceCents,
    note: "Test refill added without charging Stripe.",
  });
}
