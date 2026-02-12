import { NextResponse } from "next/server";
import { getAgentById, getAgentByUsername, deleteAgent, updateAgentUsername } from "@/lib/db";
import { normalizeUsername, validateUsername } from "@/lib/agent-auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid agent id." }, { status: 400 });
  }
  const agent = await getAgentById(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }
  await deleteAgent(id);
  return NextResponse.json({ ok: true, message: "Agent deleted." });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid agent id." }, { status: 400 });
  }
  const agent = await getAgentById(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const rawUsername = typeof body?.username === "string" ? body.username.trim() : "";
  const validation = validateUsername(rawUsername);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const newUsernameLower = normalizeUsername(rawUsername);
  const newUsernameDisplay = rawUsername;
  const existing = await getAgentByUsername(newUsernameLower);
  if (existing && existing.id !== id) {
    return NextResponse.json({ error: "Username is already taken." }, { status: 400 });
  }
  const updated = await updateAgentUsername({
    id,
    newUsernameLower,
    newUsernameDisplay,
  });
  if (!updated) {
    return NextResponse.json({ error: "Update failed." }, { status: 500 });
  }
  return NextResponse.json({
    id: updated.id,
    username_lower: updated.username_lower,
    username_display: updated.username_display,
    description: updated.description,
    message: "Agent renamed.",
  });
}
