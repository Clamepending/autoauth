// Round-trip tests against vibe-id (the source of truth for credits) +
// the SDK surfaces that depend on it. Verifies grant/charge/transfer
// idempotency, hosted-checkout creation, and that autoauth's
// /v1/checkout/sessions, /v1/connect/sessions, and /v1/orders all
// round-trip correctly.

import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";

const BASE = "https://ottoauth.vibe-research.net";
const VIBE = "https://api.accounts.vibe-research.net";
const INTERNAL_KEY = process.env.VIBE_ID_INTERNAL_KEY;
const HUMAN_USER_ID = 1; // sotaogata
const VIBE_ID_USER_ID = 1;
const SECONDARY_VIBE_ID_USER_ID = 2; // nautiyal

const turso = createClient({ url: process.env.TURSO_DB_URL, authToken: process.env.TURSO_DB_AUTH_TOKEN });
const internalHeaders = { "x-internal-key": INTERNAL_KEY, "Content-Type": "application/json" };

function privateKey() { return `sk-oa-${randomBytes(32).toString("hex")}`; }

async function vibePost(path, body) {
  const r = await fetch(`${VIBE}${path}`, { method: "POST", headers: internalHeaders, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

async function vibeGet(path) {
  const r = await fetch(`${VIBE}${path}`, { headers: { "x-internal-key": INTERNAL_KEY } });
  return { status: r.status, body: await r.json() };
}

async function setupTestAgent() {
  const pk = privateKey();
  const username = `phase3_test_${randomBytes(3).toString("hex")}`;
  const now = new Date().toISOString();
  const insert = await turso.execute({
    sql: `INSERT INTO agents (username_lower, username_display, private_key, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [username, username, pk, "Phase 3 test agent", now, now],
  });
  const agentId = Number(insert.lastInsertRowid);
  await turso.execute({
    sql: `INSERT INTO human_agent_links (human_user_id, agent_id, pairing_key_used, linked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [HUMAN_USER_ID, agentId, "PHASE3_TEST", now, now, now],
  });
  return { agentId, username, pk };
}

async function teardown({ agentId }) {
  await turso.execute({ sql: "DELETE FROM human_agent_links WHERE agent_id = ?", args: [agentId] });
  await turso.execute({ sql: "DELETE FROM agents WHERE id = ?", args: [agentId] });
}

function check(label, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${label} ${detail}`);
  return ok;
}

async function main() {
  let allPass = true;
  const agent = await setupTestAgent();
  console.log(`[setup] agent ${agent.username} -> human ${HUMAN_USER_ID}`);

  try {
    // ============================================================
    // PART 1: vibe-id direct credit operations + idempotency
    // ============================================================
    console.log("\n=== Part 1: vibe-id credit ops + idempotency ===");

    const before = (await vibeGet(`/v1/users/${VIBE_ID_USER_ID}/credits`)).body.balance;
    console.log(`  Starting balance for user ${VIBE_ID_USER_ID}: $${(before / 100).toFixed(2)}`);

    const idem = `phase3-test-${Date.now()}`;
    const grant1 = await vibePost("/v1/grant", {
      user_id: VIBE_ID_USER_ID, amount: 100, reason: "Phase 3 test grant",
      idempotency_key: `${idem}-grant`,
    });
    allPass &= check("grant +$1.00", grant1.status === 200, `→ balance=${grant1.body.balance}`);

    const grant2 = await vibePost("/v1/grant", {
      user_id: VIBE_ID_USER_ID, amount: 100, reason: "Phase 3 test grant",
      idempotency_key: `${idem}-grant`,
    });
    allPass &= check("grant idempotent (same key)", grant2.status === 200 && grant2.body.balance === grant1.body.balance, `→ balance=${grant2.body.balance} (unchanged)`);

    const charge1 = await vibePost("/v1/charge", {
      user_id: VIBE_ID_USER_ID, amount: 100, reason: "Phase 3 test charge",
      idempotency_key: `${idem}-charge`, project: "ottoauth",
    });
    allPass &= check("charge -$1.00", charge1.status === 200, `→ balance=${charge1.body.balance}`);

    const charge2 = await vibePost("/v1/charge", {
      user_id: VIBE_ID_USER_ID, amount: 100, reason: "Phase 3 test charge",
      idempotency_key: `${idem}-charge`, project: "ottoauth",
    });
    allPass &= check("charge idempotent", charge2.status === 200 && charge2.body.balance === charge1.body.balance, `→ balance=${charge2.body.balance}`);

    const after = (await vibeGet(`/v1/users/${VIBE_ID_USER_ID}/credits`)).body.balance;
    allPass &= check("net change is zero", after === before, `before=${before}, after=${after}`);

    // ============================================================
    // PART 2: vibe-id atomic transfer (the P2P feature)
    // ============================================================
    console.log("\n=== Part 2: vibe-id atomic transfer (sendHumanCreditTransfer backend) ===");

    const fromBefore = (await vibeGet(`/v1/users/${VIBE_ID_USER_ID}/credits`)).body.balance;
    const toBefore = (await vibeGet(`/v1/users/${SECONDARY_VIBE_ID_USER_ID}/credits`)).body.balance;
    console.log(`  Before: user ${VIBE_ID_USER_ID}=$${(fromBefore / 100).toFixed(2)}, user ${SECONDARY_VIBE_ID_USER_ID}=$${(toBefore / 100).toFixed(2)}`);

    const transferIdem = `phase3-transfer-${Date.now()}`;
    const t1 = await vibePost("/v1/transfer", {
      from_user_id: VIBE_ID_USER_ID, to_user_id: SECONDARY_VIBE_ID_USER_ID,
      amount: 50, reason: "Phase 3 test transfer", idempotency_key: transferIdem,
    });
    allPass &= check("transfer $0.50 ok", t1.status === 200, `from=${t1.body.from_balance} to=${t1.body.to_balance}`);
    allPass &= check("transfer affected both balances", t1.body.from_balance === fromBefore - 50 && t1.body.to_balance === toBefore + 50);

    const t2 = await vibePost("/v1/transfer", {
      from_user_id: VIBE_ID_USER_ID, to_user_id: SECONDARY_VIBE_ID_USER_ID,
      amount: 50, reason: "Phase 3 test transfer", idempotency_key: transferIdem,
    });
    allPass &= check("transfer idempotent", t2.status === 200 && t2.body.from_balance === t1.body.from_balance, "same key → no double-spend");

    // Reverse the transfer with new idem
    const reverse = await vibePost("/v1/transfer", {
      from_user_id: SECONDARY_VIBE_ID_USER_ID, to_user_id: VIBE_ID_USER_ID,
      amount: 50, reason: "Phase 3 test reverse", idempotency_key: `${transferIdem}-reverse`,
    });
    allPass &= check("reverse transfer ok", reverse.status === 200);

    const fromAfter = (await vibeGet(`/v1/users/${VIBE_ID_USER_ID}/credits`)).body.balance;
    const toAfter = (await vibeGet(`/v1/users/${SECONDARY_VIBE_ID_USER_ID}/credits`)).body.balance;
    allPass &= check("transfers fully reversed", fromAfter === fromBefore && toAfter === toBefore, `from=${fromAfter}/${fromBefore} to=${toAfter}/${toBefore}`);

    // ============================================================
    // PART 3: vibe-id ledger contains the entries we just made
    // ============================================================
    console.log("\n=== Part 3: vibe-id ledger has the entries from this run ===");

    const ledger = (await vibeGet(`/v1/users/${VIBE_ID_USER_ID}/ledger?limit=20`)).body;
    const entries = ledger.entries ?? [];
    const reasons = entries.map((e) => e.reason).slice(0, 8);
    console.log(`  Top reasons: ${reasons.join(" | ")}`);
    allPass &= check("ledger contains 'Phase 3 test grant'", entries.some((e) => e.reason === "Phase 3 test grant"));
    allPass &= check("ledger contains 'Phase 3 test charge'", entries.some((e) => e.reason === "Phase 3 test charge"));
    allPass &= check("ledger contains 'Phase 3 test transfer'", entries.some((e) => e.reason === "Phase 3 test transfer"));

    // ============================================================
    // PART 4: SDK /v1/orders with bearer (real auth path)
    // ============================================================
    console.log("\n=== Part 4: SDK /v1/orders with agent bearer ===");

    const auth = { Authorization: `Bearer ${agent.pk}`, "Content-Type": "application/json" };

    const ordersGet = await fetch(`${BASE}/v1/orders`, { headers: auth });
    const ordersList = await ordersGet.json();
    allPass &= check("GET /v1/orders auth+ok", ordersGet.status === 200 && ordersList.ok === true, `→ ${ordersList.orders?.length ?? 0} orders`);

    const dryRun = await fetch(`${BASE}/v1/orders`, {
      method: "POST", headers: auth,
      body: JSON.stringify({
        dry_run: true,
        task: "buy 1x arduino uno", url: "https://www.mouser.com/ProductDetail/Arduino/A000066",
        shipping_address: { name: "Test", line1: "1 Test St", city: "Sunnyvale", state: "CA", postal_code: "94086", country: "US" },
      }),
    });
    const dryBody = await dryRun.json();
    allPass &= check("POST /v1/orders dry_run", dryRun.status === 200 && dryBody.ok && dryBody.dry_run, `provider=${dryBody.order_preview?.provider?.id}`);

    const badBearer = await fetch(`${BASE}/v1/orders`, {
      method: "GET", headers: { Authorization: "Bearer sk-oa-deadbeef" },
    });
    allPass &= check("GET /v1/orders bad bearer rejected", badBearer.status === 401);

    // ============================================================
    // PART 5: SDK /v1/connect/sessions with valid payload
    // ============================================================
    console.log("\n=== Part 5: SDK /v1/connect/sessions ===");
    const connect = await fetch(`${BASE}/v1/connect/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_name: "Phase 3 Test", redirect_url: "https://example.com/callback", scopes: ["orders:create"],
      }),
    });
    const connectBody = await connect.json();
    allPass &= check("POST /v1/connect/sessions ok", connect.status === 201 && connectBody.ok, `id=${connectBody.id}`);
    if (connectBody.connect_url) {
      const land = await fetch(connectBody.connect_url, { redirect: "manual" });
      allPass &= check("connect_url loads", land.status === 200 || (land.status >= 300 && land.status < 400), `status=${land.status}`);
    }

    // ============================================================
    // PART 6: SDK /v1/checkout/sessions hosted (no auth required)
    // ============================================================
    console.log("\n=== Part 6: SDK /v1/checkout/sessions (hosted) ===");
    const hosted = await fetch(`${BASE}/v1/checkout/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public: true,
        app_name: "Phase 3 Hosted Test",
        line_items: [{
          task: "buy 1x arduino uno from mouser",
          url: "https://www.mouser.com/ProductDetail/Arduino/A000066",
          quantity: 1,
        }],
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      }),
    });
    const hostedBody = await hosted.json();
    allPass &= check("hosted checkout session ok", hosted.status === 201 && hostedBody.ok, `id=${hostedBody.id}`);
    if (hostedBody.url) {
      const land = await fetch(hostedBody.url, { redirect: "manual" });
      allPass &= check("hosted checkout url loads", land.status === 200 || (land.status >= 300 && land.status < 400), `status=${land.status}`);
    }

    // ============================================================
    // PART 7: signed-out fallback (autoauth /api/auth/vibe-id/login)
    // ============================================================
    console.log("\n=== Part 7: vibe-id login redirect ===");
    const loginRedirect = await fetch(`${BASE}/api/auth/vibe-id/login?return_to=/dashboard`, { redirect: "manual" });
    const location = loginRedirect.headers.get("location") ?? "";
    allPass &= check("login redirects to vibe-id", loginRedirect.status === 302 && location.startsWith("https://api.accounts.vibe-research.net/auth/start"), `→ ${location.slice(0, 80)}`);

    console.log("\n=========================================");
    console.log(allPass ? "ALL TESTS PASSED" : "SOME TESTS FAILED");
    console.log("=========================================\n");
  } finally {
    await teardown({ agentId: agent.agentId });
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("[fail]", e); process.exit(1); });
