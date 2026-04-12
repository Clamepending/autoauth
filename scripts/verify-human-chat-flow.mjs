const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3100";

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const header of setCookies) {
      const first = header.split(";")[0];
      const eq = first.indexOf("=");
      if (eq > 0) {
        this.cookies.set(first.slice(0, eq), first.slice(eq + 1));
      }
    }
  }

  header() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.json) headers.set("content-type", "application/json");
  if (options.cookieJar) {
    const cookie = options.cookieJar.header();
    if (cookie) headers.set("cookie", cookie);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || (options.json ? "POST" : "GET"),
    headers,
    body: options.json ? JSON.stringify(options.json) : options.body,
    redirect: "manual",
  });
  options.cookieJar?.capture(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function pairDevice(cookieJar, suffix) {
  const deviceId = `human-chat-device-${suffix}`;
  const deviceLabel = `human-chat-browser-${suffix}`;
  const pairingCodeRes = await request("/api/human/devices/pairing-code", {
    cookieJar,
    json: { device_label: deviceLabel },
  });
  assert(pairingCodeRes.response.ok, `Create pairing code failed: ${pairingCodeRes.text}`);

  const pairDeviceRes = await request("/api/computeruse/device/pair", {
    json: {
      device_id: deviceId,
      device_label: deviceLabel,
      pairing_code: pairingCodeRes.data.code,
    },
  });
  assert(pairDeviceRes.response.ok, `Device pair failed: ${pairDeviceRes.text}`);
  return {
    deviceId,
    deviceToken: pairDeviceRes.data.deviceToken,
  };
}

async function claimTask({ deviceToken, deviceId }) {
  const waitRes = await request("/api/computeruse/device/wait-task?waitMs=1000", {
    headers: {
      authorization: `Bearer ${deviceToken}`,
      "x-ottoauth-mock-device": deviceId,
    },
  });
  assert(waitRes.response.ok, `Wait task failed: ${waitRes.text}`);
  return waitRes.data;
}

async function getTaskDetail(cookieJar, taskId) {
  const detailRes = await request(`/api/human/tasks/${taskId}`, { cookieJar });
  assert(detailRes.response.ok, `Task detail failed: ${detailRes.text}`);
  return detailRes.data;
}

async function waitForTaskStatus(cookieJar, taskId, expectedStatus, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await getTaskDetail(cookieJar, taskId);
    if (last.task?.status === expectedStatus) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timed out waiting for task ${taskId} to reach ${expectedStatus}. Last payload: ${JSON.stringify(last)}`,
  );
}

async function main() {
  const suffix = Math.random().toString(36).slice(2, 8);
  const jar = new CookieJar();

  const loginRes = await request("/api/auth/dev-login", {
    cookieJar: jar,
    json: {
      email: `human-chat+${suffix}@example.com`,
      display_name: "Human Chat",
    },
  });
  assert(loginRes.response.ok, `Dev login failed: ${loginRes.text}`);

  const { deviceId, deviceToken } = await pairDevice(jar, suffix);

  const submitRes = await request("/api/human/tasks", {
    cookieJar: jar,
    json: {
      task_prompt: "Open example.com and wait for my next message.",
      max_charge_cents: 1500,
      fulfillment_mode: "own_device",
    },
  });
  assert(submitRes.response.ok, `Submit human task failed: ${submitRes.text}`);
  const taskId = submitRes.data.task.id;
  const firstComputerUseTaskId = submitRes.data.task.computeruse_task_id;

  const firstWait = await claimTask({ deviceToken, deviceId });
  assert(firstWait.id === firstComputerUseTaskId, `Unexpected task claim: ${JSON.stringify(firstWait)}`);

  const requesterMessage = "Please search for Example Domain and tell me what page you see.";
  const messageRes = await request(`/api/human/tasks/${taskId}/messages`, {
    cookieJar: jar,
    json: { message: requesterMessage },
  });
  assert(messageRes.response.ok, `Human message send failed: ${messageRes.text}`);

  const deviceMessagesRes = await request(`/api/computeruse/device/tasks/${firstComputerUseTaskId}/messages`, {
    headers: {
      authorization: `Bearer ${deviceToken}`,
      "x-ottoauth-mock-device": deviceId,
    },
  });
  assert(deviceMessagesRes.response.ok, `Device message fetch failed: ${deviceMessagesRes.text}`);
  assert(
    Array.isArray(deviceMessagesRes.data.messages) &&
      deviceMessagesRes.data.messages.some((message) => message.message === requesterMessage),
    `Expected device to see requester message, got ${JSON.stringify(deviceMessagesRes.data)}`,
  );

  const agentMessage = "I received your instruction and I am opening Example Domain now.";
  const agentMessageRes = await request(`/api/computeruse/device/tasks/${firstComputerUseTaskId}/messages`, {
    headers: {
      authorization: `Bearer ${deviceToken}`,
      "x-ottoauth-mock-device": deviceId,
    },
    json: { message: agentMessage },
  });
  assert(agentMessageRes.response.ok, `Agent message send failed: ${agentMessageRes.text}`);

  const detailAfterChat = await getTaskDetail(jar, taskId);
  const eventTypes = detailAfterChat.run_events.map((event) => event.type);
  assert(
    eventTypes.includes("computeruse.chat.human_message"),
    `Expected human chat event, got ${JSON.stringify(eventTypes)}`,
  );
  assert(
    eventTypes.includes("computeruse.chat.agent_message"),
    `Expected agent chat event, got ${JSON.stringify(eventTypes)}`,
  );

  const clarificationQuestion = "What should I search for on Example Domain?";
  const clarificationPromise = request(
    `/api/computeruse/device/tasks/${firstComputerUseTaskId}/local-agent-complete`,
    {
      headers: {
        authorization: `Bearer ${deviceToken}`,
        "x-ottoauth-mock-device": deviceId,
      },
      json: {
        status: "failed",
        result: {
          status: "failed",
          summary: "Task blocked because the fulfiller requested clarification.",
          error: `Need clarification before continuing. ${clarificationQuestion}`,
          clarification_requested: true,
          clarification_question: clarificationQuestion,
          charges: {
            goods_cents: 0,
            shipping_cents: 0,
            tax_cents: 0,
            other_cents: 0,
            currency: "usd",
          },
        },
      },
    },
  );

  await waitForTaskStatus(jar, taskId, "awaiting_agent_clarification");

  const clarificationReply = "Search for the Example Domain heading.";
  const replyRes = await request(`/api/human/tasks/${taskId}/messages`, {
    cookieJar: jar,
    json: { message: clarificationReply },
  });
  assert(replyRes.response.ok, `Clarification reply through chat failed: ${replyRes.text}`);
  assert(
    replyRes.data.mode === "clarification_response",
    `Expected clarification_response mode, got ${JSON.stringify(replyRes.data)}`,
  );

  const clarificationCompleteRes = await clarificationPromise;
  assert(
    clarificationCompleteRes.response.ok,
    `Clarification completion failed: ${clarificationCompleteRes.text}`,
  );
  assert(
    clarificationCompleteRes.data.local_agent?.status === "queued_after_clarification",
    `Expected queued_after_clarification, got ${JSON.stringify(clarificationCompleteRes.data)}`,
  );

  const secondComputerUseTaskId = replyRes.data.computeruse_task_id;
  const secondWait = await claimTask({ deviceToken, deviceId });
  assert(
    secondWait.id === secondComputerUseTaskId,
    `Unexpected resumed task id: ${JSON.stringify(secondWait)}`,
  );
  assert(
    String(secondWait.goal || "").includes(clarificationReply),
    `Expected resumed goal to include clarification reply, got ${secondWait.goal}`,
  );

  const completionRes = await request(
    `/api/computeruse/device/tasks/${secondComputerUseTaskId}/local-agent-complete`,
    {
      headers: {
        authorization: `Bearer ${deviceToken}`,
        "x-ottoauth-mock-device": deviceId,
      },
      json: {
        status: "completed",
        result: {
          status: "completed",
          summary: "Opened Example Domain and found the heading successfully.",
          merchant: "Example Domain",
          charges: {
            goods_cents: 0,
            shipping_cents: 0,
            tax_cents: 0,
            other_cents: 0,
            currency: "usd",
          },
        },
      },
    },
  );
  assert(completionRes.response.ok, `Final completion failed: ${completionRes.text}`);

  const finalDetail = await getTaskDetail(jar, taskId);
  assert(finalDetail.task.status === "completed", `Expected completed task, got ${finalDetail.task.status}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        task_id: taskId,
        first_computeruse_task_id: firstComputerUseTaskId,
        second_computeruse_task_id: secondComputerUseTaskId,
        chat_events: finalDetail.run_events
          .filter((event) => event.type.startsWith("computeruse.chat."))
          .map((event) => ({
            type: event.type,
            message: event.data.message,
          })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
