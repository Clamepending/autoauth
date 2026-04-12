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
        const name = first.slice(0, eq);
        const value = first.slice(eq + 1);
        this.cookies.set(name, value);
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
  const deviceId = `human-clarify-device-${suffix}`;
  const deviceLabel = `human-clarify-browser-${suffix}`;
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

async function waitForHumanTaskStatus({ cookieJar, taskId, expectedStatus, timeoutMs = 5000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload = null;
  while (Date.now() < deadline) {
    const response = await request(`/api/human/tasks/${taskId}`, {
      cookieJar,
    });
    assert(response.response.ok, `Human task fetch failed: ${response.text}`);
    lastPayload = response.data;
    if (response.data?.task?.status === expectedStatus) {
      return response.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timed out waiting for human task ${taskId} to reach ${expectedStatus}. Last payload: ${JSON.stringify(lastPayload)}`,
  );
}

async function main() {
  const suffix = Math.random().toString(36).slice(2, 8);
  const jar = new CookieJar();

  const loginRes = await request("/api/auth/dev-login", {
    cookieJar: jar,
    json: {
      email: `human-clarify+${suffix}@example.com`,
      display_name: "Human Clarify",
    },
  });
  assert(loginRes.response.ok, `Dev login failed: ${loginRes.text}`);

  const { deviceId, deviceToken } = await pairDevice(jar, suffix);

  const submitRes = await request("/api/human/tasks", {
    cookieJar: jar,
    json: {
      task_prompt: "Go to Snackpass and ask me what to search for.",
      max_charge_cents: 1500,
      fulfillment_mode: "own_device",
    },
  });
  assert(submitRes.response.ok, `Submit human task failed: ${submitRes.text}`);
  const taskId = submitRes.data.task.id;
  const firstComputerUseTaskId = submitRes.data.task.computeruse_task_id;

  const firstWait = await claimTask({ deviceToken, deviceId });
  assert(
    firstWait.id === firstComputerUseTaskId,
    `Unexpected first computeruse task id: ${JSON.stringify(firstWait)}`,
  );

  const clarificationQuestion = "What should I search for on Snackpass?";
  const clarificationCompletePromise = request(
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

  const awaitingRes = await waitForHumanTaskStatus({
    cookieJar: jar,
    taskId,
    expectedStatus: "awaiting_agent_clarification",
  });
  assert(
    awaitingRes.task.status === "awaiting_agent_clarification",
    `Expected awaiting clarification, got ${awaitingRes.task.status}`,
  );
  assert(
    awaitingRes.task.clarification?.question === clarificationQuestion,
    `Expected clarification question to round-trip, got ${JSON.stringify(awaitingRes.task.clarification)}`,
  );

  const clarificationResponse = "Search for TP Tea Berkeley.";
  const respondRes = await request(`/api/human/tasks/${taskId}/clarification`, {
    cookieJar: jar,
    json: {
      clarification_response: clarificationResponse,
    },
  });
  assert(respondRes.response.ok, `Human clarification response failed: ${respondRes.text}`);
  const secondComputerUseTaskId = respondRes.data.computeruse_task_id;

  const clarificationCompleteRes = await clarificationCompletePromise;
  assert(
    clarificationCompleteRes.response.ok,
    `Human clarification completion failed: ${clarificationCompleteRes.text}`,
  );
  assert(
    clarificationCompleteRes.data.local_agent.status === "queued_after_clarification",
    `Expected queued_after_clarification, got ${JSON.stringify(clarificationCompleteRes.data)}`,
  );
  assert(
    clarificationCompleteRes.data.local_agent.next_task_id === secondComputerUseTaskId,
    `Expected second task id ${secondComputerUseTaskId}, got ${JSON.stringify(clarificationCompleteRes.data)}`,
  );

  const secondWait = await claimTask({ deviceToken, deviceId });
  assert(
    secondWait.id === secondComputerUseTaskId,
    `Unexpected second computeruse task id: ${JSON.stringify(secondWait)}`,
  );
  assert(
    String(secondWait.goal || "").includes(clarificationResponse),
    `Expected resumed goal to include clarification response, got ${secondWait.goal}`,
  );

  const finalCompleteRes = await request(
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
          summary: "Searched Snackpass after human clarification.",
          merchant: "Snackpass",
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
  assert(finalCompleteRes.response.ok, `Final completion failed: ${finalCompleteRes.text}`);

  const finalStatusRes = await request(`/api/human/tasks/${taskId}`, {
    cookieJar: jar,
  });
  assert(finalStatusRes.response.ok, `Final human task fetch failed: ${finalStatusRes.text}`);
  assert(
    finalStatusRes.data.task.status === "completed",
    `Expected completed human clarification task, got ${finalStatusRes.data.task.status}`,
  );
  assert(
    finalStatusRes.data.task.clarification?.response === clarificationResponse,
    `Expected clarification response to round-trip, got ${JSON.stringify(finalStatusRes.data.task.clarification)}`,
  );

  const timeoutSubmitRes = await request("/api/human/tasks", {
    cookieJar: jar,
    json: {
      task_prompt: "Open Snackpass and ask me what to search for again.",
      max_charge_cents: 1500,
      fulfillment_mode: "own_device",
    },
  });
  assert(timeoutSubmitRes.response.ok, `Submit timeout human task failed: ${timeoutSubmitRes.text}`);
  const timeoutTaskId = timeoutSubmitRes.data.task.id;
  const timeoutComputerUseTaskId = timeoutSubmitRes.data.task.computeruse_task_id;

  const timeoutWait = await claimTask({ deviceToken, deviceId });
  assert(
    timeoutWait.id === timeoutComputerUseTaskId,
    `Unexpected timeout task id: ${JSON.stringify(timeoutWait)}`,
  );

  const timeoutCompleteRes = await request(
    `/api/computeruse/device/tasks/${timeoutComputerUseTaskId}/local-agent-complete`,
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
  assert(timeoutCompleteRes.response.ok, `Timeout completion failed: ${timeoutCompleteRes.text}`);
  assert(
    timeoutCompleteRes.data.local_agent.status === "failed",
    `Expected failed timeout task, got ${JSON.stringify(timeoutCompleteRes.data)}`,
  );
  assert(
    String(timeoutCompleteRes.data.local_agent.error || "").includes("timed out"),
    `Expected timeout error, got ${JSON.stringify(timeoutCompleteRes.data)}`,
  );

  const timeoutStatusRes = await request(`/api/human/tasks/${timeoutTaskId}`, {
    cookieJar: jar,
  });
  assert(timeoutStatusRes.response.ok, `Timeout status fetch failed: ${timeoutStatusRes.text}`);
  assert(
    timeoutStatusRes.data.task.status === "failed",
    `Expected failed timeout human task, got ${timeoutStatusRes.data.task.status}`,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        success: {
          task_id: taskId,
          first_computeruse_task_id: firstComputerUseTaskId,
          second_computeruse_task_id: secondComputerUseTaskId,
          final_status: finalStatusRes.data.task.status,
        },
        timeout: {
          task_id: timeoutTaskId,
          computeruse_task_id: timeoutComputerUseTaskId,
          final_status: timeoutStatusRes.data.task.status,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
