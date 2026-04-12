import { NextResponse } from "next/server";
import { removeLinkedAgentForHuman } from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";

type Context = {
  params: {
    linkId: string;
  };
};

export async function DELETE(_request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const linkId = Number(context.params.linkId?.trim() ?? "");
  if (!Number.isFinite(linkId) || linkId <= 0) {
    return NextResponse.json({ error: "Invalid linked agent id." }, { status: 400 });
  }

  try {
    const link = await removeLinkedAgentForHuman({
      humanUserId: user.id,
      linkId,
    });
    return NextResponse.json({
      ok: true,
      removed_link_id: link.id,
      agent: {
        id: link.agent_id,
        username_lower: link.username_lower,
        username_display: link.username_display,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove linked agent.";
    const status =
      message === "Linked agent not found."
        ? 404
        : message === "You do not own this linked agent."
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
