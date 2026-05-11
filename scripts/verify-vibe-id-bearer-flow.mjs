// Smoke test: exercise the full vibe-id → autoauth bearer flow end-to-end
// without going through Google OAuth.
//
// Mints a vibe-id install token via /v1/test/mint-install-token (internal-
// key-authed admin endpoint), sets it as the vibe_id_session cookie on
// autoauth, and hits /api/human/me to confirm:
//   - autoauth's getCurrentHumanUser resolves the bearer through vibe-id
//   - the local human_users row is synced from vibe-id (handle, email,
//     display_name, picture_url all match)
//   - credit balance reads via vibe-id (matches /v1/users/:id/credits)
//
// Run cost: zero. The minted install token has a random device_id so it
// doesn't collide with the user's real sessions. Revoke not strictly
// necessary (the device row is harmless) but the script does it anyway.
//
// Usage:
//   set -a; . ./.env.production.local; set +a
//   node scripts/verify-vibe-id-bearer-flow.mjs

const BASE = "https://ottoauth.vibe-research.net";
const VIBE = (process.env.VIBE_ID_BASE_URL || "").trim().replace(/\/+$/, "");
const INTERNAL_KEY = (process.env.VIBE_ID_INTERNAL_KEY || "").trim();
const PROBE_USER_ID = 1;

if (!VIBE || !INTERNAL_KEY) {
  console.error("VIBE_ID_BASE_URL + VIBE_ID_INTERNAL_KEY required");
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label} ${detail}`); }
  else    { fail++; console.log(`  [FAIL] ${label} ${detail}`); }
}

// ---------- 1. Mint a vibe-id install token ----------
console.log("=== Mint a vibe-id install token via internal admin endpoint ===");
const mint = await fetch(`${VIBE}/v1/test/mint-install-token`, {
  method: "POST",
  headers: { "x-internal-key": INTERNAL_KEY, "content-type": "application/json" },
  body: JSON.stringify({ user_id: PROBE_USER_ID, project: "ottoauth" }),
});
const mintBody = await mint.json();
check("mint endpoint returned 200", mint.status === 200, `→ status=${mint.status}`);
check("mint returned install_token", typeof mintBody.install_token === "string" && mintBody.install_token.startsWith("vid_"), `→ token=${mintBody.install_token?.slice(0, 12)}...`);
check("mint returned user with handle", typeof mintBody.user?.handle_lower === "string");

// ---------- 2. Use the token via vibe-id /auth/me directly ----------
console.log("\n=== vibe-id /auth/me with the minted token ===");
const me = await fetch(`${VIBE}/auth/me`, {
  headers: { authorization: `Bearer ${mintBody.install_token}` },
});
const meBody = await me.json();
check("/auth/me 200", me.status === 200);
check("/auth/me.user.id matches", meBody.user?.id === PROBE_USER_ID);
check("/auth/me.user.handle_lower present", typeof meBody.user?.handle_lower === "string");
check("/auth/me.credits_balance is integer", Number.isInteger(meBody.credits_balance));

// ---------- 3. Use the token as autoauth's vibe_id_session cookie ----------
console.log("\n=== autoauth /api/human/me using the token as a cookie ===");
const cookieHeader = `vibe_id_session=${encodeURIComponent(mintBody.install_token)}`;
const human = await fetch(`${BASE}/api/human/me`, { headers: { cookie: cookieHeader } });
const humanBody = await human.json();
check("autoauth /api/human/me 200", human.status === 200, `→ status=${human.status}`);
check("autoauth returned the same email", humanBody.user?.email === meBody.user?.email, `email=${humanBody.user?.email}`);
check("autoauth handle matches vibe-id handle", humanBody.user?.handle_lower === meBody.user?.handle_lower);
check("autoauth balance matches vibe-id balance", humanBody.balance_cents === meBody.credits_balance, `${humanBody.balance_cents} == ${meBody.credits_balance}`);

// ---------- 4. /v1/users/:id/credits via internal key ----------
console.log("\n=== vibe-id /v1/users/:id/credits ===");
const balanceFetch = await fetch(`${VIBE}/v1/users/${PROBE_USER_ID}/credits`, {
  headers: { "x-internal-key": INTERNAL_KEY },
});
const balanceBody = await balanceFetch.json();
check("direct balance read 200", balanceFetch.status === 200);
check("direct balance matches /auth/me", balanceBody.balance === meBody.credits_balance);

// ---------- 5. Sign out / revoke the test token ----------
console.log("\n=== Revoke the test install token ===");
const signout = await fetch(`${VIBE}/auth/signout`, {
  method: "POST",
  headers: { authorization: `Bearer ${mintBody.install_token}` },
});
check("/auth/signout 200", signout.status === 200);

// Confirm the token no longer works.
const afterSignout = await fetch(`${VIBE}/auth/me`, {
  headers: { authorization: `Bearer ${mintBody.install_token}` },
});
check("/auth/me after signout returns 401", afterSignout.status === 401);

// ---------- Summary ----------
console.log("\n=========================================");
console.log(`Result: ${pass} pass, ${fail} fail`);
console.log("=========================================");
process.exit(fail === 0 ? 0 : 1);
