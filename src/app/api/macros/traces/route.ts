import { NextResponse } from "next/server";
import { authenticateMacroMiningDevice } from "@/lib/macro-mining-auth";
import { insertTrace, getTraceCountSinceLastMine } from "@/lib/macro-mining-store";

/**
 * POST /api/macros/traces
 * Extension uploads a completed trace after each task.
 *
 * Body: { domain: string; trace: TaskTrace (as JSON object); deviceId?: string }
 * Returns: { ok: true; newTracesSinceLastMine: number }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const auth = await authenticateMacroMiningDevice(request, body);
    if (!auth.ok) return auth.response;

    const domain = typeof body.domain === "string" ? body.domain.trim() : "";
    const trace = body.trace;

    if (!domain) {
      return NextResponse.json({ error: "Missing domain" }, { status: 400 });
    }
    if (!trace || typeof trace !== "object") {
      return NextResponse.json({ error: "Missing or invalid trace" }, { status: 400 });
    }

    const traceJson = JSON.stringify(trace);
    await insertTrace(domain, traceJson, auth.deviceId);

    const newTraces = await getTraceCountSinceLastMine(domain);

    return NextResponse.json({ ok: true, newTracesSinceLastMine: newTraces });
  } catch (err) {
    console.error("[macros/traces] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
