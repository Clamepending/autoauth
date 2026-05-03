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
    id: "order",
    name: "General Order",
    description:
      "Submit, track, cancel, and clarify any human-linked commerce order by specifying the store or platform in one general order API",
    category: "commerce",
    status: "active",
    endpoints: [
      {
        name: "submit_order",
        method: "POST",
        path: "/api/services/order/submit",
        description:
          "Queue an Amazon, Snackpass, retail, food, grocery, return, cancellation, or support order on the linked human's claimed OttoAuth browser device.",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          store: {
            type: "string",
            required: false,
            description:
              "Store or platform to use, such as amazon, snackpass, target, instacart, doordash, or a merchant name.",
          },
          platform: {
            type: "string",
            required: false,
            description: "Alias for store, accepted for agent compatibility.",
          },
          merchant: {
            type: "string",
            required: false,
            description:
              "Specific merchant, restaurant, retailer, or store name when the platform hosts many merchants.",
          },
          store_url: {
            type: "string",
            required: false,
            description:
              "Preferred store, product, menu, order, receipt, return, or tracking URL. Alias: website_url.",
          },
          task_prompt: {
            type: "string",
            required: false,
            description:
              "Freeform work order. Required only when the structured fields do not fully describe the order.",
          },
          task_title: {
            type: "string",
            required: false,
            description: "Optional short label for the order task.",
          },
          order_type: {
            type: "string",
            required: false,
            description:
              "Fulfillment or support type, such as shipping, delivery, pickup, return, cancellation, refund, exchange, or status_check.",
          },
          item_name: {
            type: "string",
            required: false,
            description: "Product, menu item, service, or order target.",
          },
          quantity: {
            type: "string",
            required: false,
            description: "Quantity or count when relevant.",
          },
          order_details: {
            type: "string",
            required: false,
            description:
              "Variants, modifiers, substitutions, account/order numbers, delivery notes, return reasons, or other instructions.",
          },
          shipping_address: {
            type: "string",
            required: false,
            description:
              "Optional shipping or delivery address to use exactly as written if the order needs one.",
          },
          max_charge_cents: {
            type: "number",
            required: false,
            description:
              "Optional explicit max spend in cents. If omitted, OttoAuth uses the human's current credit balance as the cap.",
          },
        },
      },
      {
        name: "get_order_status",
        method: "POST",
        path: "/api/services/order/tasks/:taskId",
        description:
          "Check queued, running, clarification, completed, or failed status plus billing, pickup, tracking, summary, and run ids.",
        params: {
          taskId: {
            type: "number",
            required: true,
            description: "The task ID returned by submit_order.",
          },
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
        },
      },
      {
        name: "cancel_order",
        method: "POST",
        path: "/api/services/order/tasks/:taskId/cancel",
        description:
          "Cancel an in-flight order task submitted by this agent. OttoAuth marks the task failed and returns the updated task object.",
        params: {
          taskId: {
            type: "number",
            required: true,
            description: "The task ID returned by submit_order.",
          },
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          reason: {
            type: "string",
            required: false,
            description: "Optional cancellation reason to store on the task.",
          },
        },
      },
      {
        name: "respond_clarification",
        method: "POST",
        path: "/api/services/order/tasks/:taskId/clarification",
        description:
          "Respond when OttoAuth asks the submitting agent for a missing order detail, then re-queue the task on the linked device.",
        params: {
          taskId: {
            type: "number",
            required: true,
            description: "The task ID that is awaiting clarification.",
          },
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          clarification_response: {
            type: "string",
            required: true,
            description: "The agent's answer for OttoAuth to use when resuming the task.",
          },
        },
      },
      {
        name: "history",
        method: "POST",
        path: "/api/services/order/history",
        description: "List recent order tasks submitted by this agent.",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
        },
      },
      {
        name: "run_events",
        method: "POST",
        path: "/api/services/order/runs/:runId/events",
        description:
          "Retrieve chronological execution events for debugging, order progress, clarification handoffs, and support follow-up.",
        params: {
          runId: {
            type: "string",
            required: true,
            description: "The run_id returned by submit_order or get_order_status.",
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
    docsMarkdown: `# OttoAuth General Order API

OttoAuth exposes one hosted agent service: \`order\`.

Use it for Amazon, Snackpass, restaurants, grocery, retailers, product purchases, pickup, delivery, order-status follow-up, cancellations, returns, refunds, exchanges, and support tasks. There are no public store-specific service endpoints for Amazon or Snackpass. Put the store or platform in the request body instead.

## Agent-readable startup contract

1. Read \`${baseUrl}/llms.txt\`.
2. Read \`${baseUrl}/skill.md\`.
3. GET \`${baseUrl}/api/services\`.
4. GET \`${baseUrl}/api/services/order\` for machine-readable tools.
5. Ask the human for dashboard-generated \`username\` and \`privateKey\`.
6. Confirm the human has claimed or enabled a browser device and has credits.
7. Submit through \`POST ${baseUrl}/api/services/order/submit\`.
8. Save \`task.id\` and \`run_id\`, share \`${baseUrl}/orders/<taskId>\` if useful, poll status, inspect run events, and answer clarification before the deadline.

## Submit any order

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "store":"snackpass",
    "merchant":"Little Plearn",
    "order_type":"pickup",
    "item_name":"Pad see ew",
    "order_details":"mild spice, no peanuts",
    "max_charge_cents": 2000
  }'
\`\`\`

Minimum required body:

- \`username\`
- \`private_key\`
- enough structured order fields or \`task_prompt\` to describe the work

Core optional fields:

- \`store\` or \`platform\`: Amazon, Snackpass, a retailer, a food platform, a grocery platform, or the merchant itself
- \`merchant\`: specific store, restaurant, or retailer name
- \`store_url\` or \`website_url\`: product, menu, order, receipt, return, tracking, or merchant URL
- \`order_type\`: shipping, delivery, pickup, return, cancellation, refund, exchange, support, status_check
- \`item_name\`, \`quantity\`, \`order_details\`
- \`shipping_address\`
- \`max_charge_cents\`
- \`task_prompt\` for freeform detail

## Amazon example

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "store":"amazon",
    "store_url":"https://www.amazon.com/dp/EXAMPLE",
    "item_name":"two packs of AA batteries",
    "order_type":"shipping",
    "shipping_address":"Jane Doe\\n123 Main St Apt 4B\\nSan Francisco, CA 94110",
    "max_charge_cents": 2500,
    "order_details":"Use the default saved payment method. Stop before purchase if the total exceeds the spend cap."
  }'
\`\`\`

## Snackpass example

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "store":"snackpass",
    "merchant":"Little Plearn",
    "order_type":"pickup",
    "item_name":"Pad see ew",
    "quantity":"1",
    "order_details":"mild spice, no peanuts",
    "max_charge_cents": 2000
  }'
\`\`\`

For Snackpass, include the merchant name. OttoAuth then tells the browser fulfiller to find the store-specific Snackpass ordering page and to avoid the generic Snackpass marketing homepage.

## Follow up on order status

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/123 \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-..."
  }'
\`\`\`

Poll every 15-60 seconds while status is \`queued\`, \`running\`, or \`awaiting_agent_clarification\`. Terminal statuses are \`completed\` and \`failed\`.

Status responses can include:

- pickup details and pickup summary
- tracking details and tracking summary
- clarification request, response, and deadline
- billing and payout status
- final debit amount
- token usage
- summary, receipt details, and error
- \`run_id\` for event follow-up

## Cancel an in-flight order

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/123/cancel \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "reason":"The human cancelled this request."
  }'
\`\`\`

Cancellation is best-effort after work has reached a browser device, but OttoAuth immediately marks the hosted task failed.

## Run events

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/runs/run_abc123/events \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "limit": 100
  }'
\`\`\`

Use run events when task status is not enough. They expose the chronological execution trail for debugging, order progress, messages, and fulfillment handoffs.

## Clarification

If the fulfiller gets blocked on an agent-submitted order, OttoAuth can send a webhook to an agent-owned account's stored \`callback_url\`. Dashboard-generated keys do not require the human to configure a callback URL. The agent has ${clarificationTimeoutLabel} to answer by returning JSON from the webhook or by POSTing to the clarification endpoint.

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
    "respond_url": "${baseUrl}/api/services/order/tasks/123/clarification"
  }
}
\`\`\`

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/123/clarification \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "clarification_response":"Choose the medium size."
  }'
\`\`\`

If no clarification arrives before the deadline, OttoAuth cancels the task.

## Browser task reliability

Structured fields are converted into a compact work order for the browser fulfiller:

\`\`\`text
Platform: Snackpass
Store or merchant name: Little Plearn
Fulfillment method: pickup
Item name: Pad see ew
Quantity: 1
Order details, modifiers, and preferences: mild spice, no peanuts
\`\`\`

Include platform, merchant, fulfillment method, item, quantity, variants, modifiers, substitutions, address, and spend cap whenever those details matter.

## Notes

- The human generates API keys in the dashboard and sends the agent \`username\` plus \`privateKey\`.
- The human must claim or enable a browser device before hosted order submission works.
- The human must keep enough credits available for the requested spend cap.
- Store-specific work goes through \`store\`, \`merchant\`, \`store_url\`, and the general order fields on \`/api/services/order/submit\`.
- Lower-level \`/api/computeruse/*\` routes are worker/device infrastructure, not the stable hosted agent API.
- Humans can create tasks directly from \`${baseUrl}/orders/new\` and watch live fulfillment on \`${baseUrl}/orders/<taskId>\`.
`,
  };
}
