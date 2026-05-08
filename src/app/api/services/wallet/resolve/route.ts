import { NextResponse } from "next/server";

import {
  authenticateOrderAgentFromRequest,
  readJsonObject,
} from "@/lib/order-api";
import {
  getHumanLinkForAgentUsername,
  getHumanUserById,
  normalizePaymentRecipientInput,
  resolveHumanPaymentRecipient,
} from "@/lib/human-accounts";

function formatRecipient(recipient: NonNullable<Awaited<ReturnType<typeof resolveHumanPaymentRecipient>>>) {
  return {
    id: recipient.humanUser.id,
    username: recipient.humanUser.handle_display,
    address: `@${recipient.humanUser.handle_display}`,
    display_name: recipient.humanUser.display_name,
    picture_url: recipient.humanUser.picture_url,
    matched_by: recipient.matchedBy,
    agent_username: recipient.agentUsernameDisplay ?? null,
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
      {
        error: "No OttoAuth username matched that address.",
        normalized: normalizePaymentRecipientInput(recipientInput),
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    sender: {
      id: sender.id,
      username: sender.handle_display,
      address: `@${sender.handle_display}`,
    },
    recipient: formatRecipient(recipient),
    is_self: recipient.humanUser.id === sender.id,
  });
}
