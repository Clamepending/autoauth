import { NextResponse } from "next/server";
import { isAgentClarificationExpired, resumeAgentClarificationTask } from "@/lib/computeruse-agent-clarification";
import { appendComputerUseRunEvent } from "@/lib/computeruse-runs";
import { formatGenericTaskForApi, getGenericBrowserTaskById } from "@/lib/generic-browser-tasks";
import { requireCurrentHumanUser } from "@/lib/human-session";

type Context = {
  params: {
    taskId: string;
  };
};

function sanitizeMessage(value: unknown, limit = 1200) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

export async function POST(request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const taskId = Number(context.params.taskId?.trim() ?? "");
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  const task = await getGenericBrowserTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.human_user_id !== user.id) {
    return NextResponse.json({ error: "Only the requester can message this task." }, { status: 403 });
  }
  if (task.status === "completed" || task.status === "failed") {
    return NextResponse.json({ error: "This task is already finished." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = sanitizeMessage(payload?.message);
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  if (task.run_id) {
    await appendComputerUseRunEvent({
      runId: task.run_id,
      type: "computeruse.chat.human_message",
      data: {
        generic_task_id: task.id,
        task_id: task.computeruse_task_id,
        human_user_id: user.id,
        message,
      },
    });
  }

  if (task.status === "awaiting_agent_clarification") {
    if (isAgentClarificationExpired(task)) {
      return NextResponse.json(
        { error: "The clarification window already expired for this task." },
        { status: 409 },
      );
    }
    if (!task.clarification_request) {
      return NextResponse.json(
        { error: "This task is waiting, but no clarification question is stored." },
        { status: 409 },
      );
    }

    const resumed = await resumeAgentClarificationTask({
      task,
      clarificationResponse: message,
      agentUsernameLower: task.agent_username_lower,
      clarificationMode: "human_reply_window",
      eventActor: "human",
      emitAgentEvents: false,
    });
    return NextResponse.json({
      ok: true,
      mode: "clarification_response",
      task: formatGenericTaskForApi(resumed.task, user),
      computeruse_task_id: resumed.computeruseTaskId,
      queue_size: resumed.queueSize,
      note: "Clarification sent. OttoAuth queued the follow-up browser task.",
    });
  }

  return NextResponse.json({
    ok: true,
    mode: "chat_message",
    task: formatGenericTaskForApi(task, user),
    note: "Message sent to the browser fulfiller.",
  });
}
