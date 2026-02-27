import { NextResponse } from "next/server";
import {
  finalizeAgentRequest,
  getAgentRequestById,
} from "@/lib/db";
import { notifyOpenClaw } from "@/lib/openclaw-callback";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const notesRaw = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const notes = notesRaw.length > 0 ? notesRaw.slice(0, 4000) : null;

  const existing = await getAgentRequestById(id);
  if (!existing) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (existing.status === "resolved") {
    return NextResponse.json({ error: "Request is already resolved." }, { status: 409 });
  }
  if (existing.status === "rejected") {
    return NextResponse.json({ error: "Request is already rejected." }, { status: 409 });
  }

  const callback = await notifyOpenClaw({
    request: existing,
    action: "rejected",
    notes,
  });

  const updated = await finalizeAgentRequest({
    id,
    action: "rejected",
    notes,
    callbackOk: callback.ok,
    callbackStatusCode: callback.statusCode,
    callbackError: callback.error,
  });

  return NextResponse.json({
    ok: callback.ok,
    request: updated,
    callback: {
      status: callback.ok ? "sent" : "failed",
      http_status: callback.statusCode,
      error: callback.error,
    },
  });
}
