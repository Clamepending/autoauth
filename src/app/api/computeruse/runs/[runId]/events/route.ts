import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  getComputerUseRunById,
  listComputerUseRunEvents,
} from "@/lib/computeruse-runs";

type Context = {
  params: {
    runId: string;
  };
};

export async function POST(request: Request, context: Context) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const runId = context.params.runId?.trim() ?? "";
  if (!runId) {
    return NextResponse.json({ error: "Missing run id." }, { status: 400 });
  }

  const run = await getComputerUseRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  if (run.agent_username !== auth.usernameLower) {
    return NextResponse.json({ error: "Not authorized to view this run." }, { status: 403 });
  }

  const limitRaw =
    typeof payload.limit === "number"
      ? payload.limit
      : typeof payload.limit === "string"
        ? Number(payload.limit)
        : undefined;
  const limit = Number.isFinite(limitRaw as number) ? Number(limitRaw) : 50;

  const events = await listComputerUseRunEvents({ runId, limit });

  return NextResponse.json({
    ok: true,
    run_id: runId,
    events,
    count: events.length,
  });
}
