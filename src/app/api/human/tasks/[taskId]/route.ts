import { NextResponse } from "next/server";
import {
  getComputerUseRunById,
  listComputerUseRunEvents,
} from "@/lib/computeruse-runs";
import {
  formatGenericTaskForApi,
  getGenericBrowserTaskById,
  getHumanFulfillmentRatingStats,
  getLatestGenericBrowserTaskSnapshot,
  listGenericBrowserTaskSnapshots,
} from "@/lib/generic-browser-tasks";
import { getHumanUserById } from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";

type Context = {
  params: {
    taskId: string;
  };
};

export async function GET(_request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const taskIdRaw = context.params.taskId?.trim() ?? "";
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  const task = await getGenericBrowserTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.human_user_id !== user.id && task.fulfiller_human_user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized to view this task." }, { status: 403 });
  }

  const [requester, fulfiller, latestSnapshot, recentSnapshots, run, runEvents, fulfillerRating] = await Promise.all([
    getHumanUserById(task.human_user_id),
    task.fulfiller_human_user_id != null
      ? getHumanUserById(task.fulfiller_human_user_id)
      : Promise.resolve(null),
    getLatestGenericBrowserTaskSnapshot(task.id),
    listGenericBrowserTaskSnapshots(task.id, 8),
    task.run_id ? getComputerUseRunById(task.run_id) : Promise.resolve(null),
    task.run_id ? listComputerUseRunEvents({ runId: task.run_id, limit: 100 }) : Promise.resolve([]),
    task.fulfiller_human_user_id != null
      ? getHumanFulfillmentRatingStats(task.fulfiller_human_user_id)
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(task, user),
    viewer_role:
      task.human_user_id === user.id
        ? "requester"
        : task.fulfiller_human_user_id === user.id
          ? "fulfiller"
          : "viewer",
    requester:
      requester == null
        ? null
        : {
            id: requester.id,
            email: requester.email,
            display_name: requester.display_name,
          },
    fulfiller:
      fulfiller == null
        ? null
        : {
            id: fulfiller.id,
            email: fulfiller.email,
            display_name: fulfiller.display_name,
          },
    run,
    run_events: [...runEvents].reverse(),
    latest_snapshot: latestSnapshot,
    recent_snapshots: recentSnapshots,
    fulfiller_rating: fulfillerRating,
  });
}
