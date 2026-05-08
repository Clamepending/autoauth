import { NextResponse } from "next/server";
import {
  getAgentMandateForHumanLink,
  saveAgentMandatePolicyForHuman,
  summarizeAgentMandate,
} from "@/lib/agent-mandates";
import { requireCurrentHumanUser } from "@/lib/human-session";

type Context = {
  params: {
    linkId: string;
  };
};

function parseLinkId(value: string) {
  const linkId = Number(value.trim());
  return Number.isInteger(linkId) && linkId > 0 ? linkId : null;
}

export async function GET(_request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const linkId = parseLinkId(context.params.linkId ?? "");
  if (!linkId) {
    return NextResponse.json({ error: "Invalid linked agent id." }, { status: 400 });
  }

  const mandate = await getAgentMandateForHumanLink({
    humanUserId: user.id,
    linkId,
  });
  if (!mandate) {
    return NextResponse.json({ error: "Linked agent not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    agent: mandate.link,
    policy: mandate.policy,
    summary: summarizeAgentMandate(mandate.policy),
  });
}

export async function PATCH(request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const linkId = parseLinkId(context.params.linkId ?? "");
  if (!linkId) {
    return NextResponse.json({ error: "Invalid linked agent id." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const mandate = await saveAgentMandatePolicyForHuman({
      humanUserId: user.id,
      linkId,
      payload,
    });
    if (!mandate) {
      return NextResponse.json({ error: "Linked agent not found." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      agent: mandate.link,
      policy: mandate.policy,
      summary: summarizeAgentMandate(mandate.policy),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update agent mandate.";
    const status = message === "Linked agent not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
