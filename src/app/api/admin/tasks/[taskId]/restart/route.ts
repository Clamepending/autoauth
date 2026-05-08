import { NextResponse } from "next/server";

import { requireAdminApiAccess } from "@/lib/admin-auth";
import {
  duplicateAdminOrderTask,
  resolveAdminOrderTask,
} from "@/lib/admin-order-actions";
import { formatGenericTaskForApi } from "@/lib/generic-browser-tasks";

type Context = {
  params: {
    taskId: string;
  };
};

function statusFromError(error: Error) {
  if (error.message.includes("no credits") || error.message.includes("credit balance")) {
    return 402;
  }
  if (error.message.includes("not found")) return 404;
  return 409;
}

export async function POST(_request: Request, context: Context) {
  const admin = await requireAdminApiAccess();
  if (!admin.ok) return admin.response;

  const originalTask = await resolveAdminOrderTask(context.params.taskId ?? "");
  if (!originalTask) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  if (originalTask.status === "completed") {
    return NextResponse.json(
      { error: "Completed orders are already final and cannot be restarted. Use Copy as new order instead." },
      { status: 409 },
    );
  }

  try {
    const duplicated = await duplicateAdminOrderTask({
      originalTask,
      action: "restart",
      failOriginal: true,
    });
    return NextResponse.json({
      ok: true,
      task: formatGenericTaskForApi(duplicated.task, duplicated.requester),
      run_id: duplicated.run.id,
      restarted_from_task_id: originalTask.id,
      fulfillment: duplicated.fulfillment,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restart failed.";
    return NextResponse.json({ error: message }, { status: statusFromError(new Error(message)) });
  }
}
