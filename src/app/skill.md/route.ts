import { getBaseUrl } from "@/lib/base-url";
import { getAllManifests } from "@/services/registry";

function buildSkill(baseUrl: string): string {
  const services = getAllManifests();
  const serviceRows = services
    .map((service) => {
      const toolsCell =
        service.endpoints.length > 0
          ? `\`GET ${baseUrl}/api/services/${service.id}\``
          : "N/A";
      const docsCell = service.docsMarkdown
        ? `\`GET ${baseUrl}/api/services/${service.id}/docs\``
        : "N/A";
      return `| ${service.id} | ${service.status} | ${service.description} | ${toolsCell} | ${docsCell} |`;
    })
    .join("\n");

  return `# ottoauth

OttoAuth is a service-first order broker for agents. Treat it as a canonical order API, not as a direct browser automation API.

The public contract is:

1. A human generates agent credentials in \`${baseUrl}/dashboard\`.
2. The agent submits a normalized commerce order.
3. OttoAuth routes to a native provider API when one is enabled.
4. If no provider API exists, OttoAuth displays the order in admindash for a human operator.
5. The agent uses the same status, message, clarification, cancellation, and dispute endpoints regardless of fulfillment path.

## Start Here

Read these in order:

1. \`${baseUrl}/llms.txt\`
2. \`${baseUrl}/skill.md\`
3. \`${baseUrl}/api/services\`
4. \`${baseUrl}/api/services/order\`
5. \`${baseUrl}/api/services/order/docs\`

## Default Integration

1. Ask the human to sign in at \`${baseUrl}/login\`.
2. Ask the human to generate Agent API Keys in \`${baseUrl}/dashboard\`.
3. Store \`username\` and \`private_key\` securely.
4. Confirm the human has credits, or handle OttoAuth's x402 \`402 Payment Required\` top-up response.
5. Validate order shapes with \`dry_run: true\` before real submission. Dry runs need no credentials and create no rows.
6. Optionally call \`POST ${baseUrl}/v1/quotes\` to show a non-browser price, estimate, or retroactive-billing state before creating the order.
7. Submit orders through \`POST ${baseUrl}/api/services/order/submit\` or \`POST ${baseUrl}/v1/orders\`. Real orders require \`max_charge_cents\`.
8. Store \`order.id\` from the response, for example \`ord_123\`. The compatibility \`task.id\` is numeric.
9. Poll \`POST ${baseUrl}/api/services/order/tasks/<orderId>\` or \`GET ${baseUrl}/v1/orders/<orderId>\`.
10. Use message, clarification, cancel, and dispute endpoints as needed.

## Submit

Validate without creating anything:

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "dry_run":true,
    "store":"amazon",
    "item_name":"two packs of AA batteries",
    "order_details":"Stop if the final total exceeds the cap.",
    "max_charge_cents":2500
  }'
\`\`\`

Submit for real:

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
    "order_details":"Stop if the final total exceeds the cap."
  }'
\`\`\`

Structured fields matter. Prefer \`store\`, \`merchant\`, \`store_url\`, \`kind\`, \`order_type\`, \`items[]\`, \`files[]\`, \`pickup_location\`, \`shipping_address\`, \`order_details\`, \`estimated_total_cents\`, and \`max_charge_cents\` over a vague prompt.

Every order response includes \`order.pricing\`. Display \`pricing.display_total_cents\` when present, label it as an estimate unless \`pricing.state\` is \`quoted\` or \`final\`, and always show \`pricing.max_charge_cents\` as the hard spend limit.

## Non-Browser Quotes

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

Quotes never open a browser and never create an order. OttoAuth tries explicit/manual price fields, direct Amazon product-page scraping, curated McMaster-Carr/DigiKey estimate catalogs, configured supplier APIs such as Mouser/eBay, configured local pricing models such as \`OTTOAUTH_JLCPCB_PRICE_MODEL_JSON\`, then \`retroactive_after_fulfillment\` when no non-browser price source is available. Order creation stores the same result in \`order.quote\` and \`price_quote\`.

## Orders With Files

For 3D printing, PCB, CNC, laser cutting, signs, stickers, apparel, documents, BOMs, and custom goods, upload files first and pass the returned references into the order.

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/files \\
  -F username=my_agent \\
  -F private_key=sk-oa-... \\
  -F purpose=cad_model \\
  -F file=@./bracket.step
\`\`\`

Then submit:

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "store":"xometry",
    "files":[{"file_id":"file_...","name":"bracket.step","download_url":"${baseUrl}/api/services/order/files/file_...","purpose":"cad_model"}],
    "order_details":"Quote CNC aluminum 6061, quantity 5, bead blasted. Ask before ordering.",
    "estimated_total_cents":6200,
    "max_charge_cents":50000
  }'
\`\`\`

JSON/base64 uploads also work through \`POST ${baseUrl}/api/services/order/files\` with \`files[].content_base64\`.

## Platform Catalog

\`GET ${baseUrl}/api/services/order/platforms\` returns the focused 50-platform catalog. It covers the most common web commerce plus get-this-made workflows: retail marketplaces, grocery/food/rides/travel, 3D printing, CNC, sheet metal, PCB/PCBA, electronics BOM buying, laser cutting, signs, stickers, apparel, and print-on-demand.

## Statuses

- \`quote_requested\`: quote-first provider flow has started.
- \`awaiting_approval\`: a quote or exception needs approval.
- \`human_required\`: no native adapter is enabled, so admindash operator work is required.
- \`human_claimed\`: an operator has claimed the order.
- \`blocked\`: OttoAuth needs clarification.
- \`completed\`: order closed successfully.
- \`failed\`: order could not be completed.
- \`canceled\`: order was canceled.
- \`disputed\`: a dispute/refund/support case is open.

Every order response includes \`order.provider.capabilities\` with flags for quote, place_order, cancel, status_tracking, live_tracking, messaging, clarification, dispute, file_upload, proof_of_completion, and refund.

## Messaging

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/messages \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "channel":"provider_vendor",
    "message":"Please use almond milk if oat milk is unavailable."
  }'
\`\`\`

If no native messaging API exists, OttoAuth records the message with \`needs_human_delivery\` so an admindash operator can send it manually.

## Clarification

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/clarification \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "clarification_response":"Use black PLA if nylon is unavailable."
  }'
\`\`\`

## Cancel

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/cancel \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "reason":"Requester canceled."
  }'
\`\`\`

## Dispute

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/disputes \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "reason":"Wrong item delivered",
    "requested_resolution":"refund"
  }'
\`\`\`

## Provider Posture

Do not assume every store has a real API. OttoAuth currently treats provider coverage this way:

- Amazon: human fallback.
- Treatstock: human fallback until the quote-first adapter is wired.
- JLCPCB: human fallback until the quote-first PCB/manufacturing adapter is wired.
- Mouser: human fallback until the quote/order adapter is wired.
- Instacart, Uber, Uber Eats, Snackpass, and unknown stores: human fallback.

The client rule is simple: submit all stores through the same order API, then adapt to the returned provider capabilities and order status.

## Admin Fallback

Orders without an enabled native adapter appear in \`${baseUrl}/admindash\` under Human fulfillment queue. Operators use \`${baseUrl}/admindash/fulfillment/<orderId>\` to inspect the normalized request, items, files, spend cap, checklist, messages, events, and final receipt fields. Manual completion enforces \`max_charge_cents\` and debits credits only once.

If \`OTTOAUTH_ADMIN_SMS_TO\` and Twilio credentials are configured, OttoAuth also texts the operator when real orders enter admin-action statuses such as \`human_required\`, \`quote_requested\`, \`awaiting_approval\`, \`blocked\`, \`failed\`, or \`disputed\`.

## Hard Rules

- Never ask the human for retailer passwords, raw card numbers, CVVs, bank details, or one-time codes.
- Never exceed \`max_charge_cents\`.
- Do not use lower-level device or worker routes for normal integrations.
- Do not branch your integration by store-specific OttoAuth endpoints. Store specificity belongs in order fields.

## Services

| id | status | description | tools | docs |
|---|---|---|---|---|
${serviceRows}
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
