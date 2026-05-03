import { NextResponse } from "next/server";
import { parsePositiveInteger } from "@/lib/credit-refill";
import {
  createPendingHumanCreditClaim,
  normalizePaymentRecipientInput,
  resolveHumanPaymentRecipient,
  sendHumanCreditTransfer,
  validateCreditTransferAmountCents,
  validateCreditTransferNote,
} from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";
import { sendPendingCreditClaimEmail } from "@/lib/payment-claim-email";

function formatUserForPayment(user: {
  id: number;
  display_name: string | null;
  handle_display: string;
  picture_url: string | null;
}) {
  return {
    id: user.id,
    display_name: user.display_name,
    handle: user.handle_display,
    picture_url: user.picture_url,
  };
}

export async function POST(request: Request) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const recipientInput =
    typeof payload.recipient === "string"
      ? payload.recipient.trim()
      : typeof payload.to === "string"
        ? payload.to.trim()
        : "";
  if (!recipientInput) {
    return NextResponse.json(
      { error: "Enter an OttoAuth handle, email, profile link, or linked agent username." },
      { status: 400 },
    );
  }

  const amountCents = parsePositiveInteger(payload.amount_cents);
  const amountError = validateCreditTransferAmountCents(amountCents);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  const noteError = validateCreditTransferNote(note);
  if (noteError) {
    return NextResponse.json({ error: noteError }, { status: 400 });
  }

  const recipient = await resolveHumanPaymentRecipient(recipientInput);
  if (!recipient) {
    const lookup = normalizePaymentRecipientInput(recipientInput);
    if (lookup?.includes("@")) {
      try {
        const result = await createPendingHumanCreditClaim({
          senderHumanUserId: user.id,
          recipientEmail: lookup,
          amountCents,
          note,
        });
        let emailStatus:
          | { ok: boolean; provider?: "webhook" | "resend"; skipped?: "unconfigured" }
          | { ok: false; error: string };
        try {
          emailStatus = await sendPendingCreditClaimEmail({
            claim: result.claim,
            sender: result.sender,
          });
        } catch (cause) {
          emailStatus = {
            ok: false,
            error:
              cause instanceof Error
                ? cause.message
                : "Could not send the claim email.",
          };
          console.error(
            `[payments/send] Failed to send claim email for ${result.claim.claim_public_id}:`,
            cause,
          );
        }

        return NextResponse.json({
          ok: true,
          transfer: {
            id: result.claim.claim_public_id,
            amount_cents: result.claim.amount_cents,
            note: result.claim.note,
            status: result.claim.status,
            created_at: result.claim.created_at,
            expires_at: result.claim.expires_at,
          },
          sender: formatUserForPayment(result.sender),
          recipient: {
            id: null,
            display_name: null,
            handle: null,
            email: result.claim.recipient_email,
            picture_url: null,
          },
          pending_claim: true,
          email: emailStatus,
          balance_cents: result.senderBalanceCents,
        });
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Could not create the pending OttoAuth claim.";
        const status = message.includes("credit balance") ? 402 : 400;
        return NextResponse.json({ error: message }, { status });
      }
    }
    return NextResponse.json(
      { error: "No OttoAuth account matched that handle or profile link." },
      { status: 404 },
    );
  }

  try {
    const result = await sendHumanCreditTransfer({
      senderHumanUserId: user.id,
      recipientHumanUserId: recipient.humanUser.id,
      amountCents,
      note,
    });

    return NextResponse.json({
      ok: true,
      transfer: {
        id: result.transfer.transfer_public_id,
        amount_cents: result.transfer.amount_cents,
        note: result.transfer.note,
        status: result.transfer.status,
        created_at: result.transfer.created_at,
      },
      sender: formatUserForPayment(result.sender),
      recipient: formatUserForPayment(result.recipient),
      balance_cents: result.senderBalanceCents,
    });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Could not send OttoAuth credits.";
    const status = message.includes("credit balance") ? 402 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
