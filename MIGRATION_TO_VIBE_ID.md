# Migration: autoauth → vibe-id (auth + credits)

## Goal

Move the source of truth for **identity** and **credit balance** out of autoauth's local database and into vibe-id (`api.accounts.vibe-research.net`), so a user is the same human across every Vibe Research project, and their balance is one global number.

## What stays in autoauth

- Orders (Amazon, Snackpass), order fulfillment, browser tasks
- Stripe **order-payment** flow (user pays Stripe → autoauth ships a hat). This is unrelated to credit balance.
- SDK API keys for agents
- The chrome-extension and headless-worker

## What moves to vibe-id

- Google sign-in (autoauth's `/login` redirects to vibe-id)
- The `human_users` table (becomes a thin link table; vibe-id is the user)
- The `credit_ledger` table (vibe-id owns it)
- Credit refill via Stripe (Stripe webhook handler moves to vibe-id; `/credits/refill` initiates a vibe-id-mediated Checkout session)
- Credit transfers + claims (peer-to-peer credit ops happen via new vibe-id endpoints)

## Architecture after migration

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        api.accounts.vibe-research.net (vibe-id)         │
│  /auth/* — Google sign-in, install tokens                                │
│  /credits — balance read                                                 │
│  /credits/charge — debit (idempotent)                                    │
│  /v1/grant — internal grant (autoauth calls for referrals/bonuses)       │
│  /v1/transfer — internal P2P transfer (one ledger debit + grant atomic)  │
│  /credits/topup — create Stripe Checkout session                         │
│  /webhooks/stripe — credit_refill events grant credits                   │
│                                                                          │
│  D1: users, user_credits_ledger (single source of truth for both)        │
└─────────────────────────────────────────────────────────────────────────┘
                              ▲                            ▲
                              │ /auth/* via browser        │ Stripe POSTs
                              │ /credits/* with bearer     │
                              │                            │
┌─────────────────────────────────────────────────────────────────────────┐
│                  ottoauth.vibe-research.net (autoauth, Next.js)          │
│                                                                          │
│  /login              → 302 to vibe-id /auth/start?project=ottoauth       │
│  /api/auth/vibe-id/  → callback that sets the install-token cookie       │
│  /credits/refill     → calls vibe-id /credits/topup → redirects to Stripe│
│                                                                          │
│  lib/vibe-id-client  → ONE abstraction for everything                    │
│    getCurrentVibeUser(req) → { user, balance } from the cookie + /me     │
│    spendCredits(req, amt, reason, idem)                                  │
│    grantCredits(userId, amt, reason)  // server-side, X-Internal-Key      │
│                                                                          │
│  Local SQLite still holds:                                               │
│    humans (vibe_id_user_id, autoauth-only fields like referral_code)     │
│    orders, tasks, agent_keys, etc.                                       │
│  GONE: human_sessions, credit_ledger, human_credit_transfers, claims     │
└─────────────────────────────────────────────────────────────────────────┘
```

## File-level plan for autoauth

### New (8 files)
- `src/lib/vibe-id-client.ts` — the single abstraction
- `src/app/api/auth/vibe-id/login/route.ts` — kick off vibe-id sign-in
- `src/app/api/auth/vibe-id/callback/route.ts` — receive token, set cookie
- `src/lib/vibe-link-table.ts` — manage humans.vibe_id_user_id linkage
- `migrations/001-link-humans-to-vibe-id.sql` — schema add
- `migrations/002-migrate-balances-to-vibe-id.ts` — one-shot script (dry-runnable)
- `MIGRATION_TO_VIBE_ID.md` — this doc
- `.env.example` — add `VIBE_ID_BASE_URL`, `VIBE_ID_INTERNAL_KEY`

### Refactored — replace local with vibe-id calls (~20 files)
- `src/lib/human-session.ts` — `getCurrentHumanUser` becomes a thin wrapper around vibe-id-client
- `src/lib/human-accounts.ts` — credit ledger functions delegate to vibe-id; local credit_ledger reads removed
- `src/app/login/page.tsx` — single button, one click, off to vibe-id
- `src/app/api/auth/google/callback/route.ts` — DELETE (vibe-id owns OAuth)
- `src/app/api/auth/dev-login/route.ts` — DELETE (vibe-id has DEV_MODE_ENABLED for the same purpose)
- `src/app/api/auth/logout/route.ts` — clear the vibe-id cookie + call vibe-id /auth/signout
- `src/app/credits/refill/page.tsx` + `refill-client.tsx` — call new `/api/credits/refill` which proxies to vibe-id /credits/topup
- `src/app/api/human/credits/create-session/route.ts` — DELETE (Stripe session creation moves to vibe-id)
- `src/app/api/pay/stripe/webhook/route.ts` — handle ONLY order payments (credit_refill events return early; vibe-id's webhook handles those)
- All `getCurrentHumanUser()` callers — unchanged; they get the same shape back, just sourced from vibe-id

### Untouched
- All order/task/fulfillment code
- Chrome extension
- Headless worker
- SDK API key infrastructure (continues to work; agents authenticate with autoauth API keys, autoauth charges vibe-id on their behalf)

## File-level plan for vibe-id

### New (3 endpoints)
- `POST /v1/grant` — internal (X-Internal-Key) grant, called by autoauth for referrals/bonuses
- `POST /v1/transfer` — internal atomic P2P credit transfer
- `POST /credits/topup` — bearer-authed: creates Stripe Checkout session for the calling user
- `POST /webhooks/stripe` — public-with-signature: Stripe credit_refill events grant credits

### Schema additions (additive, non-destructive)
- `users.stripe_customer_id` (TEXT, NULL) — populated lazily on first /credits/topup

## Migration script

`migrations/002-migrate-balances-to-vibe-id.ts`:

1. For each `human_users` row:
   - Look up vibe-id user by `google_sub` (call vibe-id `/v1/users/find-by-google-subject` — new internal endpoint)
   - If not found, create via `/v1/users/upsert-by-google-subject` (also new)
   - Compute `SUM(autoauth.credit_ledger.amount_cents) WHERE human_user_id = ?`
   - Insert one vibe-id ledger entry: `+balance_cents`, reason `"autoauth migration: balance carried over from local ledger"`, idempotency_key `migration-v1-${human_user_id}` (so the script is safe to re-run)
   - UPDATE `humans SET vibe_id_user_id = ?` for the link table

Dry-run mode: print every action it WOULD take without writing.

## Cutover plan

1. **Branch + preview deploy** — `feat/vibe-id-integration` branch, Vercel auto-builds preview. Test sign-in + credits + one Stripe topup against the **production** vibe-id (it's already live; preview hits the same backend). Existing autoauth.vercel.app stays untouched.
2. **Migration dry-run** — run `migrations/002` with `--dry-run`, eyeball the planned writes.
3. **Migration real-run** — same script without `--dry-run`. Idempotency keys make it safe to re-run.
4. **Promote to prod** — merge the branch, Vercel deploys to ottoauth.vibe-research.net. Old `autoauth.vercel.app` URL still works (Vercel projects can have multiple domains).
5. **Watch for a week** — keep the legacy tables in place. Audit by comparing autoauth's old credit_ledger SUM to vibe-id's balance for each user.
6. **Cleanup deploy** — drop `human_sessions`, `credit_ledger`, `human_credit_transfers`, `human_credit_claims` tables. Remove unused imports. Remove `GOOGLE_CLIENT_ID/SECRET` from autoauth env (vibe-id owns OAuth now).

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Wrong charge amount in production | Idempotency keys + an integration test that asserts `vibe-id balance == sum of autoauth ledger entries` before cutover |
| Existing users locked out | The login replacement uses the same Google account; the link table maps existing `humans.id` to vibe-id user_id by Google sub |
| Stripe webhook double-billing | The cutover deploys vibe-id's webhook + the autoauth code change atomically. Stripe webhook URL change happens last, after both deploys are live. |
| Loss of credit transfer history | Keep the old `human_credit_transfers` and `human_credit_claims` tables read-only for audit; new transfers go through vibe-id |
| Stripe customer ID re-creation on first topup | Migration script also pulls each user's existing `stripe_customer_id` from autoauth (if stored) and POSTs it to vibe-id `/v1/users/set-stripe-customer-id` |

## Order of execution

After looking at the actual call sites the scope is split across two PRs to keep
risk bounded. Credits live inside SQL transactions (user signup atomically grants
starter credits, etc.) — porting those to HTTP calls without breaking
transactional invariants is its own focused piece of work. Auth alone is safer
to land first.

**Phase 1 — Auth migration + link table + migration script (this PR):**
1. ✅ Add new endpoints to vibe-id (grant / transfer / topup / stripe webhook +
   internal charge / get-balance / get-ledger / web_callback_url support).
   Deployed to prod.
2. ✅ Create `feat/vibe-id-integration` branch in autoauth.
3. ✅ Add `lib/vibe-id-client.ts` with the full abstraction (auth + credits +
   server-side ops).
4. ✅ Add `/api/auth/vibe-id/login` + `/api/auth/vibe-id/callback` routes.
5. Add `vibe_id_user_id` column to `human_users` + helpers
   (find/upsert/link).
6. Rewrite `human-session.ts` so `getCurrentHumanUser` reads from
   vibe-id `/auth/me` (cookie → bearer), then looks up the local row by
   `vibe_id_user_id`. Old `human_sessions` cookie path stays as fallback
   during the migration window.
7. Replace `/login` page UI: single "Sign in with Vibe Research" button.
8. Replace `/api/auth/logout`: clear vibe-id cookie + call vibe-id
   `/auth/signout`. Old `ottoauth_human_session` cookie also cleared for
   the migration window.
9. Migration script `scripts/migrate-balances-to-vibe-id.ts` (dry-run by
   default). For each `human_users` row: upsert vibe-id user by Google
   sub, set `vibe_id_user_id`, copy `SUM(credit_ledger.amount_cents)` as
   a vibe-id grant.
10. Push branch → Vercel auto-builds preview → verify sign-in + that
    `getCurrentHumanUser` round-trips through vibe-id.

**Phase 2 — Credits cutover (next PR):**
11. Replace `getHumanCreditBalance` to call vibe-id `/v1/users/:id/credits`
    via the abstraction (with local fallback for users not yet linked).
12. Replace `addCreditLedgerEntry` to call vibe-id `/v1/grant` (positive
    amounts) or `/v1/charge` (negative), still writing locally too during
    the bridge window for audit.
13. Replace `listCreditLedgerEntries` to call vibe-id `/v1/users/:id/ledger`.
14. Move credit-refill Stripe handling: autoauth's webhook returns ok-ignored
    for `checkout_kind=credit_refill`; vibe-id's webhook handles those events
    after the user adds vibe-id's webhook URL to their Stripe configuration.
15. Replace `/credits/refill` UI to call vibe-id `/credits/topup` instead of
    autoauth's local Stripe session creator.

**Phase 3 — Cleanup (after a watch window):**
16. Drop unused autoauth tables: `human_sessions`, `credit_ledger`,
    `human_credit_transfers`, `human_credit_claims`.
17. Remove autoauth's Google OAuth env vars + client config.
18. Remove `/api/auth/google/*` and `/api/auth/dev-login` routes.
