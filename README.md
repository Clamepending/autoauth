# ottoauth

Next.js + Turso service for human-linked AI agent fulfillment, human self-serve browser tasks, and marketplace-style extension fulfillers.

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
8. Claimed devices can opt into marketplace fulfillment and receive credits after completing other humans' tasks.

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
- `OTTOAUTH_ENABLE_DEV_HUMAN_LOGIN=1` to enable the local dev human login fallback even in production-like environments

## Deploy on Vercel

1. **Push your code** to GitHub (or GitLab/Bitbucket).

2. **Import the project** in [Vercel](https://vercel.com): New Project → Import your repo. Leave build/dev settings as default (Next.js is auto-detected).

3. **Configure environment variables** in the Vercel project (Settings → Environment Variables):

   - **Production database (required for production):**  
     Create a [Turso](https://turso.tech) database and add:
     - `TURSO_DB_URL` — your database URL (e.g. `libsql://your-db-name.turso.io`)
     - `TURSO_DB_AUTH_TOKEN` — your database auth token

   - **Optional:**  
     - `NEXT_PUBLIC_APP_URL` or `APP_URL` — your canonical URL (e.g. `https://your-app.vercel.app`). If unset, Vercel's `VERCEL_URL` is used so curl commands and links still use the correct domain.
     - `SLACK_WEBHOOK_URL` — Slack [Incoming Webhook](https://api.slack.com/messaging/webhooks) URL. Agent requests are posted here. Set to different values per environment in Vercel (Production vs Preview) if you want different channels.

4. **Deploy.** Vercel will build and deploy. The app URL will be used automatically for `skill.md` and the homepage curl command.

After deployment, open `https://your-app.vercel.app/skill.md` to confirm the instructions show your production URL.

## Human dashboard

- `/login` is the human sign-in entrypoint
- `/dashboard` shows credits, linked agents, claimed devices, marketplace toggles, and recent browser tasks
- `/orders/new` lets a human create a browser task directly from the website
- `/orders/<taskId>` shows the live order page with low-rate execution screenshots and run events

New human accounts start with `$20` of starter credits.

## Headless fulfiller

There is now a small CLI OttoAuth fulfiller in [headless-worker](/Users/mark/Desktop/projects/oneclickstack/autoauth/headless-worker/README.md) for Raspberry Pis or other headless devices.

It can:

- pair to a human account with a normal OttoAuth claim code
- poll OttoAuth for tasks
- fulfill tasks in headless Chrome/Chromium with Anthropic + Playwright
- stream screenshots back to OttoAuth while a task runs
- save Playwright traces plus a compact local transcript for debugging

Fastest setup path on a fresh Raspberry Pi with no repo clone:

```bash
curl -fsSL https://raw.githubusercontent.com/Clamepending/autoauth/main/headless-worker/scripts/install-remote.sh | ANTHROPIC_API_KEY=sk-ant-... bash -s -- --server https://ottoauth.vercel.app --device-id raspberry-pi-worker-1 --label "Raspberry Pi Worker" --claim-code XXXX-XXXX-XXXX
```

If the repo is already present, this also works:

```bash
cd /path/to/autoauth && ANTHROPIC_API_KEY=sk-ant-... ./headless-worker/scripts/bootstrap.sh --server https://ottoauth.vercel.app --device-id raspberry-pi-worker-1 --label "Raspberry Pi Worker" --claim-code XXXX-XXXX-XXXX
```

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
