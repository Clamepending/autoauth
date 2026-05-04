import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { rm } from "node:fs/promises";

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    const fallback = response.headers.get("set-cookie");
    for (const header of setCookies.length ? setCookies : fallback ? [fallback] : []) {
      const first = header.split(";")[0];
      const eq = first.indexOf("=");
      if (eq > 0) this.cookies.set(first.slice(0, eq), first.slice(eq + 1));
    }
  }

  header() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

async function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function startVendorMock() {
  const calls = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const body = await readBody(request);
    calls.push({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: request.headers,
      body,
    });

    if (url.pathname === "/mouser/cart/items/insert") {
      assert.equal(url.searchParams.get("apiKey"), "mouser-e2e-key");
      const parsed = JSON.parse(body);
      assert.equal(parsed.CartKey, "");
      assert.equal(parsed.CountryCode, "US");
      assert.equal(parsed.CurrencyCode, "USD");
      assert.equal(parsed.CartItems[0].MouserPartNumber, "595-NE555P");
      assert.equal(parsed.CartItems[0].Quantity, 1);
      sendJson(response, 200, { CartKey: "cart_mouser_e2e" });
      return;
    }

    if (url.pathname === "/mouser/order") {
      assert.equal(url.searchParams.get("apiKey"), "mouser-e2e-key");
      const parsed = JSON.parse(body);
      assert.equal(parsed.CartKey, "cart_mouser_e2e");
      assert.equal(parsed.CurrencyCode, "USD");
      assert.equal(parsed.SubmitOrder, true);
      sendJson(response, 200, { OrderTotal: 12.34, OrderNumber: "M-E2E-1" });
      return;
    }

    if (url.pathname === "/jlcpcb/pcb-order") {
      assert.equal(request.headers.authorization, "Bearer jlcpcb-e2e-key");
      const parsed = JSON.parse(body);
      assert.equal(parsed.submitOrder, true);
      assert.equal(parsed.gerberFileUrl, "https://example.com/project-gerbers.zip");
      assert.equal(parsed.bomFileUrl, "https://example.com/project-bom.csv");
      assert.equal(parsed.cplFileUrl, "https://example.com/project-cpl.csv");
      sendJson(response, 200, {
        orderId: "JLC-E2E-1",
        totalPrice: 15.55,
        status: "submitted",
      });
      return;
    }

    if (url.pathname === "/jlcpcb/over-cap") {
      assert.equal(request.headers.authorization, "Bearer jlcpcb-e2e-key");
      const parsed = JSON.parse(body);
      assert.equal(parsed.submitOrder, false);
      sendJson(response, 200, {
        quoteId: "JLC-QUOTE-EXPENSIVE",
        totalPrice: 99.99,
        status: "quoted",
      });
      return;
    }

    if (url.pathname === "/treatstock/printable-packs/") {
      assert.equal(url.searchParams.get("private-key"), "treatstock-e2e-key");
      assert.match(body, /files-urls\[\]/);
      assert.match(body, /https:\/\/example\.com\/enclosure\.stl/);
      assert.match(body, /location\[country\]/);
      sendJson(response, 200, { success: true, id: "pack_treatstock_e2e" });
      return;
    }

    if (url.pathname === "/treatstock/printable-pack-costs/") {
      assert.equal(url.searchParams.get("private-key"), "treatstock-e2e-key");
      assert.equal(url.searchParams.get("printablePackId"), "pack_treatstock_e2e");
      sendJson(response, 200, [
        { providerId: "expensive-provider", price: "19.99", materialGroup: "PLA", color: "White" },
        { providerId: "cheap-provider", price: "13.37", materialGroup: "PLA", color: "Black" },
      ]);
      return;
    }

    if (url.pathname === "/treatstock/place-order/create") {
      assert.equal(url.searchParams.get("private-key"), "treatstock-e2e-key");
      const parsed = JSON.parse(body);
      assert.equal(parsed.printablePackId, "pack_treatstock_e2e");
      assert.equal(parsed.providerId, "cheap-provider");
      assert.equal(parsed.shippingAddress.country, "US");
      assert.equal(parsed.shippingAddress.zip, "94105");
      assert.equal(parsed.modelTextureInfo.modelTexture.materialGroup, "PLA");
      assert.equal(parsed.modelTextureInfo.modelTexture.color, "Black");
      sendJson(response, 200, {
        orderId: "TS-E2E-1",
        total: 13.37,
        url: "https://treatstock.example/orders/TS-E2E-1",
      });
      return;
    }

    sendJson(response, 404, { error: `Unhandled ${url.pathname}` });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    origin: `http://${address.address}:${address.port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForServer(baseUrl, child) {
  let lastError = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Next dev exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/services`);
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error("Next dev did not become ready.");
}

