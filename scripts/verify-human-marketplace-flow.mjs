const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3102';

const ONE_BY_ONE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Zl6kAAAAASUVORK5CYII=';

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
  if (options.json) headers.set('content-type', 'application/json');
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
  if (!condition) throw new Error(message);
}

async function loginHuman(cookieJar, email, displayName) {
  const response = await request('/api/auth/dev-login', {
    cookieJar,
    json: { email, display_name: displayName },
  });
  assert(response.response.ok, `Dev login failed for ${email}: ${response.text}`);
}

async function pairClaimedDevice(cookieJar, deviceId, deviceLabel) {
  const pairingCodeRes = await request('/api/human/devices/pairing-code', {
    cookieJar,
    json: { device_label: deviceLabel },
  });
  assert(pairingCodeRes.response.ok, `Create pairing code failed: ${pairingCodeRes.text}`);
  const pairRes = await request('/api/computeruse/device/pair', {
    json: {
      device_id: deviceId,
      device_label: deviceLabel,
      pairing_code: pairingCodeRes.data.code,
    },
  });
  assert(pairRes.response.ok, `Pair device failed: ${pairRes.text}`);
  return pairRes.data.deviceToken;
}

async function main() {
  const fulfillerJar = new CookieJar();
  const requesterJar = new CookieJar();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const marketplaceDeviceId = `market_${Math.random().toString(36).slice(2, 8)}`;
  const marketplaceDeviceLabel = `market-browser-${suffix}`;
  const ownDeviceId = `own_${Math.random().toString(36).slice(2, 8)}`;
  const ownDeviceLabel = `own-browser-${suffix}`;

  await loginHuman(fulfillerJar, `fulfiller+${suffix}@example.com`, 'Fulfiller Human');
  const marketplaceToken = await pairClaimedDevice(
    fulfillerJar,
    marketplaceDeviceId,
    marketplaceDeviceLabel,
  );

  const marketplaceEnableRes = await request(`/api/human/devices/${encodeURIComponent(marketplaceDeviceId)}/marketplace`, {
    cookieJar: fulfillerJar,
    json: { enabled: true },
  });
  assert(
    marketplaceEnableRes.response.ok,
    `Marketplace enable failed: ${marketplaceEnableRes.text}`,
  );

  const idleWaitRes = await request('/api/computeruse/device/wait-task?waitMs=100', {
    headers: {
      authorization: `Bearer ${marketplaceToken}`,
      'x-ottoauth-mock-device': marketplaceDeviceId,
    },
  });
  assert(
    idleWaitRes.response.status === 204,
    `Expected idle marketplace poll 204, got ${idleWaitRes.response.status}`,
  );

  await loginHuman(requesterJar, `requester+${suffix}@example.com`, 'Requester Human');
  const offlineOwnToken = await pairClaimedDevice(
    requesterJar,
    ownDeviceId,
    ownDeviceLabel,
  );
  assert(offlineOwnToken, 'Missing offline own device token');

  const submitTaskRes = await request('/api/human/tasks', {
    cookieJar: requesterJar,
    json: {
      task_title: 'Buy office supplies from the marketplace',
      website_url: 'https://example.com/checkout',
      shipping_address: 'Requester Human\n500 Howard St\nSan Francisco, CA 94105',
      task_prompt: 'Buy office supplies if they fit in budget.',
      max_charge_cents: 1800,
    },
  });
  assert(submitTaskRes.response.ok, `Human submit task failed: ${submitTaskRes.text}`);
  assert(
    submitTaskRes.data.fulfillment.selection === 'marketplace',
    `Expected marketplace selection, got ${submitTaskRes.data.fulfillment.selection}`,
  );
  assert(
    submitTaskRes.data.fulfillment.device_id === marketplaceDeviceId,
    `Expected ${marketplaceDeviceId}, got ${submitTaskRes.data.fulfillment.device_id}`,
  );

  const taskId = submitTaskRes.data.task.id;
  const computerUseTaskId = submitTaskRes.data.task.computeruse_task_id;
  assert(taskId && computerUseTaskId, 'Task ids missing from human submit response');

  const waitTaskRes = await request('/api/computeruse/device/wait-task?waitMs=1000', {
    headers: {
      authorization: `Bearer ${marketplaceToken}`,
      'x-ottoauth-mock-device': marketplaceDeviceId,
    },
  });
  assert(waitTaskRes.response.ok, `Marketplace wait-task failed: ${waitTaskRes.text}`);
  assert(
    waitTaskRes.data.id === computerUseTaskId,
    `Unexpected task delivered to marketplace device: ${waitTaskRes.text}`,
  );

  const snapshotRes = await request(`/api/computeruse/device/tasks/${computerUseTaskId}/snapshot`, {
    headers: {
      authorization: `Bearer ${marketplaceToken}`,
      'x-ottoauth-mock-device': marketplaceDeviceId,
    },
    json: {
      image_base64: ONE_BY_ONE_PNG,
      width: 1,
      height: 1,
    },
  });
  assert(snapshotRes.response.ok, `Snapshot upload failed: ${snapshotRes.text}`);

  const detailBeforeComplete = await request(`/api/human/tasks/${taskId}`, {
    cookieJar: requesterJar,
  });
  assert(
    detailBeforeComplete.response.ok,
    `Human task detail failed before completion: ${detailBeforeComplete.text}`,
  );
  assert(
    detailBeforeComplete.data.latest_snapshot?.image_base64 === ONE_BY_ONE_PNG,
    'Latest snapshot missing from task detail response',
  );
  assert(
    detailBeforeComplete.data.task.website_url === 'https://example.com/checkout',
    `Expected website URL to round-trip, got ${detailBeforeComplete.data.task.website_url}`,
  );
  assert(
    detailBeforeComplete.data.task.shipping_address === 'Requester Human\n500 Howard St\nSan Francisco, CA 94105',
    `Expected shipping address to round-trip, got ${detailBeforeComplete.data.task.shipping_address}`,
  );

  const completeRes = await request(`/api/computeruse/device/tasks/${computerUseTaskId}/local-agent-complete`, {
    headers: {
      authorization: `Bearer ${marketplaceToken}`,
      'x-ottoauth-mock-device': marketplaceDeviceId,
    },
    json: {
      status: 'completed',
      result: {
        status: 'completed',
        summary: 'Bought office supplies successfully.',
        merchant: 'Example Mart',
        pickup_details: {
          order_number: 'MK-204',
          confirmation_code: 'CONF-204',
          pickup_code: 'PK-204',
          ready_time: 'Tomorrow at 11:05 AM',
          pickup_name: 'Requester Human',
          instructions: 'Show the pickup code at the front desk.',
        },
        tracking_details: {
          tracking_number: '9400110200881357000000',
          tracking_url: 'https://example.com/track/9400110200881357000000',
          carrier: 'USPS',
          status: 'In transit',
          delivery_eta: 'Friday by 6 PM',
          delivery_window: 'Friday afternoon',
          instructions: 'Leave at front desk.',
        },
        receipt_details: {
          order_reference: 'Marketplace Receipt 204',
          receipt_url: 'https://example.com/receipt/MK-204',
          receipt_text: 'Notebook x1\\nPens x2',
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
  assert(completeRes.response.ok, `Marketplace completion failed: ${completeRes.text}`);

  const requesterDetail = await request(`/api/human/tasks/${taskId}`, {
    cookieJar: requesterJar,
  });
  assert(requesterDetail.response.ok, `Requester detail failed: ${requesterDetail.text}`);
  assert(
    requesterDetail.data.task.status === 'completed',
    `Expected completed task, got ${requesterDetail.data.task.status}`,
  );
  assert(
    requesterDetail.data.task.total_debited === '$15.06',
    `Expected requester debit $15.06, got ${requesterDetail.data.task.total_debited}`,
  );
  assert(
    requesterDetail.data.task.payout_total === '$15.06',
    `Expected fulfiller payout $15.06, got ${requesterDetail.data.task.payout_total}`,
  );
  assert(
    requesterDetail.data.task.payout_status === 'credited',
    `Expected payout status credited, got ${requesterDetail.data.task.payout_status}`,
  );
  assert(
    requesterDetail.data.task.pickup_details?.order_number === 'MK-204',
    `Expected order number MK-204, got ${JSON.stringify(requesterDetail.data.task.pickup_details)}`,
  );
  assert(
    requesterDetail.data.task.pickup_details?.pickup_code === 'PK-204',
    `Expected pickup code PK-204, got ${JSON.stringify(requesterDetail.data.task.pickup_details)}`,
  );
  assert(
    requesterDetail.data.task.pickup_summary?.includes('Order MK-204'),
    `Expected pickup summary to include order number, got ${requesterDetail.data.task.pickup_summary}`,
  );
  assert(
    requesterDetail.data.task.tracking_details?.tracking_number === '9400110200881357000000',
    `Expected USPS tracking number, got ${JSON.stringify(requesterDetail.data.task.tracking_details)}`,
  );
  assert(
    requesterDetail.data.task.tracking_details?.carrier === 'USPS',
    `Expected USPS carrier, got ${JSON.stringify(requesterDetail.data.task.tracking_details)}`,
  );
  assert(
    requesterDetail.data.task.tracking_summary?.includes('Tracking 9400110200881357000000'),
    `Expected tracking summary, got ${requesterDetail.data.task.tracking_summary}`,
  );

  const requesterMe = await request('/api/human/me', { cookieJar: requesterJar });
  const fulfillerMe = await request('/api/human/me', { cookieJar: fulfillerJar });
  assert(requesterMe.response.ok, `Requester /me failed: ${requesterMe.text}`);
  assert(fulfillerMe.response.ok, `Fulfiller /me failed: ${fulfillerMe.text}`);
  assert(
    requesterMe.data.balance_cents === 494,
    `Expected requester balance 494, got ${requesterMe.data.balance_cents}`,
  );
  assert(
    fulfillerMe.data.balance_cents === 3506,
    `Expected fulfiller balance 3506, got ${fulfillerMe.data.balance_cents}`,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        task_id: taskId,
        computeruse_task_id: computerUseTaskId,
        requester_balance_cents: requesterMe.data.balance_cents,
        fulfiller_balance_cents: fulfillerMe.data.balance_cents,
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
