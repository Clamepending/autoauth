import { NextResponse } from "next/server";
import { getHumanLinkForAgentUsername, getHumanUserById } from "@/lib/human-accounts";
import {
  cancelInFlightGenericBrowserTask,
  formatGenericTaskForApi,
  getGenericBrowserTaskById,
} from "@/lib/generic-browser-tasks";
import { updateComputerUseTaskResult } from "@/lib/computeruse-store";
import { authenticateAgent } from "@/services/_shared/auth";

type Context = {
  params: Promise<{ taskId: string }>;
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

  const { taskId } = await context.params;
  const parsedTaskId = Number(taskId);
  if (!Number.isInteger(parsedTaskId) || parsedTaskId < 1) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  const task = await getGenericBrowserTaskById(parsedTaskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.agent_username_lower !== auth.usernameLower) {
    return NextResponse.json(
      { error: "Not authorized to cancel this task." },
      { status: 403 },
    );
  }

  const reason =
    typeof payload.reason === "string" && payload.reason.trim()
      ? payload.reason.trim()
      : "Task cancelled by requesting agent.";

  const cancelled = await cancelInFlightGenericBrowserTask({
    taskId: parsedTaskId,
    reason,
  });
  if (task.computeruse_task_id) {
    await updateComputerUseTaskResult({
      taskId: task.computeruse_task_id,
      status: "failed",
      error: reason,
    }).catch(() => null);
  }

  const humanLink = await getHumanLinkForAgentUsername(auth.usernameLower);
  const humanUser =
    humanLink && cancelled && humanLink.human_user_id === cancelled.human_user_id
      ? await getHumanUserById(cancelled.human_user_id)
      : null;

  return NextResponse.json({
    ok: true,
    cancelled: cancelled
      ? cancelled.status === "failed"
      : false,
    note:
      "The task is marked failed in OttoAuth. The browser worker may still finish its current loop on the device until restarted.",
    task: cancelled ? formatGenericTaskForApi(cancelled, humanUser) : null,
  });
}
