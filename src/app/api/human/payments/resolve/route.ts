import { NextResponse } from "next/server";
import {
  normalizePaymentRecipientInput,
  resolveHumanPaymentRecipient,
  type HumanPaymentRecipient,
} from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";

function formatRecipient(recipient: HumanPaymentRecipient) {
  return {
    id: recipient.humanUser.id,
    handle: recipient.humanUser.handle_display,
    display_name: recipient.humanUser.display_name,
    picture_url: recipient.humanUser.picture_url,
    matched_by: recipient.matchedBy,
    agent_username: recipient.agentUsernameDisplay ?? null,
  };
}

export async function GET(request: Request) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const recipientInput =
    url.searchParams.get("recipient")?.trim() ||
    url.searchParams.get("to")?.trim() ||
    "";
  if (!recipientInput) {
    return NextResponse.json(
      { error: "Enter an OttoAuth handle, email, profile link, or linked agent username." },
      { status: 400 },
    );
  }

  const recipient = await resolveHumanPaymentRecipient(recipientInput);
  if (!recipient) {
    const lookup = normalizePaymentRecipientInput(recipientInput);
    if (lookup?.includes("@")) {
      return NextResponse.json({
        ok: true,
        recipient: {
          id: null,
          handle: null,
          email: lookup,
          display_name: null,
          picture_url: null,
          matched_by: "pending_email",
          agent_username: null,
        },
        is_self: lookup === user.email.trim().toLowerCase(),
      });
    }
    return NextResponse.json(
      { error: "No OttoAuth account matched that handle or profile link." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    recipient: formatRecipient(recipient),
    is_self: recipient.humanUser.id === user.id,
  });
}
