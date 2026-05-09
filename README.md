# ottoauth

Next.js + Turso service for human-linked AI agent fulfillment, human self-serve browser tasks, and extension/browser fulfillers.

## Browser buy button

For apps with a human-facing checkout button, the intended integration is one
script tag plus one `OttoAuth.buy(...)` call. The app does not need an OttoAuth
private key, a local upload route, a Connect flow, or account logic.

```html
<script src="https://ottoauth.vercel.app/checkout.js"></script>
<button id="buy">Buy</button>
<script>
  buy.onclick = () => OttoAuth.buy({
    task: "Print this T-shirt design on one medium natural cotton tee.",
    max: 2000,
    files: ["#shirtSvg"]
  });
</script>
```

`max` is cents. Use `maxUsd: 20` if the app prefers dollars. OttoAuth owns
sign-in, account creation, checkout confirmation, file upload, and fulfillment
queueing after the click. Optional fields such as `title`, `merchant`, `item`,
`quantity`, `shipping`, `quote`, `details`, and `metadata` only improve the
confirmation page and operator context.

## General order API

Server-side agents and backend integrations should use the canonical order
service:

- `POST /api/services/order/submit` or `POST /v1/orders` to create an order
- `POST /v1/quotes` to get the best non-browser price quote without creating an order
- `GET /v1/orders/<orderId>` to poll status

`/v1/quotes` and order creation use manual price fields, deterministic direct Amazon product-page scraping, configured supplier APIs such as Mouser/eBay, configured local pricing models such as `OTTOAUTH_JLCPCB_PRICE_MODEL_JSON`, then `retroactive_after_fulfillment` when no non-browser source can price the order.

## Current flow

1. An agent creates an OttoAuth account and receives:
   - a secret `privateKey`
   - a human-facing `pairingKey`
2. The human signs in to OttoAuth on the website.
3. The human pastes the `pairingKey` into their dashboard to link the agent.
4. The human generates a short device claim code and enters it in the OttoAuth browser extension.
5. The agent submits browser tasks.
6. OttoAuth fulfills the task on the claimed browser device and debits the human's credits after completion.
7. Humans can also submit their own tasks at `/orders/new` and watch fulfillment live.
8. Claimed devices can be enabled or disabled for browser fulfillment and receive credits after completing other humans' tasks.

## Hosted service availability

- Amazon: active and callable
- Computer Use: active and callable
- Snackpass: coming soon (not callable yet)

## Local dev

```bash
npm install
npm run dev
```

Set `TURSO_DB_URL` and `TURSO_DB_AUTH_TOKEN` for Turso. Without them, the app uses a local SQLite file at `./local.db`.

