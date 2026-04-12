import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  formatGenericTaskForApi,
  getGenericBrowserTaskById,
} from "@/lib/generic-browser-tasks";
import { getHumanUserById } from "@/lib/human-accounts";
import {
  isAgentClarificationExpired,
  resumeAgentClarificationTask,
} from "@/lib/computeruse-agent-clarification";
import { getAgentClarificationTimeoutLabel } from "@/lib/computeruse-agent-clarification-config";

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

  const clarificationResponse =
    typeof payload.clarification_response === "string"
      ? payload.clarification_response.trim()
      : typeof payload.clarificationResponse === "string"
        ? payload.clarificationResponse.trim()
        : "";
  if (!clarificationResponse) {
    return NextResponse.json(
      { error: "clarification_response is required." },
      { status: 400 },
    );
  }

  const task = await getGenericBrowserTaskById(parsedTaskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.agent_username_lower !== auth.usernameLower) {
    return NextResponse.json(
      { error: "Not authorized to respond to this task." },
      { status: 403 },
    );
  }
  if (task.submission_source !== "agent") {
    return NextResponse.json(
      { error: "Only agent-submitted tasks support clarification callbacks." },
      { status: 409 },
    );
  }
  if (task.status !== "awaiting_agent_clarification" || !task.clarification_request) {
    return NextResponse.json(
      { error: "This task is not currently awaiting agent clarification." },
      { status: 409 },
    );
  }
  if (isAgentClarificationExpired(task)) {
    const timeoutLabel = getAgentClarificationTimeoutLabel();
    return NextResponse.json(
      {
        error:
          `This clarification window expired after ${timeoutLabel} and the request was canceled.`,
      },
      { status: 409 },
    );
  }

  const resumed = await resumeAgentClarificationTask({
    task,
    clarificationResponse,
    agentUsernameLower: auth.usernameLower,
  });

  const humanUser = await getHumanUserById(task.human_user_id);

  return NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(resumed.task, humanUser),
    run_id: task.run_id,
    computeruse_task_id: resumed.computeruseTaskId,
    queue_size: resumed.queueSize,
    note: "Clarification received. OttoAuth queued a follow-up browser task on the linked device.",
  });
}
