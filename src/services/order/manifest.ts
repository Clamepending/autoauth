import { getBaseUrl } from "@/lib/base-url";
import type { ServiceManifest } from "@/services/_shared/types";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();

  return {
    id: "order",
    name: "General Order",
    description:
      "Submit, track, message, clarify, cancel, and dispute commerce orders through one provider-capability router with human admin fallback",
    category: "commerce",
    status: "active",
    endpoints: [
      {
        name: "submit_order",
        method: "POST",
        path: "/api/services/order/submit",
        description:
          "Create a canonical OttoAuth order. OttoAuth uses a native provider API when enabled, otherwise it routes the order to the admindash human fulfillment queue.",
        params: {
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
          store: {
            type: "string",
            required: false,
            description: "Store or platform, such as amazon, treatstock, jlcpcb, instacart, uber, ubereats, snackpass, or manual.",
          },
          platform: {
            type: "string",
            required: false,
            description: "Alias for store.",
          },
          merchant: {
            type: "string",
            required: false,
            description: "Specific merchant, restaurant, retailer, manufacturer, or store name.",
          },
          store_url: {
            type: "string",
            required: false,
            description: "Product, menu, quote, order, receipt, tracking, return, or merchant URL.",
          },
          kind: {
            type: "string",
            required: false,
            description: "Optional order kind: retail_purchase, grocery_delivery, restaurant_delivery, ride, manufacturing_3d_print, manufacturing_pcb, or custom_human_task.",
          },
          task_prompt: {
            type: "string",
            required: false,
            description: "Freeform work order. Required only when structured fields do not fully describe the order.",
          },
          items: {
            type: "array",
            required: false,
            description: "Structured item rows with name, quantity, details, and url.",
          },
          files: {
            type: "array",
            required: false,
            description: "Structured file references for CAD, PCB, or quote-first manufacturing orders.",
          },
          order_type: {
            type: "string",
            required: false,
            description: "shipping, delivery, pickup, quote, order, return, cancellation, refund, exchange, support, status_check, or dispute.",
          },
          pickup_location: {
            type: "string",
            required: false,
            description: "Pickup, destination, or search location.",
          },
          shipping_address: {
            type: "string",
            required: false,
            description: "Shipping or delivery address to use exactly as written.",
          },
          item_name: {
            type: "string",
            required: false,
            description: "Single item shorthand when items[] is not used.",
          },
          quantity: {
            type: "string",
            required: false,
            description: "Single item quantity shorthand.",
          },
          order_details: {
            type: "string",
            required: false,
            description: "Variants, modifiers, substitutions, quote requirements, account/order numbers, or other instructions.",
          },
          max_charge_cents: {
            type: "number",
            required: false,
            description: "Maximum spend in cents. Human operators cannot close a completed order above this cap.",
          },
          dry_run: {
            type: "boolean",
            required: false,
            description: "When true, validate and preview routing without authentication, credit checks, DB rows, or fulfillment.",
          },
        },
      },
      {
        name: "upload_order_files",
        method: "POST",
        path: "/api/services/order/files",
        description:
          "Upload CAD, Gerber, BOM, artwork, document, or personalization files before creating an order. Returns file references to pass in submit_order.files[].",
        params: {
          username: { type: "string", required: true, description: "Agent username for JSON uploads or multipart forms." },
          private_key: { type: "string", required: true, description: "Agent private key for JSON uploads or multipart forms." },
          file: { type: "file", required: false, description: "Multipart file field. Repeat file/files for multiple uploads." },
          files: { type: "array", required: false, description: "JSON files with filename, content_type, content_base64, purpose, and optional metadata." },
          purpose: { type: "string", required: false, description: "cad_model, gerber_zip, bom, cpl, artwork, proof, document, or order_attachment." },
        },
      },
      {
        name: "platform_catalog",
        method: "GET",
        path: "/api/services/order/platforms",
        description:
          "Return the 100-platform 80/20 coverage catalog used for provider recognition, file-upload support, homepage coverage, and operator routing.",
        params: {},
      },
      {
        name: "get_order_status",
        method: "POST",
        path: "/api/services/order/tasks/:taskId",
        description:
          "Return normalized order state, provider capabilities, payment fields, messages, and event timeline.",
        params: {
          taskId: { type: "string", required: true, description: "Order id returned by submit_order, such as ord_123." },
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
        },
      },
      {
        name: "history",
        method: "POST",
        path: "/api/services/order/history",
        description: "List recent canonical orders submitted by this agent.",
        params: {
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
        },
      },
      {
        name: "cancel_order",
        method: "POST",
        path: "/api/services/order/tasks/:taskId/cancel",
        description:
          "Cancel an order that has not completed. Native providers are handled by an adapter when available; otherwise the human queue sees the cancellation state.",
        params: {
          taskId: { type: "string", required: true, description: "Order id returned by submit_order." },
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
          reason: { type: "string", required: false, description: "Cancellation reason." },
        },
      },
      {
        name: "send_order_message",
        method: "POST",
        path: "/api/services/order/tasks/:taskId/messages",
        description:
          "Record an agent message for requester, operator, vendor, shopper, driver, or provider follow-up. If no native messaging API exists, the message is flagged for human delivery.",
        params: {
          taskId: { type: "string", required: true, description: "Order id returned by submit_order." },
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
          channel: { type: "string", required: false, description: "provider_vendor, requester, human_operator, driver, shopper, or support." },
          message: { type: "string", required: true, description: "Message body." },
        },
      },
      {
        name: "respond_clarification",
        method: "POST",
        path: "/api/services/order/tasks/:taskId/clarification",
        description:
          "Answer an open operator/provider clarification so the order can resume from blocked to human_required or ready_to_fulfill.",
        params: {
          taskId: { type: "string", required: true, description: "Order id that is awaiting clarification." },
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
          clarification_id: { type: "number", required: false, description: "Specific clarification id; defaults to the newest open clarification." },
          clarification_response: { type: "string", required: true, description: "Answer to the clarification question." },
        },
      },
      {
        name: "open_dispute",
        method: "POST",
        path: "/api/services/order/tasks/:taskId/disputes",
        description:
          "Open a dispute/refund/support case against a completed or problematic order. Native dispute APIs can be added per provider; otherwise admindash exposes it to an operator.",
        params: {
          taskId: { type: "string", required: true, description: "Order id." },
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
          reason: { type: "string", required: true, description: "Dispute reason." },
          requested_resolution: { type: "string", required: false, description: "Refund, replacement, cancellation, status correction, or other desired resolution." },
          evidence: { type: "object", required: false, description: "Optional structured evidence payload." },
        },
      },
      {
        name: "v1_orders",
        method: "POST",
        path: "/v1/orders",
        description:
          "Resource-oriented v1 alias for submit_order. Also supports GET with Authorization: Bearer <private_key> to list recent orders.",
        params: {
          Authorization: { type: "string", required: false, description: "Bearer private key. Body username/private_key still works for POST." },
        },
      },
    ],
    docsMarkdown: `# OttoAuth General Order API

OttoAuth's public commerce API is no longer a browser-task API. It is a canonical order API with a provider-capability router.

The contract is:

1. The agent submits one normalized order request.
2. OttoAuth identifies the provider and order kind.
3. If a native or quote-first provider API is enabled, OttoAuth routes to that adapter.
4. If OttoAuth does not have that provider API yet, the order is displayed in admindash for a human operator.
5. The agent keeps using the same status, message, clarification, cancellation, and dispute endpoints either way.

## Current provider posture

Native API adapters are intentionally explicit. OttoAuth should not pretend that every store has a real public API.

- Amazon: human fulfillment fallback today; status/cancel/dispute/refund fields are tracked in OttoAuth.
- Treatstock: human fallback until the quote-first adapter is wired.
- JLCPCB: human fallback until the quote-first PCB/manufacturing adapter is wired.
- Mouser: human fallback until the quote/order adapter is wired.
- Instacart, Uber, Uber Eats, Snackpass, and unknown stores: human fallback today with first-class status, message, clarification, and dispute records.

Every order response includes \`order.provider.capabilities\` so clients can see whether OttoAuth believes quote, place_order, cancel, status_tracking, live_tracking, messaging, clarification, dispute, file_upload, proof_of_completion, and refund are supported for that provider.

## Submit an order

The whole integration is two calls when files are needed, one call when they are not.

### 1. Upload files when needed

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/files \\
  -F username=my_agent \\
  -F private_key=sk-oa-... \\
  -F purpose=cad_model \\
  -F file=@./bracket.step
\`\`\`

Take the returned \`files[]\` and pass it directly into the order request. JSON/base64 uploads also work:

\`\`\`json
{
  "username": "my_agent",
  "private_key": "sk-oa-...",
  "files": [
    {
      "filename": "front-panel.dxf",
      "content_type": "application/dxf",
      "content_base64": "BASE64_BYTES",
      "purpose": "laser_cut_file"
    }
  ]
}
\`\`\`

### 2. Create the order

Set \`dry_run: true\` first to validate the exact same normalized request without creating an order, charging credits, or queueing human fulfillment.

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "dry_run":true,
    "store":"amazon",
    "item_name":"two packs of AA batteries",
    "order_details":"Use the default saved checkout path. Stop if the total exceeds the cap.",
    "max_charge_cents":2500
  }'
\`\`\`

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
    "max_charge_cents":2500,
    "order_details":"Use the default saved checkout path. Stop if the total exceeds the cap."
  }'
\`\`\`

Minimum required body:

- \`username\`
- \`private_key\`
- enough structured fields, \`items[]\`, \`files[]\`, or \`task_prompt\` to describe the order

The response contains both \`order.id\` and a compatibility \`task.id\`. New clients should store \`order.id\`, for example \`ord_123\`.

## Get-this-made example

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "store":"xometry",
    "kind":"custom_human_task",
    "files":[{"file_id":"file_...","name":"bracket.step","download_url":"${baseUrl}/api/services/order/files/file_...","purpose":"cad_model"}],
    "order_details":"Quote CNC aluminum 6061, quantity 5, bead blasted, quote before ordering.",
    "max_charge_cents":50000
  }'
\`\`\`

For 3D printing use \`store: "treatstock"\`, \`"craftcloud"\`, \`"xometry"\`, \`"hubs"\`, or another catalog entry. For PCB use \`"jlcpcb"\`, \`"pcbway"\`, \`"oshpark"\`, \`"seeed_fusion"\`, or another PCB catalog entry.

## Platform catalog

\`GET ${baseUrl}/api/services/order/platforms\` returns the 100-platform 80/20 catalog. OttoAuth recognizes these platforms today and routes unsupported native APIs to admindash human fulfillment:

- retail marketplaces and stores
- food, grocery, delivery, rides, and travel
- 3D printing, CNC, sheet metal, laser cutting, injection molding, and front panels
- PCB fabrication, PCBA, electronics components, BOM procurement, and industrial supply
- print-on-demand, signs, stickers, business cards, and custom apparel

## Resource-oriented v1 alias

\`\`\`bash
curl -s -X POST ${baseUrl}/v1/orders \\
  -H 'authorization: Bearer sk-oa-...' \\
  -H 'content-type: application/json' \\
  -d '{
    "store":"treatstock",
    "kind":"manufacturing_3d_print",
    "files":[{"name":"bracket.stl","url":"https://example.com/bracket.stl"}],
    "order_details":"black nylon, quantity 4, quote before ordering",
    "max_charge_cents":12000
  }'
\`\`\`

Use \`GET ${baseUrl}/v1/orders/<orderId>\` with \`Authorization: Bearer <private_key>\` for status when you do not want to send credentials in the body.

## Status

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123 \\
  -H 'content-type: application/json' \\
  -d '{"username":"my_agent","private_key":"sk-oa-..."}'
\`\`\`

Core statuses:

- \`quote_requested\`: a quote-first API adapter or operator needs pricing before purchase.
- \`awaiting_approval\`: a quote or exception needs agent/requester approval.
- \`human_required\`: no native adapter is available; admindash operator action is required.
- \`human_claimed\`: an operator has claimed the order.
- \`blocked\`: OttoAuth needs clarification.
- \`completed\`, \`failed\`, \`canceled\`, \`disputed\`: terminal or exception states.

## Messaging

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/messages \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "channel":"provider_vendor",
    "message":"Please ask the shopper to replace unavailable oat milk with almond milk."
  }'
\`\`\`

If the provider has native messaging enabled, the adapter can deliver it. Otherwise the message is recorded with \`status: "needs_human_delivery"\` for admindash.

## Clarifications

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/clarification \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "clarification_response":"Use black PLA if nylon is unavailable, but keep the same tolerance."
  }'
\`\`\`

Operators use clarifications when provider forms, quotes, substitutions, delivery constraints, or manufacturing files are ambiguous. Answering the clarification returns the order from \`blocked\` to the appropriate fulfillment queue.

## Cancel

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/cancel \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "reason":"Requester no longer needs this."
  }'
\`\`\`

## Disputes

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/disputes \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "reason":"Wrong item delivered",
    "requested_resolution":"refund",
    "evidence":{"photo_url":"https://example.com/photo.jpg"}
  }'
\`\`\`

## Admin fulfillment

Orders without an enabled provider API appear in \`${baseUrl}/admindash\` under Human fulfillment queue. Each row links to \`${baseUrl}/admindash/fulfillment/<orderId>\`, where an operator can:

- claim the order
- inspect normalized request fields, files, items, cap, checklist, risk notes, messages, and events
- place the order manually in the provider's normal UI or admin portal
- paste receipt, order number, pickup code, tracking, ETA, provider status, and final charge breakdown
- mark the order completed or failed

Manual completion enforces \`max_charge_cents\` before closing and debits the requester credit ledger only once.

## Client rule

Do not branch your integration by store. Submit all stores through the same order API, then use the returned provider capabilities and status fields to adapt UX. The point of OttoAuth is that Amazon, Treatstock, PCB manufacturing, grocery delivery, rides, restaurant delivery, and unknown stores all share one lifecycle even when their actual fulfillment path differs.
`,
  };
}