Optional auth env vars:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OTTOAUTH_ADMIN_EMAILS=you@example.com,ops@example.com` to allow production access to `/admindash` and `/api/admin/*`
- `OTTOAUTH_ENABLE_DEV_HUMAN_LOGIN=1` to enable the local dev human login fallback even in production-like environments
- `OTTOAUTH_ADMIN_SMS_TO=+16095551212` plus `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` to text operators when an order enters an admin-action status
- `OTTOAUTH_MOUSER_SEARCH_API_KEY=...` to enable Mouser Search API price/stock quote lookup when a part number is present
- `OTTOAUTH_EBAY_ACCESS_TOKEN=...` to enable eBay Browse API listing quotes when an item id is present
- `OTTOAUTH_JLCPCB_PRICE_MODEL_JSON={"pcb":{"base_cents":200,"per_board_cents":50,"shipping_cents":800}}` to use a local JLC estimate model when API access is unavailable

## Deploy on Vercel

1. **Push your code** to GitHub (or GitLab/Bitbucket).

2. **Import the project** in [Vercel](https://vercel.com): New Project -> Import your repo. Leave build/dev settings as default (Next.js is auto-detected).

3. **Configure environment variables** in the Vercel project (Settings -> Environment Variables):

   - **Production database (required for production):**
     Create a [Turso](https://turso.tech) database and add:
     - `TURSO_DB_URL` - your database URL (e.g. `libsql://your-db-name.turso.io`)
     - `TURSO_DB_AUTH_TOKEN` - your database auth token

   - **Optional:**
     - `NEXT_PUBLIC_APP_URL` or `APP_URL` - your canonical URL (e.g. `https://your-app.vercel.app`). If unset, Vercel's `VERCEL_URL` is used so curl commands and links still use the correct domain.
     - `OTTOAUTH_ADMIN_EMAILS` - comma-separated Google account emails allowed to use the production admin dashboard and admin APIs.
     - `SLACK_WEBHOOK_URL` - Slack [Incoming Webhook](https://api.slack.com/messaging/webhooks) URL. Agent requests are posted here. Set to different values per environment in Vercel (Production vs Preview) if you want different channels.
     - `OTTOAUTH_ADMIN_SMS_TO`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` - Twilio SMS alerts for orders that need admin/operator action. Use `OTTOAUTH_ADMIN_SMS_STATUSES` to override the default statuses: `human_required`, `quote_requested`, `awaiting_approval`, `blocked`, `failed`, and `disputed`.

4. **Deploy.** Vercel will build and deploy. The app URL will be used automatically for `skill.md` and the homepage curl command.

After deployment, open `https://your-app.vercel.app/skill.md` to confirm the instructions show your production URL.

## Human dashboard

- `/login` is the human sign-in entrypoint
- `/dashboard` shows credits, linked agents, ordering settings, and recent browser tasks
- `/orders/new` lets a human create a browser task directly from the website
- `/orders/<taskId>` shows the live order page with low-rate execution screenshots and run events
- `POST /v1/quotes` returns the non-browser price quote or retroactive-billing fallback for an order payload

New human accounts start with `$20` of starter credits.

## Internal order workers

OttoAuth can run private order workers through [headless-worker](./headless-worker/README.md) for Raspberry Pis or other headless machines. This is operational infrastructure, not part of the app integration contract.

It can:

- pair to OttoAuth as an internal fulfillment worker
- poll OttoAuth for tasks
- process tasks in headless Chrome/Chromium with Anthropic + Playwright
- stream screenshots back to OttoAuth while a task runs
- save Playwright traces plus a compact local transcript for debugging

Fastest setup path on a fresh Raspberry Pi with no repo clone:

```bash
curl -fsSL https://raw.githubusercontent.com/Clamepending/autoauth/main/headless-worker/scripts/install-remote.sh | ANTHROPIC_API_KEY=sk-ant-... bash -s -- --server https://ottoauth.vercel.app --device-id raspberry-pi-worker-1 --label "Raspberry Pi Worker" --internal-worker-token "$OTTOAUTH_INTERNAL_WORKER_PAIRING_TOKEN"
```

If the repo is already present, this also works:

```bash
cd /path/to/autoauth && ANTHROPIC_API_KEY=sk-ant-... ./headless-worker/scripts/bootstrap.sh --server https://ottoauth.vercel.app --device-id raspberry-pi-worker-1 --label "Raspberry Pi Worker" --internal-worker-token "$OTTOAUTH_INTERNAL_WORKER_PAIRING_TOKEN"
```

Trusted internal workers require `OTTOAUTH_INTERNAL_WORKER_PAIRING_TOKEN` on the OttoAuth server and the matching `--internal-worker-token` during pairing. Public device pairing without a human claim code is rejected.

During install, OttoAuth now opens the worker's dedicated persistent browser profile to Snackpass so you can sign in once, then it starts the background service after you close that window. Add `--skip-login` if you want to postpone that step.

For reliable shopping/order execution, write tasks as compact work orders with platform, store name, delivery or pickup method, item, modifiers, tip, delivery address if needed, and spend cap. Snackpass tasks should include the merchant name; OttoAuth uses known store URLs when available and otherwise searches for `"<store>" Snackpass` instead of starting from the generic Snackpass homepage.

## OttoAuth MCP proxy server

This repo now includes a stdio MCP server that:
- discovers OttoAuth service tools from `GET /api/services` + `GET /api/services/<id>`
- refreshes discovered tools every 24 hours
- forwards MCP tool calls to OttoAuth HTTP endpoints and returns the response

### Run

```bash
OTTOAUTH_BASE_URL=http://localhost:3000 npm run mcp:ottoauth
```

If `OTTOAUTH_BASE_URL` is not set, it defaults to `http://localhost:3000`.

### Example MCP client config

```json
{
  "mcpServers": {
    "ottoauth": {
      "command": "npm",
      "args": ["run", "mcp:ottoauth"],
      "env": {
        "OTTOAUTH_BASE_URL": "https://your-ottoauth-domain.com"
      }
    }
  }
}
```
