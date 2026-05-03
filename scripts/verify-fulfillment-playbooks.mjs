const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3100';

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const header of setCookies) {
      const first = header.split(';')[0];
      const eq = first.indexOf('=');
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
      .join('; ');
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.json) {
    headers.set('content-type', 'application/json');
  }
  if (options.cookieJar) {
    const cookie = options.cookieJar.header();
    if (cookie) headers.set('cookie', cookie);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || (options.json ? 'POST' : 'GET'),
    headers,
    body: options.json ? JSON.stringify(options.json) : options.body,
    redirect: 'manual',
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

function includes(value, needle) {
  return typeof value === 'string' && value.includes(needle);
}

async function main() {
  const jar = new CookieJar();
  const suffix = Math.random().toString(36).slice(2, 8);
  const agentUsername = `playbook_${suffix}`;
  const humanEmail = `playbook+${suffix}@example.com`;
  const deviceId = `playbook_device_${suffix}`;

  const agentRes = await request('/api/agents/create', {
    json: {
      username: agentUsername,
      callback_url: 'https://example.com/ottoauth/callback',
    },
  });
  assert(agentRes.response.ok, `Agent create failed: ${agentRes.text}`);
  const privateKey = agentRes.data.privateKey;
  const pairingKey = agentRes.data.pairingKey;
  assert(privateKey && pairingKey, 'Agent create response missing credentials');

  const loginRes = await request('/api/auth/dev-login', {
    cookieJar: jar,
    json: {
      email: humanEmail,
      display_name: 'Playbook Test',
    },
  });
  assert(loginRes.response.ok, `Dev login failed: ${loginRes.text}`);

  const pairAgentRes = await request('/api/human/pair-agent', {
    cookieJar: jar,
    json: { pairing_key: pairingKey },
  });
  assert(pairAgentRes.response.ok, `Pair agent failed: ${pairAgentRes.text}`);

  const pairingCodeRes = await request('/api/human/devices/pairing-code', {
    cookieJar: jar,
    json: { device_label: 'playbook-device' },
  });
  assert(pairingCodeRes.response.ok, `Create device code failed: ${pairingCodeRes.text}`);
  const pairingCode = pairingCodeRes.data.code;
  assert(pairingCode, 'Missing device claim code');

  const pairDeviceRes = await request('/api/computeruse/device/pair', {
    json: {
      device_id: deviceId,
      device_label: 'Playbook Device',
      pairing_code: pairingCode,
    },
  });
  assert(pairDeviceRes.response.ok, `Device pair failed: ${pairDeviceRes.text}`);
  const deviceToken = pairDeviceRes.data.deviceToken;
  assert(deviceToken, 'Missing device token');

  const submitTaskRes = await request('/api/services/order/submit', {
    json: {
      username: agentUsername,
      private_key: privateKey,
      task_prompt: 'Do not pay if the total exceeds the spend cap.',
      task_title: 'Snackpass playbook smoke',
      store: 'Snackpass',
      merchant: 'V&A Cafe',
      order_type: 'pickup',
      pickup_location: 'Berkeley, CA',
      item_name: 'one iced latte',
      url_policy: 'discover',
      max_charge_cents: 1800,
    },
  });
  assert(submitTaskRes.response.ok, `Submit task failed: ${submitTaskRes.text}`);
  const taskId = submitTaskRes.data.task.id;
  const computerUseTaskId = submitTaskRes.data.task.computeruse_task_id;
  assert(taskId && computerUseTaskId, 'Submit task missing ids');
  assert(
    submitTaskRes.data.fulfillment_playbooks?.some((playbook) => playbook.id === 'snackpass'),
    `Expected Snackpass playbook in submit response: ${submitTaskRes.text}`,
  );

  const waitTaskRes = await request('/api/computeruse/device/wait-task?waitMs=1000', {
    headers: {
      authorization: `Bearer ${deviceToken}`,
      'x-ottoauth-mock-device': deviceId,
    },
  });
  assert(waitTaskRes.response.ok, `Wait task failed: ${waitTaskRes.text}`);
  assert(waitTaskRes.data.id === computerUseTaskId, 'Wait-task returned unexpected task id');
  const goal = waitTaskRes.data.goal || waitTaskRes.data.task_prompt || '';
  assert(includes(goal, 'Retrieved fulfillment playbooks'), 'Queued task did not include playbook section');
  assert(includes(goal, 'Snackpass playbook'), 'Queued task did not include Snackpass playbook');
  assert(includes(goal, '"V&A Cafe" Snackpass Berkeley, CA'), 'Snackpass search query was not contextualized');
  assert(includes(goal, 'Do not start from the Snackpass public homepage'), 'Snackpass homepage warning missing');
  assert(includes(goal, "Do not treat the browser device's current city"), 'Location policy missing');

  const completeRes = await request(`/api/computeruse/device/tasks/${computerUseTaskId}/local-agent-complete`, {
    headers: {
      authorization: `Bearer ${deviceToken}`,
      'x-ottoauth-mock-device': deviceId,
    },
    json: {
      status: 'failed',
      error: 'Playbook verification stopped before purchase.',
      result: {
        status: 'failed',
        summary: 'Verified that the Snackpass playbook was injected; no purchase was attempted.',
      },
    },
  });
  assert(completeRes.response.ok, `Complete failed task failed: ${completeRes.text}`);

  const taskStatusRes = await request(`/api/services/order/tasks/${taskId}`, {
    json: {
      username: agentUsername,
      private_key: privateKey,
    },
  });
  assert(taskStatusRes.response.ok, `Task status failed: ${taskStatusRes.text}`);
  assert(taskStatusRes.data.task.status === 'failed', `Expected failed task, got ${taskStatusRes.data.task.status}`);
  assert(
    taskStatusRes.data.task.billing_status === 'not_charged',
    `Expected not_charged billing, got ${taskStatusRes.data.task.billing_status}`,
  );

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    selected_playbooks: submitTaskRes.data.fulfillment_playbooks,
    generic_task_id: taskId,
    computeruse_task_id: computerUseTaskId,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
