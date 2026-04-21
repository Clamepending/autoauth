import { notFound, redirect } from "next/navigation";
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
import { getCurrentHumanUser } from "@/lib/human-session";
import { withPickupNameInOrderNumberDisplay } from "@/lib/order-pickup-display";
import { OrderDetailClient } from "./order-detail-client";
import { RetryOrderClient } from "./retry-order-client";

type Props = {
  params: {
    taskId: string;
  };
};

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: Props) {
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect("/login");
  }

  const taskId = Number(params.taskId?.trim() ?? "");
  if (!Number.isFinite(taskId) || taskId <= 0) {
    notFound();
  }

  const task = await getGenericBrowserTaskById(taskId);
  if (!task) {
    notFound();
  }
  if (task.human_user_id !== user.id && task.fulfiller_human_user_id !== user.id) {
    redirect("/dashboard");
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

  const viewerRole =
    task.human_user_id === user.id
      ? "requester"
      : task.fulfiller_human_user_id === user.id
        ? "fulfiller"
        : "viewer";

  return (
    <>
      <OrderDetailClient
        taskId={task.id}
        initialData={{
          ok: true,
          task: withPickupNameInOrderNumberDisplay(formatGenericTaskForApi(task, user)),
          viewer_role: viewerRole,
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
        }}
      />
      {task.status === "failed" && viewerRole === "requester" ? (
        <RetryOrderClient taskId={task.id} taskTitle={task.task_title} />
      ) : null}
    </>
  );
}
