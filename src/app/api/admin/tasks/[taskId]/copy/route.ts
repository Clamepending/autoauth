import { NextResponse } from "next/server";

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
  const originalTask = await resolveAdminOrderTask(context.params.taskId ?? "");
  if (!originalTask) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  try {
    const duplicated = await duplicateAdminOrderTask({
      originalTask,
      action: "copy",
      failOriginal: false,
    });
    return NextResponse.json({
      ok: true,
      task: formatGenericTaskForApi(duplicated.task, duplicated.requester),
      run_id: duplicated.run.id,
      copied_from_task_id: originalTask.id,
      fulfillment: duplicated.fulfillment,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Copy failed.";
    return NextResponse.json({ error: message }, { status: statusFromError(new Error(message)) });
  }
}
