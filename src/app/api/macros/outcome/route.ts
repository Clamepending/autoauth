import { NextResponse } from "next/server";
import { recordMacroOutcome } from "@/lib/macro-mining-store";

/**
 * POST /api/macros/outcome
 * Extension reports whether a macro execution succeeded or failed.
 *
 * Body: { macroId: string; success: boolean }
 * Returns: { ok: true }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const macroId = typeof body.macroId === "string" ? body.macroId : "";
    const success = body.success === true;

    if (!macroId) {
      return NextResponse.json({ error: "Missing macroId" }, { status: 400 });
    }

    await recordMacroOutcome(macroId, success);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[macros/outcome] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
