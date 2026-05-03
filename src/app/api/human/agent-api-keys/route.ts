import { NextResponse } from "next/server";

import { createHumanGeneratedAgentApiKey } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";

export async function POST(request: Request) {
  const user = await getCurrentHumanUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const agentName =
    typeof payload.agent_name === "string"
      ? payload.agent_name.trim()
      : typeof payload.agentName === "string"
        ? payload.agentName.trim()
        : "";
  try {
    const result = await createHumanGeneratedAgentApiKey({
      humanUserId: user.id,
      agentName,
    });

    return NextResponse.json({
      ok: true,
      agent: {
        id: result.agent.id,
        username: result.agent.username_display,
        username_lower: result.agent.username_lower,
        callback_url: result.agent.callback_url,
        description: result.agent.description,
      },
      username: result.agent.username_display,
      privateKey: result.privateKey,
      private_key: result.privateKey,
      message:
        "Agent API key generated and linked to this human account. Send the username and private_key to your agent now; the dashboard will not show this key again.",
    });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Could not generate an agent API key.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
