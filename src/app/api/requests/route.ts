import { NextResponse } from "next/server";
import { getAgentByUsername, createAgentRequest, REQUEST_TYPES } from "@/lib/db";
import { normalizeUsername, validateUsername, verifyPrivateKey } from "@/lib/agent-auth";
import { notifySlack } from "@/lib/slack";
import { getBaseUrl } from "@/lib/base-url";

const REQUEST_TYPE_SET = new Set<string>(REQUEST_TYPES);

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawUsername = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password.trim() : "";
  const requestType = typeof payload.type === "string" ? payload.type.trim().toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.trim().slice(0, 500) : null;

  const validation = validateUsername(rawUsername);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  if (!requestType) {
    return NextResponse.json(
      { error: "Request type is required. Use one of: " + REQUEST_TYPES.join(", ") },
      { status: 400 }
    );
  }

  if (!REQUEST_TYPE_SET.has(requestType)) {
    return NextResponse.json(
      { error: "Invalid type. Use one of: " + REQUEST_TYPES.join(", ") },
      { status: 400 }
    );
  }

  const usernameLower = normalizeUsername(rawUsername);
  const agent = await getAgentByUsername(usernameLower);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  const ok = verifyPrivateKey(password, agent.private_key);
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const record = await createAgentRequest({
    usernameLower,
    requestType,
    message: message && message.length > 0 ? message : null,
  });

  const baseUrl = getBaseUrl();
  notifySlack({
    agentDisplay: agent.username_display,
    requestType,
    message: record.message,
    requestId: record.id,
    appUrl: baseUrl,
  }).catch((err) => console.error("[slack] notify failed:", err));

  return NextResponse.json({
    id: record.id,
    type: record.request_type,
    details: record.message,
    status: record.status,
    message: "Request received. A human will fulfill it when possible.",
  });
}
