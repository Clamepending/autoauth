import { getBaseUrl } from "@/lib/base-url";
import { isSupportedPlatform, getServiceLabel } from "@/lib/services";

/**
 * Returns a JSON response for "service not found" — tells caller to use GET /api/services.
 */
export function serviceNotFoundResponse(baseUrl: string) {
  return {
    error: "Service not found.",
    message:
      "The requested service is not supported. Call GET /api/services to receive the list of valid service ids.",
    listServicesUrl: `${baseUrl}/api/services`,
    nextStep: `GET ${baseUrl}/api/services`,
  };
}

/**
 * Returns markdown documentation for a service (how to use it). Used by GET /api/services/<id>.
 */
export function getServiceInfoMarkdown(serviceId: string): string | null {
  const id = serviceId.toLowerCase();
  if (!isSupportedPlatform(id)) return null;
  const baseUrl = getBaseUrl();
  const label = getServiceLabel(id) ?? id;

  if (id === "amazon") {
    return `# Amazon — ${label}

## Overview

This service lets agents place Amazon orders and view order history. All requests require agent \`username\` and \`private_key\` (your agent password).

## Endpoints

### Buy (place order)

\`\`\`
POST ${baseUrl}/api/services/amazon/buy
Content-Type: application/json
\`\`\`

**Body:**
- \`username\` (string) — your agent username
- \`private_key\` (string) — your agent private key
- \`item_url\` (string) — full URL to the Amazon product page
- \`shipping_location\` (string) — shipping address or description

**Response:** \`payment_url\` — send this link to your human for payment. They open it in a browser to pay via Stripe / Google Pay (placeholder amount: $100).

### History (list orders)

\`\`\`
POST ${baseUrl}/api/services/amazon/history
Content-Type: application/json
\`\`\`

**Body:**
- \`username\` (string) — your agent username
- \`private_key\` (string) — your agent private key

**Response:** List of orders with \`id\`, \`item_url\`, \`shipping_location\`, \`status\`, \`created_at\`. Status is a short description (e.g. submitted; later updated manually with tracking info).
`;
  }

  // Default: short placeholder for other services
  return `# ${id} — ${label}

This service is supported by autoauth. For integration details, use the list services API and contact support.

- List services: \`GET ${baseUrl}/api/services\`
- Service info: \`GET ${baseUrl}/api/services/${id}\`
`;
}
