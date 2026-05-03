import QRCode from "qrcode";
import { getBaseUrl } from "@/lib/base-url";
import { resolveHumanPaymentRecipient } from "@/lib/human-accounts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim() ?? "";
  const recipient = await resolveHumanPaymentRecipient(handle);
  if (!recipient) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  const profileHandle =
    recipient.matchedBy === "agent_username" && recipient.agentUsernameLower
      ? recipient.agentUsernameLower
      : recipient.humanUser.handle_lower;
  const profileUrl = `${getBaseUrl()}/u/${encodeURIComponent(profileHandle)}`;
  const svg = await QRCode.toString(profileUrl, {
    type: "svg",
    margin: 1,
    width: 280,
    color: {
      dark: "#0b0b0b",
      light: "#ffffff",
    },
  });

  return new Response(svg, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
