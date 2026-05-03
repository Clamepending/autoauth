import type { ServiceManifest } from "@/services/_shared/types";
import { getBaseUrl } from "@/lib/base-url";
import {
  getAgentClarificationTimeoutLabel,
  getAgentClarificationTimeoutSeconds,
} from "@/lib/computeruse-agent-clarification-config";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
  const clarificationTimeoutLabel = getAgentClarificationTimeoutLabel();
  const clarificationTimeoutSeconds = getAgentClarificationTimeoutSeconds();
  return {
    id: "computeruse",
    name: "Computer Use",
    description:
      "Submit browser tasks to a human-linked OttoAuth account, let humans self-serve from the website, and settle credits after completion",
    category: "compute",
    status: "active",
    endpoints: [
      {
        name: "submit_task",
        method: "POST",
        path: "/api/services/computeruse/submit-task",
        description:
          "Queue a browser task on the linked human's claimed OttoAuth device. OttoAuth enforces a spend cap and debits credits after completion.",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          task_prompt: {
            type: "string",
            required: true,
            description: "Natural-language task for the browser fulfillment device to complete",
          },
          task_title: {
            type: "string",
            required: false,
            description: "Optional short label for the task",
          },
          website_url: {
            type: "string",
            required: false,
            description: "Optional preferred website URL for the fulfiller to start on",
          },
          shipping_address: {
            type: "string",
            required: false,
            description: "Optional shipping address to use during checkout if the task needs one",
          },
          max_charge_cents: {
            type: "number",
            required: false,
            description:
              "Optional explicit max spend for this task in cents. If omitted, OttoAuth uses the human's current credit balance as the cap.",
          },
        },
      },
      {
        name: "get_task_status",
        method: "POST",
        path: "/api/services/computeruse/tasks/:taskId",
        description: "Check the status, clarification state, billing breakdown, and completion summary for a submitted browser task",
        params: {
          taskId: {
            type: "number",
            required: true,
            description: "The task ID returned by submit_task",
          },
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
        },
      },
      {
        name: "cancel_task",
        method: "POST",
        path: "/api/services/computeruse/tasks/:taskId/cancel",
        description:
          "Cancel an in-flight browser task that this agent submitted. OttoAuth marks the task failed and returns the updated task object.",
        params: {
          taskId: {
            type: "number",
            required: true,
            description: "The task ID returned by submit_task",
          },
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          reason: {
            type: "string",
            required: false,
            description: "Optional cancellation reason to store on the task",
          },
        },
      },
      {
        name: "respond_clarification",
        method: "POST",
        path: "/api/services/computeruse/tasks/:taskId/clarification",
        description:
          "Respond to an OttoAuth clarification request for an agent-submitted browser task. OttoAuth will re-queue the task on the linked browser device.",
        params: {
          taskId: {
            type: "number",
            required: true,
            description: "The task ID that is awaiting clarification",
          },
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          clarification_response: {
            type: "string",
            required: true,
            description: "The agent's clarification answer for OttoAuth to use when resuming the task",
          },
        },
      },
      {
        name: "history",
        method: "POST",
        path: "/api/services/computeruse/history",
        description: "List recent browser tasks submitted by this agent",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
        },
      },
      {
        name: "run_events",
        method: "POST",
        path: "/api/services/computeruse/runs/:runId/events",
        description:
          "Retrieve the execution event history for a browser task run. Use the run_id returned by submit_task or get_task_status.",
        params: {
          runId: {
            type: "string",
            required: true,
            description: "The run_id returned on the task object",
          },
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          limit: {
            type: "number",
            required: false,
            description: "Maximum number of recent events to return. Defaults to 50.",
          },
        },
      },
    ],
    docsMarkdown: `# OttoAuth Computer Use

OttoAuth now supports **human-linked browser tasks**, **human self-serve order pages**, and **marketplace fulfillers**. Your human generates OttoAuth API keys for you in the dashboard, claims a browser device, submits their own tasks from the website, or opts their device into fulfilling tasks for other humans.

## OpenClaw-first summary

If you are an OpenClaw-style agent, the easiest OttoAuth onboarding is:

1. Ask the human to sign in at \`${baseUrl}/login\`.
2. Have the human generate OttoAuth API keys for you in \`${baseUrl}/dashboard\`.
3. Save the dashboard-generated \`username\` and \`privateKey\`.
4. Tell the human to claim or enable a browser device.
5. Submit browser tasks through OttoAuth against the human's credits.
6. Share \`${baseUrl}/orders/<taskId>\` with the human if they want to watch fulfillment live.
7. Tell the human about \`${baseUrl}/orders/new\` if they want to submit their own task directly.

## Agent-readable startup contract

If a developer points you at OttoAuth docs and asks you to start:

1. Read \`${baseUrl}/llms.txt\`.
2. Read \`${baseUrl}/skill.md\`.
3. GET \`${baseUrl}/api/services\` and call only services with \`status = "active"\` or \`status = "beta"\`.
4. GET \`${baseUrl}/api/services/computeruse\` for the current tool JSON.
5. Ask the human for dashboard-generated \`username\` and \`privateKey\`; do not ask for retailer passwords or card numbers.
6. Before submitting checkout work, confirm the human has claimed a browser device and has credits.
7. After submitting, save \`task.id\` and \`run_id\`, share \`${baseUrl}/orders/<taskId>\` if useful, poll status, and inspect run events when status is not enough.

## Human-linked flow

1. Receive dashboard-generated credentials from the human:

\`\`\`bash
export OTTOAUTH_BASE_URL=${baseUrl}
export OTTOAUTH_USERNAME=<dashboard_generated_username>
export OTTOAUTH_PRIVATE_KEY=<dashboard_generated_private_key>
\`\`\`

The human generates these in the dashboard and sends them to you. Keep \`privateKey\` secret.

2. Tell your human:
- sign in at \`${baseUrl}/login\`
- open **Agent API Keys** in the OttoAuth dashboard and generate credentials for you
- generate a **device claim code**
- enter that claim code in either the OttoAuth Chrome extension or the headless worker setup script for their Raspberry Pi/Mac/browser machine
- sign into the sites the fulfiller should reuse, using the same browser profile that the device will run
- optionally enable marketplace fulfillment in the dashboard if they want that device to earn credits by fulfilling other humans' tasks

3. Once the agent is linked and the human has claimed a device, submit tasks:

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/computeruse/submit-task \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"MY_PRIVATE_KEY",
    "task_prompt":"Open Amazon, buy two packs of AA batteries, and ship them to the default address on file.",
    "website_url":"https://www.amazon.com",
    "shipping_address":"Jane Doe\\n123 Main St Apt 4B\\nSan Francisco, CA 94110",
    "max_charge_cents": 2000
  }'
\`\`\`

OttoAuth sends the task to the linked browser device, instructs it not to exceed the spend cap, and then debits the human's credits **after** completion.

If the fulfiller gets genuinely blocked on an agent-submitted task, OttoAuth can send a webhook to an agent-owned account's stored \`callback_url\` with a clarification request. Dashboard-generated keys do not require the human to configure a callback URL. The agent has ${clarificationTimeoutLabel} to answer by returning JSON in the webhook response or by POSTing to the clarification endpoint; otherwise OttoAuth cancels the request.

## Browser task authoring guidance

The browser fulfiller is most reliable when \`task_prompt\` is a structured work order:

\`\`\`text
Platform: Snackpass
Store or merchant name: Little Plearn
Fulfillment method: pickup
Item name: Pad see ew
Order details, modifiers, and preferences: mild spice, no peanuts
Delivery address, if any: Jane Doe, 123 Main St, San Francisco, CA
Additional instructions: ask for clarification if the item is unavailable
\`\`\`

Include the platform, merchant, fulfillment method, item, quantity, modifiers, tip, delivery address, and spend cap whenever those details matter.

For Snackpass tasks, include the store name even when you pass \`website_url: "https://www.snackpass.co/"\`. OttoAuth uses store-level mappings for known merchants and otherwise instructs the fulfiller to search \`"<store>" Snackpass\`, prefer official \`order.snackpass.co\` ordering pages, and avoid the generic homepage, articles, maps, and social pages.

Keep any known-store routing hints at the merchant URL level. Do not encode item-specific hints or prices in onboarding, because item availability and prices change.

Recommended first generic order test after the human has linked you, claimed a device, and added credits:

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/computeruse/submit-task \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"MY_PRIVATE_KEY",
    "task_title":"Snackpass pickup: Pad see ew",
    "website_url":"https://www.snackpass.co/",
    "max_charge_cents": 2000,
    "task_prompt":"Please place this pickup order on Snackpass.\\n\\nPlatform: Snackpass\\nStore or merchant name: Little Plearn\\nFulfillment method: pickup\\nItem name: Pad see ew\\nOrder details, modifiers, and preferences: no peanuts\\nAdditional instructions: only complete the order if total is under the spend cap."
  }'
\`\`\`

Use the active \`computeruse\` service for Snackpass-shaped browser work. Do not call the dedicated \`snackpass\` service yet; it is still \`coming_soon\`.

## Human self-serve flow

Humans can also use OttoAuth directly:

- submit a browser/order task at \`${baseUrl}/orders/new\`
- watch live fulfillment on \`${baseUrl}/orders/<taskId>\`
- use the dashboard at \`${baseUrl}/dashboard\` to link agents, claim devices, and enable marketplace fulfillment

This is useful for debugging and for humans who want to create OttoAuth tasks without routing through an agent first.

## Marketplace fulfillers

If a human claims an OttoAuth browser device and enables marketplace fulfillment:

- OttoAuth may route other humans' self-serve tasks to that device
- the requester's credits are debited after completion
- the fulfiller receives a matching credit payout after the run completes

The current marketplace policy is intentionally simple: OttoAuth picks an available opted-in device that looks online recently.

## Billing model

When the browser task completes, OttoAuth records:
- goods subtotal
- shipping
- tax
- any other task-reported fees
- inference cost from the browser agent's model usage

Those are combined into a single debit from the human's credit ledger.

If the task was fulfilled by another human's marketplace device, OttoAuth also records a payout credit to that fulfiller's ledger.

## Endpoints

### Submit task

\`\`\`
POST ${baseUrl}/api/services/computeruse/submit-task
Content-Type: application/json
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

### Get task status

\`\`\`
POST ${baseUrl}/api/services/computeruse/tasks/:taskId
Content-Type: application/json
\`\`\`

Body:
- \`username\`
- \`private_key\`

Response includes:
- current status
- pickup details / pickup summary when available
- tracking details / tracking summary when available
- clarification question / response if the task is waiting on the agent
- clarification deadline if a reply is still pending
- billing status
- payout status
- final debit amount
- token usage
- summary / error
- \`run_id\` for fetching execution events

Poll this endpoint every 15-60 seconds while the task is \`queued\`, \`running\`, or \`awaiting_agent_clarification\`. Terminal statuses are \`completed\` and \`failed\`.

### Cancel an in-flight task

\`\`\`
POST ${baseUrl}/api/services/computeruse/tasks/:taskId/cancel
Content-Type: application/json
\`\`\`

Body:
- \`username\`
- \`private_key\`
- \`reason\` (optional)

Use this when the human changes their mind, the requested item is no longer wanted, or your agent needs to stop a task before fulfillment completes. OttoAuth marks the task \`failed\` with the provided reason. The browser worker may still finish its current local loop, so treat cancellation as best-effort once work has already reached a device.

### Get run events

\`\`\`
POST ${baseUrl}/api/services/computeruse/runs/:runId/events
Content-Type: application/json
\`\`\`

Body:
- \`username\`
- \`private_key\`
- \`limit\` (optional)

Use this after \`submit_task\` or \`get_task_status\` returns a \`run_id\`. It gives you the chronological execution/event trail for debugging, order progress, messages, and fulfillment handoffs.

### Respond to clarification

\`\`\`
POST ${baseUrl}/api/services/computeruse/tasks/:taskId/clarification
Content-Type: application/json
\`\`\`

Body:
- \`username\`
- \`private_key\`
- \`clarification_response\`

When OttoAuth needs agent clarification, it sends a webhook like:

\`\`\`json
{
  "event": "ottoauth.computeruse.clarification_requested",
  "task_id": 123,
  "run_id": "run_...",
  "status": "awaiting_agent_clarification",
  "clarification": {
    "question": "Which size should I choose?",
    "deadline_at": "2026-04-11T20:10:00.000Z",
    "timeout_seconds": ${clarificationTimeoutSeconds},
    "respond_url": "${baseUrl}/api/services/computeruse/tasks/123/clarification"
  }
}
\`\`\`

The webhook receiver should either:
- return \`200\` JSON with \`{"clarification_response":"..."}\` within ${clarificationTimeoutLabel}, or
- POST \`clarification_response\` to \`respond_url\` within that same ${clarificationTimeoutLabel} window.

If no clarification arrives before the deadline, OttoAuth cancels the task.

### History

\`\`\`
POST ${baseUrl}/api/services/computeruse/history
Content-Type: application/json
\`\`\`

Body:
- \`username\`
- \`private_key\`

## Notes

- If the human has not generated dashboard API keys for the agent yet, task submission will be rejected.
- If the human has not claimed a device yet, task submission will be rejected.
- If the human has no credits remaining, task submission will be rejected.
- Returns, cancellations, product lookup, multi-item orders, variants, and retailer-specific follow-up can be expressed as structured browser tasks today. Dedicated typed endpoints can be added as service manifests as those flows stabilize.
- Humans can create tasks directly from \`${baseUrl}/orders/new\`.
- Humans can watch live low-rate screenshots on \`${baseUrl}/orders/<taskId>\`.
- Humans can opt a claimed device into marketplace fulfillment from \`${baseUrl}/dashboard\`.
- Existing low-level OttoAuth computer-use APIs still exist, but the credit-backed human-linked task flow above is the recommended path.
`,
  };
}
