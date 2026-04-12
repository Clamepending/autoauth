import http from "node:http";

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
  if (!condition) {
    throw new Error(message);
  }
}

async function startCallbackServer({ onEvent } = {}) {
  let resolver = null;
  const events = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    const event = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    };
    events.push(event);
    if (resolver) {
      resolver(event);
      resolver = null;
    }

    const handled = (await onEvent?.(event)) || { statusCode: 200, body: { ok: true } };
    res.writeHead(handled.statusCode ?? 200, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify(handled.body ?? { ok: true }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/ottoauth/callback`,
    async waitForEvent(timeoutMs = 5000) {
      if (events.length > 0) return events[0];
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolver = null;
          reject(new Error(`Timed out waiting for callback after ${timeoutMs}ms`));
        }, timeoutMs);
        resolver = (event) => {
          clearTimeout(timeout);
          resolve(event);
        };
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

async function createAndPairAgent({ username, callbackUrl, privateKeyHolder, pairingKeyHolder }) {
  const agentRes = await request("/api/agents/create", {
    json: {
      username,
      callback_url: callbackUrl,
    },
  });
  assert(agentRes.response.ok, `Agent create failed: ${agentRes.text}`);
  privateKeyHolder.value = agentRes.data.privateKey;
  pairingKeyHolder.value = agentRes.data.pairingKey;
}

async function pairAgentToHuman({ jar, pairingKey }) {
  const pairAgentRes = await request("/api/human/pair-agent", {
    cookieJar: jar,
    json: { pairing_key: pairingKey },
  });
  assert(pairAgentRes.response.ok, `Pair agent failed: ${pairAgentRes.text}`);
}

async function submitAgentTask({ username, privateKey, taskPrompt, maxChargeCents }) {
  const submitTaskRes = await request("/api/services/computeruse/submit-task", {
    json: {
      username,
      private_key: privateKey,
      task_prompt: taskPrompt,
      max_charge_cents: maxChargeCents,
    },
  });
  assert(submitTaskRes.response.ok, `Submit task failed: ${submitTaskRes.text}`);
  return submitTaskRes.data.task;
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

async function main() {
  const jar = new CookieJar();
  const suffix = Math.random().toString(36).slice(2, 8);
  const humanEmail = `clarify-human+${suffix}@example.com`;
  const deviceId = `clarify-device-${suffix}`;
  const deviceLabel = `clarify-browser-${suffix}`;

  const loginRes = await request("/api/auth/dev-login", {
    cookieJar: jar,
    json: {
      email: humanEmail,
      display_name: "Clarification Human",
    },
  });
  assert(loginRes.response.ok, `Dev login failed: ${loginRes.text}`);

  const pairingCodeRes = await request("/api/human/devices/pairing-code", {
    cookieJar: jar,
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
  const deviceToken = pairDeviceRes.data.deviceToken;

  const successCallbackServer = await startCallbackServer();
  const timeoutCallbackServer = await startCallbackServer();

  try {
    const successAgentUsername = `clarify_success_${suffix}`;
    const successPrivateKey = { value: "" };
    const successPairingKey = { value: "" };
    await createAndPairAgent({
      username: successAgentUsername,
      callbackUrl: successCallbackServer.url,
      privateKeyHolder: successPrivateKey,
      pairingKeyHolder: successPairingKey,
    });
    await pairAgentToHuman({ jar, pairingKey: successPairingKey.value });

    const successTask = await submitAgentTask({
      username: successAgentUsername,
      privateKey: successPrivateKey.value,
      taskPrompt: "Order a pho soup from the best place you can find.",
      maxChargeCents: 1500,
    });
    const firstComputerUseTaskId = successTask.computeruse_task_id;
    const firstWait = await claimTask({ deviceToken, deviceId });
    assert(
      firstWait.id === firstComputerUseTaskId,
      `Unexpected first computeruse task id: ${JSON.stringify(firstWait)}`,
    );

    const clarificationQuestion = "Should I choose chicken pho or brisket pho?";
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
            error: `Need clarification before ordering. ${clarificationQuestion}`,
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

    const callbackEvent = await successCallbackServer.waitForEvent(8000);
    assert(
      callbackEvent.body?.event === "ottoauth.computeruse.clarification_requested",
      `Unexpected callback event: ${JSON.stringify(callbackEvent.body)}`,
    );
    assert(
      callbackEvent.body?.clarification?.question === clarificationQuestion,
      `Unexpected callback question: ${JSON.stringify(callbackEvent.body)}`,
    );

    const taskStatusDuringClarification = await request(
      `/api/services/computeruse/tasks/${successTask.id}`,
      {
        json: {
          username: successAgentUsername,
          private_key: successPrivateKey.value,
        },
      },
    );
    assert(
      taskStatusDuringClarification.response.ok,
      `Task status during clarification failed: ${taskStatusDuringClarification.text}`,
    );
    assert(
      taskStatusDuringClarification.data.task.status === "awaiting_agent_clarification",
      `Expected awaiting_agent_clarification task status, got ${taskStatusDuringClarification.data.task.status}`,
    );
    assert(
      taskStatusDuringClarification.data.task.clarification?.callback_status === "sent",
      `Expected sent callback status, got ${JSON.stringify(taskStatusDuringClarification.data.task.clarification)}`,
    );

    const clarificationResponse =
      "Choose brisket pho, and prefer the larger bowl if both fit in budget.";
    const respondRes = await request(
      `/api/services/computeruse/tasks/${successTask.id}/clarification`,
      {
        json: {
          username: successAgentUsername,
          private_key: successPrivateKey.value,
          clarification_response: clarificationResponse,
        },
      },
    );
    assert(respondRes.response.ok, `Clarification response failed: ${respondRes.text}`);
    const secondComputerUseTaskId = respondRes.data.computeruse_task_id;
    assert(
      secondComputerUseTaskId && secondComputerUseTaskId !== firstComputerUseTaskId,
      `Expected a new computeruse task id, got ${secondComputerUseTaskId}`,
    );

    const clarificationCompleteRes = await clarificationCompletePromise;
    assert(
      clarificationCompleteRes.response.ok,
      `Clarification completion failed: ${clarificationCompleteRes.text}`,
    );
    assert(
      clarificationCompleteRes.data.local_agent.status === "queued_after_clarification",
      `Expected queued_after_clarification, got ${JSON.stringify(clarificationCompleteRes.data)}`,
    );
    assert(
      clarificationCompleteRes.data.local_agent.next_task_id === secondComputerUseTaskId,
      `Expected next_task_id ${secondComputerUseTaskId}, got ${JSON.stringify(clarificationCompleteRes.data)}`,
    );

    const waitSecondRes = await claimTask({ deviceToken, deviceId });
    assert(
      waitSecondRes.id === secondComputerUseTaskId,
      `Unexpected second computeruse task id: ${JSON.stringify(waitSecondRes)}`,
    );
    assert(
      String(waitSecondRes.goal || "").includes(clarificationResponse),
      `Expected resumed goal to include clarification response, got ${waitSecondRes.goal}`,
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
            summary: "Selected a brisket pho option after agent clarification.",
            merchant: "Example Pho",
            charges: {
              goods_cents: 1200,
              shipping_cents: 0,
              tax_cents: 100,
              other_cents: 0,
              currency: "usd",
            },
          },
          usages: [
            {
              model: "claude-sonnet-4-5-20250929",
              input_tokens: 1000,
              output_tokens: 200,
              source: "main_loop",
            },
          ],
        },
      },
    );
    assert(finalCompleteRes.response.ok, `Final completion failed: ${finalCompleteRes.text}`);

    const finalTaskStatusRes = await request(`/api/services/computeruse/tasks/${successTask.id}`, {
      json: {
        username: successAgentUsername,
        private_key: successPrivateKey.value,
      },
    });
    assert(finalTaskStatusRes.response.ok, `Final task status failed: ${finalTaskStatusRes.text}`);
    assert(
      finalTaskStatusRes.data.task.status === "completed",
      `Expected completed final task, got ${finalTaskStatusRes.data.task.status}`,
    );
    assert(
      finalTaskStatusRes.data.task.clarification?.response === clarificationResponse,
      `Expected clarification response to round-trip, got ${JSON.stringify(finalTaskStatusRes.data.task.clarification)}`,
    );

    const timeoutAgentUsername = `clarify_timeout_${suffix}`;
    const timeoutPrivateKey = { value: "" };
    const timeoutPairingKey = { value: "" };
    await createAndPairAgent({
      username: timeoutAgentUsername,
      callbackUrl: timeoutCallbackServer.url,
      privateKeyHolder: timeoutPrivateKey,
      pairingKeyHolder: timeoutPairingKey,
    });
    await pairAgentToHuman({ jar, pairingKey: timeoutPairingKey.value });

    const timeoutTask = await submitAgentTask({
      username: timeoutAgentUsername,
      privateKey: timeoutPrivateKey.value,
      taskPrompt: "Order another pho soup from the best place you can find.",
      maxChargeCents: 1500,
    });
    const timeoutComputerUseTaskId = timeoutTask.computeruse_task_id;
    const timeoutWait = await claimTask({ deviceToken, deviceId });
    assert(
      timeoutWait.id === timeoutComputerUseTaskId,
      `Unexpected timeout computeruse task id: ${JSON.stringify(timeoutWait)}`,
    );

    const timeoutCompletePromise = request(
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
            error: `Need clarification before ordering. ${clarificationQuestion}`,
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

    const timeoutCallbackEvent = await timeoutCallbackServer.waitForEvent(8000);
    assert(
      timeoutCallbackEvent.body?.event === "ottoauth.computeruse.clarification_requested",
      `Unexpected timeout callback event: ${JSON.stringify(timeoutCallbackEvent.body)}`,
    );

    const timeoutCompleteRes = await timeoutCompletePromise;
    assert(timeoutCompleteRes.response.ok, `Timeout completion failed: ${timeoutCompleteRes.text}`);
    assert(
      timeoutCompleteRes.data.local_agent.status === "failed",
      `Expected failed timeout completion, got ${JSON.stringify(timeoutCompleteRes.data)}`,
    );
    assert(
      String(timeoutCompleteRes.data.local_agent.error || "").includes("timed out"),
      `Expected timeout error, got ${JSON.stringify(timeoutCompleteRes.data)}`,
    );

    const timeoutTaskStatusRes = await request(`/api/services/computeruse/tasks/${timeoutTask.id}`, {
      json: {
        username: timeoutAgentUsername,
        private_key: timeoutPrivateKey.value,
      },
    });
    assert(timeoutTaskStatusRes.response.ok, `Timeout task status failed: ${timeoutTaskStatusRes.text}`);
    assert(
      timeoutTaskStatusRes.data.task.status === "failed",
      `Expected failed timeout task status, got ${timeoutTaskStatusRes.data.task.status}`,
    );
    assert(
      timeoutTaskStatusRes.data.task.clarification?.callback_status === "timed_out",
      `Expected timed_out callback status, got ${JSON.stringify(timeoutTaskStatusRes.data.task.clarification)}`,
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          success: {
            task_id: successTask.id,
            first_computeruse_task_id: firstComputerUseTaskId,
            second_computeruse_task_id: secondComputerUseTaskId,
            callback_event: callbackEvent.body,
            final_status: finalTaskStatusRes.data.task.status,
          },
          timeout: {
            task_id: timeoutTask.id,
            computeruse_task_id: timeoutComputerUseTaskId,
            callback_event: timeoutCallbackEvent.body,
            final_status: timeoutTaskStatusRes.data.task.status,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await successCallbackServer.close();
    await timeoutCallbackServer.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
