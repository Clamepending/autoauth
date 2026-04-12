import { NextResponse } from "next/server";
import { getHumanUserById } from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";
import {
  formatGenericTaskForApi,
  getGenericBrowserTaskById,
} from "@/lib/generic-browser-tasks";
import {
  isAgentClarificationExpired,
  resumeAgentClarificationTask,
} from "@/lib/computeruse-agent-clarification";
import { getAgentClarificationTimeoutLabel } from "@/lib/computeruse-agent-clarification-config";

type Context = {
  params: {
    taskId: string;
  };
};

export async function POST(request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const taskIdRaw = context.params.taskId?.trim() ?? "";
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
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

  const task = await getGenericBrowserTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.human_user_id !== user.id) {
    return NextResponse.json(
      { error: "Only the requester can respond to this clarification." },
      { status: 403 },
    );
  }
  if (task.submission_source !== "human") {
    return NextResponse.json(
      { error: "This clarification endpoint only applies to human-submitted tasks." },
      { status: 409 },
    );
  }
  if (task.status !== "awaiting_agent_clarification" || !task.clarification_request) {
    return NextResponse.json(
      { error: "This task is not currently awaiting clarification." },
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
    agentUsernameLower: task.agent_username_lower,
    clarificationMode: "human_reply_window",
    eventActor: "human",
    emitAgentEvents: false,
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
