import { NextResponse } from "next/server";
import { getHumanLinkForAgentUsername, getHumanUserById } from "@/lib/human-accounts";
import {
  formatGenericTaskForApi,
  getGenericBrowserTaskById,
} from "@/lib/generic-browser-tasks";
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
      { error: "Not authorized to view this task." },
      { status: 403 },
    );
  }

  const humanLink = await getHumanLinkForAgentUsername(auth.usernameLower);
  const humanUser =
    humanLink && humanLink.human_user_id === task.human_user_id
      ? await getHumanUserById(task.human_user_id)
      : null;

  return NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(task, humanUser),
  });
}
