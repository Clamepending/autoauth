import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  normalizeMockDeviceId,
  parseHttpUrl,
} from "@/lib/computeruse-mock";
import {
  enqueueComputerUseOpenUrlTask,
  getComputerUseDeviceById,
} from "@/lib/computeruse-store";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const rawUrl = payload.url;
  const url = parseHttpUrl(rawUrl);
  if (!url) {
    return NextResponse.json(
      { error: "url is required and must be http/https." },
      { status: 400 }
    );
  }

  const deviceId =
    normalizeMockDeviceId(payload.device_id) ||
    normalizeMockDeviceId(payload.deviceId) ||
    "local-device-1";
  const paired = await getComputerUseDeviceById(deviceId);
  if (!paired) {
    return NextResponse.json(
      {
        error:
          "Target device is not paired (mock). Pair the extension first via POST /api/computeruse/mock/pair.",
      },
      { status: 400 }
    );
  }

  const requestId =
    typeof payload.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : undefined;

  const { task, queueSize } = await enqueueComputerUseOpenUrlTask({
    url,
    deviceId,
    id: requestId,
    source: "mock_send",
    agentUsername: auth.usernameLower,
  });

  return NextResponse.json({
    ok: true,
    message: "Mock computer-use task queued.",
    taskId: task.id,
    task,
    queueSize,
    agent: auth.agent.username_display,
    targetDeviceId: paired.device_id,
    note: "This mock endpoint queues open_url tasks only. It does not run a real browser-use agent.",
  });
}
