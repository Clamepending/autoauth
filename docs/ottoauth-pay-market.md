# OttoAuth Pay Market

OttoAuth Pay is the agent-service marketplace layer for OttoAuth. V1 lets agent providers publish paid HTTP endpoints, lets buyers discover those services through a simple Market search, and settles internal calls through the fee-free OttoAuth credit ledger.

## Product Surface

- `/market` lists public, enabled services with text search across name, capability, description, provider agent, tags, and endpoint URL.
- `/market/new` lets a signed-in provider publish a bring-your-own-endpoint service.
- `/market/services/:serviceId` shows endpoint, schemas, examples, pricing, refund policy, rails, and an agent-call example.
- `/market/services/:serviceId/edit` lets the owning provider edit or disable a service.

## Rails

V1 supports `ottoauth_ledger` as the default live settlement rail. The buyer's OttoAuth credits are held before the provider endpoint is invoked, then released to the provider on success or refunded on failure.

The `x402_usdc` rail is represented in the catalog model, but it is intentionally fail-closed until OttoAuth has wallet custody, signing policy, and facilitator configuration. Current x402 V2 uses `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` headers around HTTP 402 responses, with facilitators handling payment verification and settlement. See https://docs.x402.org/core-concepts/http-402 and https://docs.x402.org/core-concepts/facilitator.

## API Auth

Humans can call protected APIs with their normal OttoAuth session. Linked agents should call protected APIs with:

```http
Authorization: Bearer <agent_private_key>
```

For local prototyping only, `X-OttoAuth-Human-User-Id` is accepted outside production, or when `OTTOAUTH_ENABLE_MARKET_HEADER_AUTH=1` is set.

## Catalog APIs

### Search services

```http
GET /api/market/services?query=summarize&limit=10
```

Returns public, enabled services by default.

### Get service

```http
GET /api/market/services/:serviceId
```

Returns the service catalog record.

### Publish service

```http
POST /api/market/services
Content-Type: application/json

{
  "name": "Document summarizer",
  "capability": "summarize_document",
  "description": "Summarizes long text into concise bullets.",
  "endpoint_url": "https://provider.example/api/summarize",
  "price_cents": 1,
  "input_schema": { "type": "object" },
  "output_schema": { "type": "object" },
  "examples": [],
  "tags": ["summarization", "documents"],
  "visibility": "public",
  "supported_rails": ["ottoauth_ledger"]
}
```

### Edit or disable service

```http
PATCH /api/market/services/:serviceId
Content-Type: application/json

{
  "price_cents": 2,
  "status": "disabled"
}
```

Only the owning human/provider can update a service.

### Call service

```http
POST /api/market/services/:serviceId/call
Content-Type: application/json

{
  "input": { "text": "..." },
  "max_price_cents": 2,
  "reason": "Summarize source material for a task",
  "task_id": "task_123",
  "idempotency_key": "task_123:summarize:v1"
}
```

Every call requires `max_price_cents` and `idempotency_key`. OttoAuth rejects calls when the live price exceeds the caller's max spend, the service is disabled, the buyer lacks credit, or the buyer is also the provider.

## Agent Tool Endpoint

Agents can call `/api/market/tools` with one of these tools:

```json
{
  "tool": "ottoauth_search_market",
  "arguments": { "query": "summarize", "limit": 5 }
}
```

```json
{
  "tool": "ottoauth_use_service",
  "arguments": {
    "service_id": 1,
    "input": {},
    "max_price_cents": 1,
    "reason": "Need this capability for task_123",
    "task_id": "task_123",
    "idempotency_key": "task_123:service_1"
  }
}
```

```json
{
  "tool": "ottoauth_get_payment_status",
  "arguments": { "call_id": "<market_service_call_id>" }
}
```

Payment status is only returned to the buyer or provider on that call.

## Provider Middleware

Providers can use the lightweight helper in `src/lib/ottoauth-pay.ts`:

```ts
import { ottoauthPay } from "@/lib/ottoauth-pay";

const protect = ottoauthPay.protect({
  serviceId: 1,
  price: "$0.01",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
});

export async function POST(request: Request) {
  return protect(request, async ({ serviceId, callId }) => {
    const body = await request.json();
    return Response.json({ serviceId, callId, result: body.input });
  });
}
```

The helper verifies OttoAuth's service/call headers. It is intentionally simple for V1; receipt signature verification and external x402 payment verification should be added before exposing third-party untrusted provider traffic.

## Receipt Model

Successful calls store a receipt with buyer, provider, service, endpoint origin, rail, amount, status, task id, and an optional HMAC signature when `OTTOAUTH_RECEIPT_SECRET` is configured.

## Safety Rules Implemented

- Public search hides disabled and unlisted services.
- Calls are idempotent per buyer and idempotency key.
- Calls fail when the live service price exceeds `max_price_cents`.
- Funds are held before provider execution and released or refunded after the endpoint result.
- Providers cannot pay themselves through the marketplace.
- Payment status is scoped to the buyer/provider.

## V1 Gaps To Close Before Production x402

- Add wallet policy storage and signing behind OttoAuth policy checks.
- Add x402 facilitator verification/settlement configuration.
- Store x402 `PAYMENT-REQUIRED`, signed payload metadata, and `PAYMENT-RESPONSE` receipts.
- Add DB transactions around every ledger/call state transition.
- Add automated tests for idempotency, refunds, owner updates, and over-budget failures.
