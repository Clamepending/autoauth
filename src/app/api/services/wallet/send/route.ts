import { NextResponse } from "next/server";

import { parsePositiveInteger } from "@/lib/credit-refill";
import {
  authenticateOrderAgentFromRequest,
  readJsonObject,
} from "@/lib/order-api";
import {
  getHumanLinkForAgentUsername,
  getHumanUserById,
  resolveHumanPaymentRecipient,
  sendHumanCreditTransfer,
  validateCreditTransferAmountCents,
  validateCreditTransferNote,
} from "@/lib/human-accounts";

function paymentUser(user: {
  id: number;
  handle_display: string;
  display_name: string | null;
  picture_url: string | null;
}) {
  return {
    id: user.id,
    username: user.handle_display,
    address: `@${user.handle_display}`,
    display_name: user.display_name,
    picture_url: user.picture_url,
  };
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const auth = await authenticateOrderAgentFromRequest(request, body.payload);
  if (!auth.ok) return auth.response;

  const link = await getHumanLinkForAgentUsername(auth.auth.usernameLower);
  const sender = link ? await getHumanUserById(link.human_user_id) : null;
  if (!sender) {
    return NextResponse.json(
      { error: "This agent is not linked to a human wallet." },
      { status: 403 },
    );
  }

  const recipientInput =
    typeof body.payload.recipient === "string"
      ? body.payload.recipient.trim()
      : typeof body.payload.to === "string"
        ? body.payload.to.trim()
        : "";
  if (!recipientInput) {
    return NextResponse.json({ error: "recipient is required." }, { status: 400 });
  }

  const recipient = await resolveHumanPaymentRecipient(recipientInput);
  if (!recipient) {
    return NextResponse.json(
      { error: "No OttoAuth username matched that address." },
      { status: 404 },
    );
  }

  const amountCents = parsePositiveInteger(body.payload.amount_cents);
  const amountError = validateCreditTransferAmountCents(amountCents);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  const note = typeof body.payload.note === "string" ? body.payload.note.trim() : "";
  const noteError = validateCreditTransferNote(note);
  if (noteError) {
    return NextResponse.json({ error: noteError }, { status: 400 });
  }

  try {
    const result = await sendHumanCreditTransfer({
      senderHumanUserId: sender.id,
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
      sender: paymentUser(result.sender),
      recipient: {
        ...paymentUser(result.recipient),
        matched_by: recipient.matchedBy,
        agent_username: recipient.agentUsernameDisplay ?? null,
      },
      balance_cents: result.senderBalanceCents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send OttoAuth credits.";
    const status = message.includes("credit balance") ? 402 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
