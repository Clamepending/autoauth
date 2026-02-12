import { NextResponse } from "next/server";
import { getAgentById, deleteAgent } from "@/lib/db";

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
