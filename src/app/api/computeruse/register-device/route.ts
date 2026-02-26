import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { registerAgentDefaultComputerUseDevice } from "@/lib/computeruse-registrations";
import {
} from "@/lib/computeruse-mock";
import { getComputerUseDeviceByBrowserToken } from "@/lib/computeruse-store";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const browserToken =
    typeof payload.browser_token === "string"
      ? payload.browser_token.trim()
      : typeof payload.browserToken === "string"
        ? payload.browserToken.trim()
        : typeof payload.device === "string"
          ? payload.device.trim()
          : "";
  if (!browserToken) {
    return NextResponse.json(
      { error: "browser_token is required (or pass the browser token in `device`)." },
      { status: 400 }
    );
  }

  const device = await getComputerUseDeviceByBrowserToken(browserToken);
  if (!device) {
    return NextResponse.json(
      { error: "Unknown browser token. Generate a fresh token in the extension popup." },
      { status: 404 }
    );
  }

  await registerAgentDefaultComputerUseDevice({
    agentUsernameLower: auth.usernameLower,
    deviceId: device.device_id,
    browserToken,
  });

  return NextResponse.json({
    ok: true,
    agent: auth.agent.username_display,
    registered_device: {
      id: device.device_id,
      registered_agent_username: auth.usernameLower,
      registered_at: new Date().toISOString(),
    },
    note: "Mock one-device-per-agent registration complete. Future computeruse calls can omit device/browser_token for this agent.",
  });
}
