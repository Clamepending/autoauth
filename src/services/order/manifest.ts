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
          "Create a canonical OttoAuth order. OttoAuth stores a non-browser quote when available, uses a native provider API when enabled, otherwise routes the order to the admindash human fulfillment queue.",
        params: {
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
          store: {
            type: "string",
            required: false,
            description: "Store or platform, such as amazon, treatstock, xometry, jlcpcb, instacart, uber, ubereats, or snackpass. Omit when the app wants OttoAuth to choose the route.",
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
            description: "Optional order kind: retail_purchase, grocery_delivery, restaurant_delivery, ride, manufacturing_3d_print, or manufacturing_pcb.",
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
            description: "Required for real orders; optional for dry_run previews. Maximum spend in cents. Human operators and native adapters cannot complete above this cap without approval.",
          },
          estimated_total_cents: {
            type: "number",
            required: false,
            description: "Optional non-binding estimate from the integrating app. OttoAuth returns it in order.pricing and still enforces max_charge_cents as the hard limit.",
          },
          quote: {
            type: "object",
            required: false,
            description:
              "Optional manual/operator price quote. Supports total_cents, goods_cents, shipping_cents, tax_cents, currency, confidence, source, and source_label.",
          },
          dry_run: {
            type: "boolean",
            required: false,
            description: "When true, validate and preview routing without authentication, credit checks, DB rows, or fulfillment.",
          },
        },
      },
      {
        name: "quote_order",
        method: "POST",
        path: "/v1/quotes",
        description:
          "Return the best non-browser price quote for an order request without creating an order. Uses manual price fields, deterministic direct Amazon product-page scraping, curated McMaster-Carr/DigiKey estimate catalogs, configured supplier APIs, configured JLC pricing models, then retroactive billing fallback.",
        params: {
          Authorization: { type: "string", required: true, description: "Bearer private key." },
          task_prompt: {
            type: "string",
            required: false,
            description: "Freeform work order used to detect supplier context and pricing strategy.",
          },
          store: {
            type: "string",
            required: false,
            description: "Store or platform, such as amazon, digikey, mcmaster, mouser, ebay, jlcpcb, or manual.",
          },
          store_url: {
            type: "string",
            required: false,
            description:
              "Product or merchant URL. Direct Amazon product links are scraped server-side without browser automation.",
          },
          quote: {
            type: "object",
            required: false,
            description:
              "Optional manual/operator quote. Supports total_cents, goods_cents, shipping_cents, tax_cents, currency, confidence, source, and source_label.",
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
          "Return the focused 50-platform coverage catalog used for provider recognition, file-upload support, homepage coverage, and operator routing.",
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

Every order creation also attempts **non-browser price discovery** and stores the result in \`order.quote\` / \`price_quote\`. The resolver tries explicit price fields, direct Amazon product-page scraping, configured supplier APIs such as Mouser and eBay, configured local pricing models such as \`OTTOAUTH_JLCPCB_PRICE_MODEL_JSON\`, then \`retroactive_after_fulfillment\` when no reliable non-browser price is available.

## Deprecated routes

Do not call \`/api/services/computeruse/*\`, \`/api/computeruse/tasks*\`, \`/api/computeruse/runs*\`, \`/api/computeruse/register-device\`, \`/api/pay/amazon/create-session\`, or \`/api/pay/snackpass/create-session\`. These old public browser-task/payment APIs return \`410 Deprecated API\` with \`replacement_path: "/api/services/order/submit"\`.

Worker/device routes under \`/api/computeruse/device/*\` remain internal fulfillment infrastructure. They are for OttoAuth worker devices, not for hosted agent commerce integrations.

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

File download URLs require \`Authorization: Bearer <agent_private_key>\` for the owning agent, or an authenticated OttoAuth admin session.

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
- \`max_charge_cents\` for real orders
- enough structured fields, \`items[]\`, \`files[]\`, or \`task_prompt\` to describe the order

The response contains both \`order.id\` and a compatibility \`task.id\`. New clients should store \`order.id\`, for example \`ord_123\`.

The response also contains \`price_quote\`. If \`price_quote.billing_mode\` is \`retroactive_after_fulfillment\`, show the user that OttoAuth could not price the order upfront and final observed charges will be reconciled after fulfillment under the spend cap.

### Quote without creating an order

\`\`\`bash
curl -s -X POST ${baseUrl}/v1/quotes \\
  -H 'authorization: Bearer sk-oa-...' \\
  -H 'content-type: application/json' \\
  -d '{
    "store":"amazon",
    "url":"https://www.amazon.com/dp/EXAMPLE",
    "task":"Quote this direct Amazon product link."
  }'
\`\`\`

This endpoint never opens a browser and never creates an order. Use it when a frontend wants to show a price, estimate, or retroactive-billing state before the user submits.

## Pricing

OttoAuth returns a non-binding pricing object on dry runs, real order creation, and status reads. Integrations should display the estimate when available and always show the hard spend limit.

\`\`\`json
{
  "pricing": {
    "state": "estimated",
    "display_total_cents": 6200,
    "estimated_total_cents": 6200,
    "estimate_low_cents": 4100,
    "estimate_high_cents": 11400,
    "quoted_total_cents": null,
    "captured_cents": 0,
    "max_charge_cents": 9000,
    "confidence": "low",
    "source": "ottoauth_heuristic",
    "pending_final_price": true,
    "spend_limit": {
      "required": true,
      "provided": true,
      "covers_estimate": true,
      "covers_high_estimate": false,
      "requires_approval_above_limit": true
    }
  }
}
\`\`\`

\`estimated_total_cents\` is for UX only. \`max_charge_cents\` is the hard safety boundary. If the final total is above the cap, a native adapter or admindash operator must stop and request approval. If the integrating app already has a better estimate, pass \`estimated_total_cents\`, optional \`estimate_low_cents\`, optional \`estimate_high_cents\`, and optional \`estimate_confidence\` in the submit body.

## Get-this-made example

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "store":"xometry",
    "kind":"manufacturing_3d_print",
    "files":[{"file_id":"file_...","name":"bracket.step","download_url":"${baseUrl}/api/services/order/files/file_...","purpose":"cad_model"}],
    "order_details":"Manufacture this design from the attached CAD files. Aluminum 6061 if CNC is selected, black nylon or PLA if 3D printed. Quote before ordering if the final total is unclear.",
    "estimated_total_cents":6200,
    "max_charge_cents":50000
  }'
\`\`\`

For 3D printing use \`store: "treatstock"\`, \`"craftcloud"\`, \`"xometry"\`, \`"hubs"\`, or another catalog entry. For PCB use \`"jlcpcb"\`, \`"pcbway"\`, \`"oshpark"\`, \`"seeed_fusion"\`, or another PCB catalog entry.

## Platform catalog

\`GET ${baseUrl}/api/services/order/platforms\` returns the focused 50-platform catalog. OttoAuth recognizes these platforms today and routes unsupported native APIs to admindash human fulfillment:

- retail marketplaces and stores
- food, grocery, delivery, rides, and travel
- 3D printing, CNC, sheet metal, laser cutting, injection molding, and custom parts
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

Do not branch your integration by store. Submit all stores through the same order API, then use the returned provider capabilities, quote, billing mode, and status fields to adapt UX. The point of OttoAuth is that Amazon, Treatstock, PCB manufacturing, grocery delivery, rides, restaurant delivery, and unknown stores all share one lifecycle even when their actual fulfillment path differs.
`,
  };
}
