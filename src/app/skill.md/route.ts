import { getBaseUrl } from "@/lib/base-url";
import {
  getAgentClarificationTimeoutLabel,
  getAgentClarificationTimeoutSeconds,
} from "@/lib/computeruse-agent-clarification-config";
import { getAllManifests } from "@/services/registry";

function buildSkill(baseUrl: string): string {
  const clarificationTimeoutLabel = getAgentClarificationTimeoutLabel();
  const clarificationTimeoutSeconds = getAgentClarificationTimeoutSeconds();
  const services = getAllManifests();

  const serviceRows = services
    .map((m) => {
      const toolsCell =
        m.endpoints.length > 0
          ? `\`GET ${baseUrl}/api/services/${m.id}\``
          : "N/A";
      const docsCell = m.docsMarkdown
        ? `\`GET ${baseUrl}/api/services/${m.id}/docs\``
        : "N/A";
      return `| ${m.id} | ${m.status} | ${m.description} | ${toolsCell} | ${docsCell} |`;
    })
    .join("\n");

  return `# ottoauth

OttoAuth is now a **service-first broker** between:

1. **an agent identity** that authenticates with \`username\` + \`privateKey\`
2. **a human OttoAuth account** that links that agent, owns credits, and owns claimed devices
3. **one or more OttoAuth-paired browser devices** that actually perform browser work

The public hosted contract you should rely on is:

- agent account endpoints under \`${baseUrl}/api/agents/*\`
- service discovery under \`${baseUrl}/api/services\`
- service execution under \`${baseUrl}/api/services/<id>\`
- task follow-up endpoints returned by those services

Do **not** assume every other route in the repo is part of the stable hosted agent surface. Some lower-level \`/api/computeruse/*\` routes are device-oriented or dev/migration paths. For normal hosted agent integrations, prefer the service-discovery flow below.

This skill is intentionally about **how to use OttoAuth as an agent caller**. It does not document OttoAuth's worker-side fulfillment protocol.

## Current hosted architecture

### 1. Agent account

You create an OttoAuth agent account once. OttoAuth returns:

- \`username\`
- \`privateKey\`
- \`pairingKey\`
- \`callbackUrl\`

\`privateKey\` is your real credential. Keep it secret.

\`pairingKey\` is a one-time human-link code. Share it with the human so they can link your agent inside the OttoAuth dashboard.

\`callbackUrl\` is required because OttoAuth uses it for **computer-use clarification webhooks** when a browser fulfiller gets blocked on an agent-submitted task.

### 2. Human link

Your human must:

1. sign in at \`${baseUrl}/login\`
2. paste your \`pairingKey\` into \`${baseUrl}/dashboard\`
3. generate a short-lived **device claim code**
4. complete OttoAuth's device setup flow with that claim code
5. make sure their OttoAuth account has credits available

Until that is done, the main hosted browser-task API will reject your requests.

### 3. Claimed browser device

The claimed device belongs to the human account, not to you.

- For **agent-submitted browser tasks**, OttoAuth currently routes work to the linked human's default claimed device.
- For **human self-serve tasks**, OttoAuth can use the human's own device first and then fall back to an opted-in marketplace device if needed.
- Marketplace opt-in is mainly relevant for human self-serve tasks, not for your normal agent-submitted browser-task path.

### 4. Service layer

Once the account + human link + claimed device exist, you interact through services:

1. \`GET ${baseUrl}/api/services\`
2. \`GET ${baseUrl}/api/services/<id>\`
3. call endpoints from that service's machine-readable \`tools[]\`
4. optionally read \`GET ${baseUrl}/api/services/<id>/docs\`

Services with \`status = "coming_soon"\` are discoverable but not callable.

## Hosted availability (current)

- **computeruse** (\`active\`): the main hosted browser-task service for human-linked agents
- **amazon** (\`active\`): a separate two-phase Amazon order flow that prices first and then generates a payment link for the human
- **snackpass** (\`coming_soon\`): discoverable only, not callable on this hosted server yet

## Default agent behavior

If you are an OpenClaw-style agent or any general-purpose agent, OttoAuth should usually be used like this:

1. Create your OttoAuth account once and store the returned \`privateKey\` securely.
2. Never share the \`privateKey\`. Share only the \`pairingKey\` with the human.
3. Tell the human to sign in, link you in the dashboard, finish OttoAuth's device setup flow, and keep credits available.
4. For browser automation on the hosted OttoAuth server, prefer \`POST ${baseUrl}/api/services/computeruse/submit-task\`.
5. When OttoAuth returns a task object, use \`task.id\` as the human-facing order/task id and send the human to \`${baseUrl}/orders/<taskId>\` if they want to watch fulfillment live.
6. If the human wants to submit a task directly without routing through you, tell them to use \`${baseUrl}/orders/new\`.
7. Use the Amazon service only when you already have a concrete Amazon product URL and want OttoAuth's price-then-human-payment flow.
8. Do not treat \`${baseUrl}/api/requests\` as a live fulfillment path. It is currently a backlog/request channel, not the main execution contract.

## Browser task authoring guidance

\`computeruse\` works best when tasks read like a compact work order instead of a loose chat message.

Recommended shape:

\`\`\`text
Platform: Snackpass
Store or merchant name: Little Plearn
Fulfillment method: pickup
Item name: Pad see ew
Order details, modifiers, and preferences: mild spice, no peanuts
Delivery address, if any: Jane Doe, 123 Main St, San Francisco, CA
Additional instructions: call or clarify if the requested item is unavailable
\`\`\`

Guidelines:

- Include the platform, store/merchant name, fulfillment method, exact item name, quantity, modifiers, tip, and delivery address when they matter.
- Pass \`website_url\` when you know the intended site. Use a direct merchant/order URL when you have one.
- For Snackpass tasks, include the store name even if \`website_url\` is \`https://www.snackpass.co/\`. OttoAuth keeps stable store-level mappings for known Snackpass merchants and otherwise tells the fulfiller to search \`"<store>" Snackpass\`, prefer official \`order.snackpass.co\` pages, and avoid the generic homepage, articles, maps, and social pages.
- Keep onboarding and store mappings at the merchant level. Do not encode item-specific hints such as a single product name or price into the agent onboarding.

## Quick start

### 1. Create account

\`\`\`bash
curl -s -X POST ${baseUrl}/api/agents/create \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"your_agent_name",
    "description":"optional short description",
    "callback_url":"https://your-agent.example.com/ottoauth/callback"
  }'
\`\`\`

Returns \`username\`, \`privateKey\`, \`pairingKey\`, and \`callbackUrl\`.

Important details:

- \`privateKey\` cannot be recovered later from the public API. Save it immediately.
- \`pairingKey\` is what the human uses in the dashboard. Do not give the human your \`privateKey\`.
- \`callback_url\` must be an absolute \`http://\` or \`https://\` URL that can receive POST requests.
- OttoAuth uses \`callback_url\` for \`ottoauth.computeruse.clarification_requested\` if a browser task needs clarification.

### 2. Human onboarding

Tell your human to do this:

1. open \`${baseUrl}/login\`
2. sign in
3. paste your \`pairingKey\` into \`${baseUrl}/dashboard\`
4. generate a device claim code in the dashboard
5. complete OttoAuth's device setup flow with that claim code
6. make sure the OttoAuth account has credits available at \`${baseUrl}/credits/refill\` if needed

You cannot use the hosted \`computeruse\` service until:

- the agent is linked to a human
- the human has claimed a device
- the human has credits remaining

### 3. Human handoff message you can use

\`\`\`
Please sign in to OttoAuth at ${baseUrl}/login, paste this pairing key into your dashboard, generate a device claim code, and finish OttoAuth's device setup flow. Once your device is claimed and your OttoAuth balance has credits, I can submit browser tasks for you. You can also submit your own task at ${baseUrl}/orders/new and watch any live task at ${baseUrl}/orders/<taskId>.
\`\`\`

### 4. First successful browser order path

This is the shortest correct mental model for a brand-new hosted agent:

1. create your agent account and save \`privateKey\`
2. send the human your \`pairingKey\`
3. wait for the human to finish website onboarding at \`${baseUrl}/login\` and \`${baseUrl}/dashboard\`
4. confirm the human has:
   - linked your agent
   - claimed at least one browser device
   - added enough credits
5. submit a browser task with \`POST ${baseUrl}/api/services/computeruse/submit-task\`
6. save the returned \`task.id\`
7. send the human to \`${baseUrl}/orders/<task.id>\` if they want to watch fulfillment
8. poll \`POST ${baseUrl}/api/services/computeruse/tasks/<task.id>\` until the task leaves \`queued\` / \`running\`
9. if the task becomes \`awaiting_agent_clarification\`, answer through your webhook or \`POST .../clarification\`
10. treat \`completed\` as the successful end state and read pickup / tracking / summary fields from the returned task object

If the submit call fails before step 5, the most likely missing prerequisites are:

- no human link yet
- no claimed device yet
- not enough credits for the requested spend cap

### 5. Production-ready agent loop

For a hosted production agent, the steady-state OttoAuth loop is:

1. \`GET ${baseUrl}/api/services\` once at startup or refresh intervals
2. ensure \`computeruse\` is still \`active\`
3. accept a human request
4. call \`POST ${baseUrl}/api/services/computeruse/submit-task\`
5. expose \`${baseUrl}/orders/<taskId>\` to the human as the live watch URL
6. poll task status until it reaches \`completed\`, \`failed\`, or \`awaiting_agent_clarification\`
7. if clarification is requested, respond before the deadline
8. return the final OttoAuth task summary to the human

## Service discovery flow

### List services

\`\`\`
GET ${baseUrl}/api/services
\`\`\`

Response includes each service's:

- \`id\`
- \`name\`
- \`description\`
- \`category\`
- \`status\`
- \`serviceUrl\`
- \`docsUrl\`
- \`toolCount\`

### Get a service's machine-readable tools

\`\`\`
GET ${baseUrl}/api/services/<id>
\`\`\`

OttoAuth returns:

- service metadata
- a \`tools[]\` array
- each tool's \`name\`
- human-readable \`description\`
- HTTP \`method\`
- \`path\`
- param definitions with \`required\` flags

### Optional service docs

\`\`\`
GET ${baseUrl}/api/services/<id>/docs
\`\`\`

### Service catalog

| Service | Status | What it does | Tools | Docs |
|---------|--------|-------------|------|------|
${serviceRows}

Call only services with \`status = "active"\` or \`status = "beta"\`.

## Main hosted service: computeruse

\`computeruse\` is the primary hosted service for agent-submitted browser work.

What it does:

- authenticates the agent with \`username\` + \`private_key\`
- verifies that the agent is linked to a human
- verifies that the human has a claimed OttoAuth browser device
- verifies that the human has credits available
- wraps the task prompt with OttoAuth safety / spend-cap / clarification instructions
- queues the task on the linked human's claimed device
- records a generic browser task for status, billing, summaries, and clarification state

### Submit task

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/computeruse/submit-task \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"your_agent_name",
    "private_key":"YOUR_PRIVATE_KEY",
    "task_prompt":"Open Amazon, buy two packs of AA batteries, and ship them to the address below.",
    "task_title":"Buy AA batteries",
    "website_url":"https://www.amazon.com",
    "shipping_address":"Jane Doe\\n123 Main St Apt 4B\\nSan Francisco, CA 94110",
    "max_charge_cents": 2500
  }'
\`\`\`

Required:

- \`username\`
- \`private_key\`
- \`task_prompt\`

Optional:

- \`task_title\`
- \`website_url\`
- \`shipping_address\`
- \`max_charge_cents\`

Important semantics:

- If \`max_charge_cents\` is omitted, OttoAuth uses the human's current credit balance as the spend cap.
- If \`max_charge_cents\` is provided and exceeds the human's current credit balance, the request is rejected.
- \`website_url\` and \`shipping_address\` are hints and constraints for the fulfiller, not separate services.
- Agent-submitted tasks do **not** use live human chat as their main clarification channel. They use the webhook flow described below.

Response includes:

- \`ok\`
- \`task\` — the generic browser task object
- \`run_id\`
- \`human_credit_balance\`

Use:

- \`task.id\` as the canonical OttoAuth task/order id
- \`${baseUrl}/orders/<task.id>\` as the human watch page
- \`run_id\` if you also want to correlate the underlying execution run

### Poll task status

\`\`\`
POST ${baseUrl}/api/services/computeruse/tasks/<taskId>
Content-Type: application/json

{
  "username":"your_agent_name",
  "private_key":"YOUR_PRIVATE_KEY"
}
\`\`\`

The response task model includes fields such as:

- \`status\`
- \`billing_status\`
- \`payout_status\`
- \`task_title\`
- \`task_prompt\`
- \`pickup_details\`
- \`tracking_details\`
- \`clarification\`
- \`summary\`
- \`error\`
- \`merchant\`
- \`goods_total\`
- \`shipping_total\`
- \`tax_total\`
- \`other_total\`
- \`inference_total\`
- \`total_debited\`
- \`payout_total\`
- \`net_credits\`
- \`run_id\`
- \`computeruse_task_id\`

Relevant enums:

- \`status\`: \`queued\`, \`running\`, \`awaiting_agent_clarification\`, \`completed\`, \`failed\`
- \`billing_status\`: \`pending\`, \`debited\`, \`completed_no_charge\`, \`not_charged\`
- \`payout_status\`: \`pending\`, \`credited\`, \`self_fulfilled\`, \`not_applicable\`, \`not_charged\`

The payout fields exist because the same task model also powers self-serve and marketplace flows. For tasks completed on the linked human's own device, you may see \`payout_status = "self_fulfilled"\`.

### List recent browser tasks for this agent

\`\`\`
POST ${baseUrl}/api/services/computeruse/history
Content-Type: application/json

{
  "username":"your_agent_name",
  "private_key":"YOUR_PRIVATE_KEY"
}
\`\`\`

## Clarification webhook contract

If the browser fulfiller is blocked on an **agent-submitted** task, OttoAuth may mark the task as \`awaiting_agent_clarification\` and POST a webhook to your stored \`callback_url\`.

Current timeout: ${clarificationTimeoutLabel}

Webhook payload shape:

\`\`\`json
{
  "event": "ottoauth.computeruse.clarification_requested",
  "task_id": 123,
  "run_id": "run_...",
  "computeruse_task_id": "mock_...",
  "agent_username": "your_agent_name",
  "status": "awaiting_agent_clarification",
  "clarification": {
    "question": "Which size should I choose?",
    "requested_at": "2026-04-11T20:00:00.000Z",
    "deadline_at": "2026-04-11T20:10:00.000Z",
    "timeout_seconds": ${clarificationTimeoutSeconds},
    "respond_url": "${baseUrl}/api/services/computeruse/tasks/123/clarification",
    "method": "POST",
    "auth": "Include the agent username and private_key in the JSON body.",
    "body": {
      "username": "your_agent_name",
      "private_key": "YOUR_PRIVATE_KEY",
      "clarification_response": "<your answer for OttoAuth>"
    }
  },
  "task_status_url": "${baseUrl}/api/services/computeruse/tasks/123",
  "order_url": "${baseUrl}/orders/123"
}
\`\`\`

You have two supported ways to answer:

1. return HTTP 2xx from your webhook receiver with JSON:

\`\`\`json
{
  "clarification_response": "Choose the medium size."
}
\`\`\`

2. or POST later to the respond URL:

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/computeruse/tasks/123/clarification \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"your_agent_name",
    "private_key":"YOUR_PRIVATE_KEY",
    "clarification_response":"Choose the medium size."
  }'
\`\`\`

Important behavior:

- If OttoAuth receives a 2xx webhook response with \`clarification_response\`, it can resume immediately.
- If OttoAuth gets a 2xx response without an inline answer, it waits until the clarification deadline for a later POST.
- If the callback URL is missing, unreachable, or returns non-2xx, OttoAuth currently treats the callback as failed and cancels the clarification request.
- If no successful clarification arrives before the deadline, OttoAuth cancels the task.

## Amazon service

\`amazon\` is a different execution model from \`computeruse\`.

It is **not** the same as the human-linked credit-backed browser-task flow.

Current behavior:

1. you already have a concrete Amazon product URL
2. you call \`POST ${baseUrl}/api/services/amazon/buy\`
3. OttoAuth runs a browser task to discover the real Amazon total
4. the order moves to \`pending_payment\`
5. OttoAuth exposes a \`payment_url\`
6. your human opens that payment URL and pays
7. OttoAuth enqueues a second browser task to place the Amazon order
8. you poll the order status endpoint until fulfillment completes

### Important Amazon notes

- \`POST ${baseUrl}/api/services/amazon/search\` exists but currently returns \`NOT_IMPLEMENTED\` / HTTP 501.
- Use another search method, get the concrete product URL, then call \`/api/services/amazon/buy\`.
- Amazon order status is tracked separately from the generic browser-task model.

### Buy

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/amazon/buy \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"your_agent_name",
    "private_key":"YOUR_PRIVATE_KEY",
    "item_url":"https://www.amazon.com/...",
    "shipping_address":"Jane Doe\\n123 Main St\\nSan Francisco, CA 94110"
  }'
\`\`\`

### Poll order status

\`\`\`
GET ${baseUrl}/api/services/amazon/orders/<orderId>
\`\`\`

The order response can include:

- \`status\`
- \`product_title\`
- \`estimated_price\`
- \`estimated_tax\`
- \`processing_fee\`
- \`amazon_total\`
- \`payment_url\` when status is \`pending_payment\`
- \`confirmation_number\`
- \`est_delivery\`
- \`tracking_number\`

### List Amazon history

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/amazon/history \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"your_agent_name",
    "private_key":"YOUR_PRIVATE_KEY"
  }'
\`\`\`

## Lower-level and non-default endpoints

OttoAuth has lower-level device-oriented and fulfillment-oriented routes under \`/api/computeruse/*\`, but they are not part of the main agent integration contract and are intentionally omitted from this skill. For most hosted agents, prefer \`${baseUrl}/api/services/*\`.

\`POST ${baseUrl}/api/requests\` is also not your main execution path. It currently creates a pending request / Slack notification rather than providing a live callable service.

## Human URLs you should know

- Login: \`${baseUrl}/login\`
- Dashboard: \`${baseUrl}/dashboard\`
- Credits refill: \`${baseUrl}/credits/refill\`
- Human self-serve order page: \`${baseUrl}/orders/new\`
- Live order/task page: \`${baseUrl}/orders/<taskId>\`

Use those URLs proactively in your replies so the human knows exactly what OttoAuth step they need to complete next.

## Auth summary

- Most agent-authenticated endpoints use \`username\` + \`private_key\`.
- Some account-management endpoints use the field name \`password\` but still expect your private key value.
- Pairing a human uses \`pairingKey\` on the website, not your \`private_key\`.

## Account maintenance endpoints

- **Update description:** \`POST ${baseUrl}/api/agents/update-description\` with \`username\`, \`password\`, \`description\`
- **Delete account:** \`POST ${baseUrl}/api/agents/delete\` with \`username\`, \`password\`

## Stay up to date

Add \`curl -s ${baseUrl}/skill.md\` to your daily heartbeat so you keep up with service changes, onboarding changes, and new hosted tools.
`;
}

export async function GET() {
  const baseUrl = getBaseUrl();
  return new Response(buildSkill(baseUrl), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
