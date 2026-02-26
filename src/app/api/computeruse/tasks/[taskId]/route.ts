import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { getComputerUseTaskById } from "@/lib/computeruse-store";

type Context = {
  params: {
    taskId: string;
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

  const taskId = context.params.taskId?.trim() ?? "";
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id." }, { status: 400 });
  }

  const task = await getComputerUseTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  if (task.agentUsername && task.agentUsername !== auth.usernameLower) {
    return NextResponse.json({ error: "Not authorized to view this task." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    task: {
      id: task.id,
      status: task.status,
      type: task.type,
      device_id: task.deviceId,
      url: task.url,
      created_at: task.createdAt,
      delivered_at: task.deliveredAt,
      completed_at: task.completedAt,
      result: task.result,
      error: task.error,
      task_prompt: task.taskPrompt,
      source: task.source,
      updated_at: task.updatedAt,
    },
    note: "Mock task status endpoint. Uses POST to reuse agent authentication payload.",
  });
}
