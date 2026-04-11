import { NextResponse } from "next/server";
import {
  formatGenericTaskForApi,
  rateGenericBrowserTaskByRequester,
} from "@/lib/generic-browser-tasks";
import { requireCurrentHumanUser } from "@/lib/human-session";

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

  const taskId = Number(context.params.taskId?.trim() ?? "");
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rating =
    typeof payload?.rating === "number"
      ? payload.rating
      : typeof payload?.rating === "string"
        ? Number(payload.rating)
        : NaN;

  try {
    const result = await rateGenericBrowserTaskByRequester({
      taskId,
      requesterHumanUserId: user.id,
      rating,
    });
    return NextResponse.json({
      ok: true,
      task: formatGenericTaskForApi(result.task, user),
      fulfiller_rating: result.fulfillerRating,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save rating.";
    const status =
      message === "Task not found."
        ? 404
        : message === "Only the requester can rate this fulfillment."
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
