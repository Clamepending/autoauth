// End-to-end SDK test against ottoauth.vibe-research.net.
// Inserts a temp agent linked to human_user_id=1, exercises /v1/* routes
// with the agent's bearer, then cleans up.

import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";

const BASE = "https://ottoauth.vibe-research.net";
const HUMAN_USER_ID = 1; // sotaogata, vibe_id_user_id=1, balance ~$59.48 from earlier check

const turso = createClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_DB_AUTH_TOKEN,
});

function privateKey() {
  return `sk-oa-${randomBytes(32).toString("hex")}`;
}

async function setupTestAgent() {
  const pk = privateKey();
  const username = `sdk_test_${randomBytes(3).toString("hex")}`;
  const now = new Date().toISOString();
  const insert = await turso.execute({
    sql: `INSERT INTO agents (username_lower, username_display, private_key, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [username, username, pk, "Phase 3 SDK test agent", now, now],
  });
  const agentId = Number(insert.lastInsertRowid);
  await turso.execute({
    sql: `INSERT INTO human_agent_links (human_user_id, agent_id, pairing_key_used, linked_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [HUMAN_USER_ID, agentId, "PHASE3_TEST", now, now, now],
  });
  console.log(`[setup] agent ${username} (id=${agentId}) linked to human ${HUMAN_USER_ID}`);
  return { agentId, username, pk };
}

async function teardown({ agentId }) {
  await turso.execute({ sql: "DELETE FROM human_agent_links WHERE agent_id = ?", args: [agentId] });
  await turso.execute({ sql: "DELETE FROM agents WHERE id = ?", args: [agentId] });
  console.log(`[teardown] agent ${agentId} removed`);
}

async function fetchJson(label, url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  console.log(`  ${label.padEnd(36)} ${r.status} ${typeof body === "object" ? JSON.stringify(body).slice(0, 220) : body}`);
  return { status: r.status, body };
}

async function main() {
  const agent = await setupTestAgent();
  const auth = { Authorization: `Bearer ${agent.pk}`, "Content-Type": "application/json" };

  try {
    console.log("=== /v1/search (offers:read) ===");
    await fetchJson("search electronics", `${BASE}/v1/search`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ query: "arduino", limit: 3 }),
    });

    console.log("=== /v1/quotes (quotes:read) ===");
    await fetchJson("quote arduino mouser", `${BASE}/v1/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        task: "buy 1x arduino uno",
        url: "https://www.mouser.com/ProductDetail/Arduino/A000066",
      }),
    });

    console.log("=== /v1/orders (dry_run, orders:write) ===");
    const orderResp = await fetchJson("dry-run order", `${BASE}/v1/orders`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        dry_run: true,
        task: "buy 1x arduino uno",
        url: "https://www.mouser.com/ProductDetail/Arduino/A000066",
        shipping_address: {
          name: "SDK Test",
          line1: "1 Test St",
          city: "Sunnyvale",
          state: "CA",
          postal_code: "94086",
          country: "US",
        },
      }),
    });

    console.log("=== /v1/files (no auth required by route, but bearer ok) ===");
    await fetchJson("files list (likely 405/400)", `${BASE}/v1/files`, {
      method: "GET",
      headers: auth,
    });

    console.log("=== /v1/connect/sessions (public, no auth) ===");
    await fetchJson("connect session create", `${BASE}/v1/connect/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_name: "Phase 3 Test App",
        return_to: "https://example.com/callback",
        scopes: ["orders:write", "offers:read"],
      }),
    });

    console.log("=== /v1/checkout/sessions (public, no auth) ===");
    await fetchJson("checkout session create", `${BASE}/v1/checkout/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        line_items: [{ task: "1x arduino uno from mouser", url: "https://www.mouser.com/ProductDetail/Arduino/A000066" }],
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      }),
    });

    console.log("=== /v1/connect/token (no auth, requires session id) ===");
    await fetchJson("connect token (no session)", `${BASE}/v1/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "sess_does_not_exist" }),
    });

    console.log("=== Bad bearer rejected ===");
    await fetchJson("orders bad bearer", `${BASE}/v1/orders`, {
      method: "POST",
      headers: { Authorization: "Bearer sk-oa-deadbeef", "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: true, task: "x" }),
    });

  } finally {
    await teardown({ agentId: agent.agentId });
  }
}

main().catch((e) => {
  console.error("[fail]", e);
  process.exit(1);
});
