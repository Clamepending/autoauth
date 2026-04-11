import { NextResponse } from "next/server";
import { listGenericBrowserTasksForAgent, formatGenericTaskForApi } from "@/lib/generic-browser-tasks";
import { authenticateAgent } from "@/services/_shared/auth";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const tasks = await listGenericBrowserTasksForAgent(auth.usernameLower, 50);
  return NextResponse.json({
    tasks: tasks.map((task) => formatGenericTaskForApi(task)),
  });
}