async function request(baseUrl, path, options = {}) {
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

async function createLinkedAgent(baseUrl, label) {
  const suffix = `${label}_${Math.random().toString(36).slice(2, 8)}`;
  const jar = new CookieJar();
  const agentRes = await request(baseUrl, "/api/agents/create", {
    json: {
      username: suffix,
      callback_url: "https://example.com/ottoauth/callback",
    },
  });
  assert(agentRes.response.ok, `${label}: agent create failed: ${agentRes.text}`);
  assert(agentRes.data.privateKey, `${label}: missing private key`);
  assert(agentRes.data.pairingKey, `${label}: missing pairing key`);

  const loginRes = await request(baseUrl, "/api/auth/dev-login", {
    cookieJar: jar,
    json: {
      email: `${suffix}@example.com`,
      display_name: `${label} E2E`,
    },
  });
  assert(loginRes.response.ok, `${label}: dev login failed: ${loginRes.text}`);

  const pairRes = await request(baseUrl, "/api/human/pair-agent", {
    cookieJar: jar,
    json: { pairing_key: agentRes.data.pairingKey },
  });
  assert(pairRes.response.ok, `${label}: pair agent failed: ${pairRes.text}`);

  return { username: suffix, privateKey: agentRes.data.privateKey };
}

async function submitAndAssert(baseUrl, label, credentials, payload, expected) {
  const submitRes = await request(baseUrl, "/api/services/order/submit", {
    json: {
      username: credentials.username,
      private_key: credentials.privateKey,
      ...payload,
    },
  });
  assert(submitRes.response.ok, `${label}: submit failed: ${submitRes.text}`);
  assert.equal(submitRes.data.ok, true, `${label}: submit did not complete successfully`);
  assert.equal(submitRes.data.fulfillment.category, "api", `${label}: wrong fulfillment category`);
  assert.equal(submitRes.data.fulfillment.selection.adapter_id, expected.adapterId);
  assert.equal(submitRes.data.commerce_route.adapter_id, expected.adapterId);
  assert.equal(submitRes.data.commerce_route.execution_rail, "api");
  assert.equal(submitRes.data.task.status, "completed");
  assert.equal(submitRes.data.task.billing_status, "debited");
  assert.equal(submitRes.data.task.fulfillment_category, "api");
  assert.equal(submitRes.data.task.commerce_adapter_id, expected.adapterId);
  assert.equal(submitRes.data.task.goods_total, expected.goodsTotal);
  assert.equal(submitRes.data.task.total_debited, expected.goodsTotal);

  const statusRes = await request(baseUrl, `/api/services/order/tasks/${submitRes.data.task.id}`, {
    json: {
      username: credentials.username,
      private_key: credentials.privateKey,
    },
  });
  assert(statusRes.response.ok, `${label}: status failed: ${statusRes.text}`);
  assert.equal(statusRes.data.task.status, "completed");
  assert.equal(statusRes.data.task.billing_status, "debited");
  assert.equal(statusRes.data.task.commerce_adapter_id, expected.adapterId);
  assert.equal(statusRes.data.task.goods_total, expected.goodsTotal);

  return {
    task_id: submitRes.data.task.id,
    run_id: submitRes.data.run_id,
    adapter_id: expected.adapterId,
    goods_total: expected.goodsTotal,
    category: submitRes.data.commerce_route.category,
  };
}

async function submitAndAssertFailed(baseUrl, label, credentials, payload, expected) {
  const submitRes = await request(baseUrl, "/api/services/order/submit", {
    json: {
      username: credentials.username,
      private_key: credentials.privateKey,
      ...payload,
    },
  });
  assert(submitRes.response.ok, `${label}: submit request failed: ${submitRes.text}`);
  assert.equal(submitRes.data.ok, false, `${label}: expected failed task`);
  assert.equal(submitRes.data.fulfillment.category, "api");
  assert.equal(submitRes.data.fulfillment.selection.adapter_id, expected.adapterId);
  assert.equal(submitRes.data.task.status, "failed");
  assert.equal(submitRes.data.task.billing_status, "not_charged");
  assert.equal(submitRes.data.task.fulfillment_category, "api");
  assert.equal(submitRes.data.task.commerce_adapter_id, expected.adapterId);
  assert.match(submitRes.data.task.error || "", expected.errorPattern);

  const statusRes = await request(baseUrl, `/api/services/order/tasks/${submitRes.data.task.id}`, {
    json: {
      username: credentials.username,
      private_key: credentials.privateKey,
    },
  });
  assert(statusRes.response.ok, `${label}: status failed: ${statusRes.text}`);
  assert.equal(statusRes.data.task.status, "failed");
  assert.equal(statusRes.data.task.billing_status, "not_charged");
  assert.equal(statusRes.data.task.commerce_adapter_id, expected.adapterId);

  return {
    task_id: submitRes.data.task.id,
    run_id: submitRes.data.run_id,
    adapter_id: expected.adapterId,
    status: "failed",
    billing_status: "not_charged",
    error: submitRes.data.task.error,
  };
}

async function main() {
  const vendor = await startVendorMock();
  const nextPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${nextPort}`;
  const dbPath = `/tmp/ottoauth-commerce-vendors-${process.pid}-${Date.now()}.db`;
  let next = null;

  try {
    next = spawn("npm", ["run", "dev", "--", "-p", String(nextPort), "-H", "127.0.0.1"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        OTTOAUTH_ENABLE_DEV_HUMAN_LOGIN: "1",
        TURSO_DB_URL: `file:${dbPath}`,
        OTTOAUTH_MOUSER_API_KEY: "mouser-e2e-key",
        OTTOAUTH_MOUSER_API_BASE_URL: `${vendor.origin}/mouser`,
        OTTOAUTH_JLCPCB_API_BASE_URL: vendor.origin,
        OTTOAUTH_JLCPCB_API_KEY: "jlcpcb-e2e-key",
        OTTOAUTH_TREATSTOCK_PRIVATE_KEY: "treatstock-e2e-key",
        OTTOAUTH_TREATSTOCK_API_BASE_URL: `${vendor.origin}/treatstock`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverOutput = "";
    next.stdout.on("data", (chunk) => {
      serverOutput += chunk.toString();
    });
    next.stderr.on("data", (chunk) => {
      serverOutput += chunk.toString();
    });

    await waitForServer(baseUrl, next);

    const mouser = await createLinkedAgent(baseUrl, "mouser");
    const jlcpcb = await createLinkedAgent(baseUrl, "jlcpcb");
    const jlcpcbOverCap = await createLinkedAgent(baseUrl, "jlcpcb_cap");
    const treatstock = await createLinkedAgent(baseUrl, "treatstock");

    const results = [];
    results.push(
      await submitAndAssert(
        baseUrl,
        "mouser",
        mouser,
        {
          task_title: "Mouser NE555 timer order",
          task_prompt: "Order one NE555 timer from Mouser.",
          store: "mouser",
          merchant: "Mouser",
          website_url: "https://www.mouser.com/",
          max_charge_cents: 1800,
          items: [{ mouser_part_number: "595-NE555P", quantity: 1 }],
          api_checkout: {
            submit_order: true,
            currency_code: "USD",
          },
          mandate: {
            allowed_categories: ["industrial_parts"],
            allowed_merchants: ["mouser"],
            max_total_cents: 1800,
          },
        },
        { adapterId: "api.mouser", goodsTotal: "$12.34" },
      ),
    );

    results.push(
      await submitAndAssert(
        baseUrl,
        "jlcpcb",
        jlcpcb,
        {
          task_title: "JLCPCB PCB assembly order",
          task_prompt: "Submit a PCB and PCBA order through JLCPCB.",
          store: "jlcpcb",
          merchant: "JLCPCB",
          website_url: "https://jlcpcb.com/",
          max_charge_cents: 1800,
          api_checkout: {
            native_endpoint_path: "/jlcpcb/pcb-order",
            native_order_request: {
              submitOrder: true,
              gerberFileUrl: "https://example.com/project-gerbers.zip",
              bomFileUrl: "https://example.com/project-bom.csv",
              cplFileUrl: "https://example.com/project-cpl.csv",
            },
          },
          mandate: {
            allowed_categories: ["custom_manufacturing", "industrial_parts"],
            allowed_merchants: ["jlcpcb"],
            max_total_cents: 1800,
          },
        },
        { adapterId: "api.jlcpcb", goodsTotal: "$15.55" },
      ),
    );

    results.push(
      await submitAndAssertFailed(
        baseUrl,
        "jlcpcb-over-cap",
        jlcpcbOverCap,
        {
          task_title: "JLCPCB over-cap quote",
          task_prompt: "Quote a PCB assembly order through JLCPCB, but do not exceed the spend cap.",
          store: "jlcpcb",
          merchant: "JLCPCB",
          website_url: "https://jlcpcb.com/",
          max_charge_cents: 100,
          api_checkout: {
            native_endpoint_path: "/jlcpcb/over-cap",
            native_order_request: {
              submitOrder: false,
              gerberFileUrl: "https://example.com/expensive-gerbers.zip",
            },
          },
          mandate: {
            allowed_categories: ["custom_manufacturing", "industrial_parts"],
            allowed_merchants: ["jlcpcb"],
            max_total_cents: 100,
          },
        },
        {
          adapterId: "api.jlcpcb",
          errorPattern: /spend cap/,
        },
      ),
    );

    results.push(
      await submitAndAssert(
        baseUrl,
        "treatstock",
        treatstock,
        {
          task_title: "Treatstock enclosure print",
          task_prompt: "Order one black PLA enclosure print through Treatstock.",
          store: "treatstock",
          merchant: "Treatstock",
          website_url: "https://www.treatstock.com/",
          max_charge_cents: 1800,
          model_urls: ["https://example.com/enclosure.stl"],
          api_checkout: {
            submit_order: true,
            country: "US",
            material_group: "PLA",
            color: "Black",
            shipping_address: {
              country: "US",
              zip: "94105",
              city: "San Francisco",
              state: "CA",
              street: "123 Main St",
              firstName: "Jane",
              lastName: "Doe",
            },
          },
          mandate: {
            allowed_categories: ["custom_manufacturing"],
            allowed_merchants: ["treatstock"],
            max_total_cents: 1800,
          },
        },
        { adapterId: "api.treatstock", goodsTotal: "$13.37" },
      ),
    );

    const byPath = vendor.calls.reduce((counts, call) => {
      counts[call.path] = (counts[call.path] || 0) + 1;
      return counts;
    }, {});
    for (const path of [
      "/mouser/cart/items/insert",
      "/mouser/order",
      "/jlcpcb/pcb-order",
      "/jlcpcb/over-cap",
      "/treatstock/printable-packs/",
      "/treatstock/printable-pack-costs/",
      "/treatstock/place-order/create",
    ]) {
      assert(byPath[path] > 0, `Expected vendor call to ${path}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          results,
          vendor_calls: vendor.calls.map((call) => ({
            method: call.method,
            path: call.path,
            query: call.query,
          })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (next?.exitCode != null) {
      console.error(`Next dev exited with code ${next.exitCode}`);
    }
    throw error;
  } finally {
    if (next && next.exitCode == null) {
      next.kill("SIGTERM");
      await Promise.race([once(next, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (next.exitCode == null) next.kill("SIGKILL");
    }
    await vendor.close();
    await rm(dbPath, { force: true }).catch(() => {});
    await rm(`${dbPath}-shm`, { force: true }).catch(() => {});
    await rm(`${dbPath}-wal`, { force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
