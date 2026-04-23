import { NextResponse } from "next/server";
import { authenticateMacroMiningDevice } from "@/lib/macro-mining-auth";
import {
  getTracesForDomain,
  upsertMinedMacros,
  startMiningRun,
  completeMiningRun,
  deprecateUnderperformingMacros,
} from "@/lib/macro-mining-store";
import { runMiningPipeline, type TaskTrace } from "@/lib/graph-miner";

/**
 * POST /api/macros/mine
 * Triggers a mining run for a given domain. Called on a schedule or manually.
 *
 * Body: { domain: string; threshold?: number; skipLlmMerge?: boolean }
 * Returns: { ok: true; macrosFound: number; tracesUsed: number }
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
    if (!domain) {
      return NextResponse.json({ error: "Missing domain" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const threshold = typeof body.threshold === "number" ? body.threshold : 3;
    const skipLlmMerge = body.skipLlmMerge === true;

    const traceRecords = await getTracesForDomain(domain);
    if (traceRecords.length < threshold) {
      return NextResponse.json({
        ok: true,
        macrosFound: 0,
        tracesUsed: traceRecords.length,
        message: `Need at least ${threshold} traces, have ${traceRecords.length}`,
      });
    }

    const traces: TaskTrace[] = traceRecords.map((r) => {
      const parsed = JSON.parse(r.trace_json);
      return parsed as TaskTrace;
    });

    const runId = await startMiningRun(domain);

    const result = await runMiningPipeline(traces, domain, apiKey, {
      threshold,
      skipLlmMerge,
    });

    if (result.macros.length > 0) {
      await upsertMinedMacros(
        domain,
        result.macros.map((m) => ({
          id: m.id,
          macroJson: JSON.stringify(m),
          confidence: m.confidence,
        })),
      );
    }

    await deprecateUnderperformingMacros();
    await completeMiningRun(runId, result.tracesUsed, result.macros.length);

    return NextResponse.json({
      ok: true,
      macrosFound: result.macros.length,
      tracesUsed: result.tracesUsed,
      candidatesFound: result.candidatesFound,
    });
  } catch (err) {
    console.error("[macros/mine] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
