import { NextResponse } from "next/server";
import { getAgentByUsername, updateAgentDescription } from "@/lib/db";
import { normalizeUsername, validateUsername, verifyPrivateKey } from "@/lib/agent-auth";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawUsername = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password.trim() : "";
  const rawDescription = typeof payload.description === "string" ? payload.description.trim() : "";

  const validation = validateUsername(rawUsername);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  if (rawDescription.length > 100) {
    return NextResponse.json({ error: "Description must be 100 characters or fewer." }, { status: 400 });
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

  const updated = await updateAgentDescription({
    usernameLower,
    description: rawDescription.length > 0 ? rawDescription : null,
  });

  return NextResponse.json({
    username: updated?.username_display ?? rawUsername,
    description: updated?.description ?? null,
    message: "Description updated.",
  });
}
