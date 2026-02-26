import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { getComputerUseRunById } from "@/lib/computeruse-runs";
import { getComputerUseTaskById } from "@/lib/computeruse-store";

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

  const task = run.current_task_id ? await getComputerUseTaskById(run.current_task_id) : null;

  return NextResponse.json({
    ok: true,
    run,
    current_task: task
      ? {
          id: task.id,
          status: task.status,
          url: task.url,
          created_at: task.createdAt,
          delivered_at: task.deliveredAt,
          completed_at: task.completedAt,
          result: task.result,
          error: task.error,
          updated_at: task.updatedAt,
        }
      : null,
    note: "Mock async computer-use run status endpoint. Uses POST to reuse agent auth payload.",
  });
}
