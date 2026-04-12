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

async function main() {
  const jar = new CookieJar();
  const suffix = Math.random().toString(36).slice(2, 8);
  const unlinkedAgentUsername = `unlinked_${suffix}`;
  const agentUsername = `credit_${suffix}`;
  const humanEmail = `human+${suffix}@example.com`;
  const deviceId = `raspi_${suffix}`;
  const deviceLabel = `raspberry-pi-${suffix}`;

  const unlinkedAgentRes = await request('/api/agents/create', {
    json: {
      username: unlinkedAgentUsername,
      callback_url: 'https://example.com/ottoauth/callback',
    },
  });
  assert(unlinkedAgentRes.response.ok, `Unlinked agent create failed: ${unlinkedAgentRes.text}`);
  const unlinkedPrivateKey = unlinkedAgentRes.data.privateKey;

  const unlinkedSubmitRes = await request('/api/services/computeruse/submit-task', {
    json: {
      username: unlinkedAgentUsername,
      private_key: unlinkedPrivateKey,
      task_prompt: 'Try to run before any human links me.',
    },
  });
  assert(unlinkedSubmitRes.response.status === 409, `Expected unlinked submit 409, got ${unlinkedSubmitRes.response.status}`);

  const agentRes = await request('/api/agents/create', {
    json: {
      username: agentUsername,
      callback_url: 'https://example.com/ottoauth/callback',
    },
  });
  assert(agentRes.response.ok, `Agent create failed: ${agentRes.text}`);
  const privateKey = agentRes.data.privateKey;
  const pairingKey = agentRes.data.pairingKey;
  assert(privateKey && pairingKey, 'Agent create response missing keys');

  const loginRes = await request('/api/auth/dev-login', {
    cookieJar: jar,
    json: {
      email: humanEmail,
      display_name: 'Human Test',
    },
  });
  assert(loginRes.response.ok, `Dev login failed: ${loginRes.text}`);

  const meBefore = await request('/api/human/me', { cookieJar: jar });
  assert(meBefore.response.ok, `Human me failed before pairing: ${meBefore.text}`);
  assert(meBefore.data.balance_cents === 2000, `Expected starter credits 2000, got ${meBefore.data.balance_cents}`);

  const pairAgentRes = await request('/api/human/pair-agent', {
    cookieJar: jar,
    json: { pairing_key: pairingKey },
  });
  assert(pairAgentRes.response.ok, `Pair agent failed: ${pairAgentRes.text}`);

  const pairAgentRepeatRes = await request('/api/human/pair-agent', {
    cookieJar: jar,
    json: { pairing_key: pairingKey },
  });
  assert(pairAgentRepeatRes.response.ok, `Repeat pair agent failed: ${pairAgentRepeatRes.text}`);
  assert(pairAgentRepeatRes.data.status === 'already_linked', `Expected already_linked, got ${pairAgentRepeatRes.data.status}`);

  const invalidPairDeviceRes = await request('/api/computeruse/device/pair', {
    json: {
      device_id: 'bad-device',
      pairing_code: 'NOPE-NOPE',
    },
  });
  assert(invalidPairDeviceRes.response.status === 400, `Expected invalid claim code 400, got ${invalidPairDeviceRes.response.status}`);

  const pairingCodeRes = await request('/api/human/devices/pairing-code', {
    cookieJar: jar,
    json: { device_label: 'raspberry-pi-browser' },
  });
  assert(pairingCodeRes.response.ok, `Create device code failed: ${pairingCodeRes.text}`);
  const pairingCode = pairingCodeRes.data.code;
  assert(pairingCode, 'Missing device claim code');

  const pairDeviceRes = await request('/api/computeruse/device/pair', {
    json: {
      device_id: deviceId,
      device_label: deviceLabel,
      pairing_code: pairingCode,
    },
  });
  assert(pairDeviceRes.response.ok, `Device pair failed: ${pairDeviceRes.text}`);
  const deviceToken = pairDeviceRes.data.deviceToken;
  assert(deviceToken, 'Missing device token');

  const submitTaskRes = await request('/api/services/computeruse/submit-task', {
    json: {
      username: agentUsername,
      private_key: privateKey,
      task_prompt: 'Buy office supplies if they fit in budget.',
      website_url: 'example.com/store',
      shipping_address: 'Jane Doe\n123 Market St\nSan Francisco, CA 94110',
      max_charge_cents: 1800,
    },
  });
  assert(submitTaskRes.response.ok, `Submit task failed: ${submitTaskRes.text}`);
  const taskId = submitTaskRes.data.task.id;
  const computerUseTaskId = submitTaskRes.data.task.computeruse_task_id;
  assert(taskId && computerUseTaskId, 'Submit task missing ids');

  const waitTaskRes = await request('/api/computeruse/device/wait-task?waitMs=1000', {
    headers: {
      authorization: `Bearer ${deviceToken}`,
      'x-ottoauth-mock-device': deviceId,
    },
  });
  assert(waitTaskRes.response.ok, `Wait task failed: ${waitTaskRes.text}`);
  assert(waitTaskRes.data.id === computerUseTaskId, 'Wait-task returned unexpected task id');

  const completeRes = await request(`/api/computeruse/device/tasks/${computerUseTaskId}/local-agent-complete`, {
    headers: {
      authorization: `Bearer ${deviceToken}`,
      'x-ottoauth-mock-device': deviceId,
    },
    json: {
      status: 'completed',
      result: {
        status: 'completed',
        summary: 'Bought office supplies successfully.',
        merchant: 'Example Mart',
        pickup_details: {
          order_number: 'A-1024',
          confirmation_code: 'CONF-55',
          pickup_code: 'PICK-88',
          ready_time: 'Today at 4:14 PM',
          pickup_name: 'Jane Doe',
          instructions: 'Tell the counter you are here for order A-1024.',
        },
        tracking_details: {
          tracking_number: '1Z999AA10123456784',
          tracking_url: 'https://example.com/track/1Z999AA10123456784',
          carrier: 'UPS',
          status: 'Label created',
          delivery_eta: 'Tomorrow by 8 PM',
          delivery_window: 'Tomorrow 2 PM - 8 PM',
          instructions: 'Signature not required.',
        },
        receipt_details: {
          order_reference: 'Receipt #8831',
          receipt_url: 'https://example.com/receipt/A-1024',
          receipt_text: 'Tie Guan Yin Milk Tea x1\\nBoba x1',
        },
        charges: {
          goods_cents: 1250,
          shipping_cents: 100,
          tax_cents: 100,
          other_cents: 50,
          currency: 'usd',
        },
      },
      usages: [
        {
          model: 'claude-sonnet-4-5-20250929',
          input_tokens: 10000,
          output_tokens: 1000,
          source: 'agent_loop',
        },
        {
          model: 'claude-haiku-4-5-20251001',
          input_tokens: 10000,
          output_tokens: 0,
          source: 'tool_find',
        },
      ],
    },
  });
  assert(completeRes.response.ok, `Complete task failed: ${completeRes.text}`);

  const taskStatusRes = await request(`/api/services/computeruse/tasks/${taskId}`, {
    json: {
      username: agentUsername,
      private_key: privateKey,
    },
  });
  assert(taskStatusRes.response.ok, `Task status failed: ${taskStatusRes.text}`);
  assert(taskStatusRes.data.task.status === 'completed', `Expected completed task, got ${taskStatusRes.data.task.status}`);
  assert(taskStatusRes.data.task.billing_status === 'debited', `Expected debited task, got ${taskStatusRes.data.task.billing_status}`);
  assert(taskStatusRes.data.task.total_debited === '$15.06', `Expected $15.06 debit, got ${taskStatusRes.data.task.total_debited}`);
  assert(
    taskStatusRes.data.task.payout_status === 'self_fulfilled',
    `Expected self_fulfilled payout, got ${taskStatusRes.data.task.payout_status}`,
  );
  assert(taskStatusRes.data.task.payout_total === '$15.06', `Expected $15.06 payout, got ${taskStatusRes.data.task.payout_total}`);
  assert(taskStatusRes.data.task.website_url === 'https://example.com/store', `Expected normalized website URL, got ${taskStatusRes.data.task.website_url}`);
  assert(taskStatusRes.data.task.shipping_address === 'Jane Doe\n123 Market St\nSan Francisco, CA 94110', `Expected shipping address to round-trip, got ${taskStatusRes.data.task.shipping_address}`);
  assert(taskStatusRes.data.task.pickup_details?.order_number === 'A-1024', `Expected order number A-1024, got ${JSON.stringify(taskStatusRes.data.task.pickup_details)}`);
  assert(taskStatusRes.data.task.pickup_details?.pickup_code === 'PICK-88', `Expected pickup code PICK-88, got ${JSON.stringify(taskStatusRes.data.task.pickup_details)}`);
  assert(taskStatusRes.data.task.pickup_details?.receipt_url === 'https://example.com/receipt/A-1024', `Expected receipt URL to round-trip, got ${taskStatusRes.data.task.pickup_details?.receipt_url}`);
  assert(taskStatusRes.data.task.pickup_summary?.includes('Order A-1024'), `Expected pickup summary to include order number, got ${taskStatusRes.data.task.pickup_summary}`);
  assert(taskStatusRes.data.task.tracking_details?.tracking_number === '1Z999AA10123456784', `Expected tracking number, got ${JSON.stringify(taskStatusRes.data.task.tracking_details)}`);
  assert(taskStatusRes.data.task.tracking_details?.carrier === 'UPS', `Expected UPS carrier, got ${JSON.stringify(taskStatusRes.data.task.tracking_details)}`);
  assert(taskStatusRes.data.task.tracking_summary?.includes('Tracking 1Z999AA10123456784'), `Expected tracking summary, got ${taskStatusRes.data.task.tracking_summary}`);

  const forbiddenStatusRes = await request(`/api/services/computeruse/tasks/${taskId}`, {
    json: {
      username: unlinkedAgentUsername,
      private_key: unlinkedPrivateKey,
    },
  });
  assert(
    forbiddenStatusRes.response.status === 403 || forbiddenStatusRes.response.status === 404,
    `Expected forbidden task status 403/404, got ${forbiddenStatusRes.response.status}`,
  );

  const meAfter = await request('/api/human/me', { cookieJar: jar });
  assert(meAfter.response.ok, `Human me failed after completion: ${meAfter.text}`);
  assert(meAfter.data.balance_cents === 2000, `Expected remaining credits 2000, got ${meAfter.data.balance_cents}`);

  const overBudgetRes = await request('/api/services/computeruse/submit-task', {
    json: {
      username: agentUsername,
      private_key: privateKey,
      task_prompt: 'Try another expensive purchase.',
      max_charge_cents: 2500,
    },
  });
  assert(overBudgetRes.response.status === 402, `Expected over-budget submit to fail with 402, got ${overBudgetRes.response.status}`);

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    remaining_balance_cents: meAfter.data.balance_cents,
    debited_total: taskStatusRes.data.task.total_debited,
    computeruse_task_id: computerUseTaskId,
    generic_task_id: taskId,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
