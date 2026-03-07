import { getBaseUrl } from "@/lib/base-url";
import { getAllManifests } from "@/services/registry";

function buildSkill(baseUrl: string): string {
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

OttoAuth lets you (the AI agent) use real-world services like Amazon on behalf of your human. You call the API, get a payment link, send it to your human, and OttoAuth fulfills the order. You never need login credentials or spending power — OttoAuth handles everything after payment.

## Discovery Flow (Important)

1. List services:
   - \`GET ${baseUrl}/api/services\`
2. Pick a callable service:
   - use entries with \`status = "active"\` or \`status = "beta"\`
3. Fetch machine-readable tools for that service:
   - \`GET ${baseUrl}/api/services/<id>\`
4. Call the specific endpoint shown in that service's \`tools[]\`.
5. Optionally fetch human-readable docs:
   - \`GET ${baseUrl}/api/services/<id>/docs\`

Services with \`status = "coming_soon"\` are discoverable but not callable yet (they usually have \`toolCount = 0\`).

## How it works

1. You call an OttoAuth service endpoint (for example, Amazon buy).
2. OttoAuth may return a **payment URL**.
3. You send that payment URL to your human for approval and payment.
4. Once paid, OttoAuth fulfills the request.

## Quick Start

**1. Create account:**

\`\`\`
POST ${baseUrl}/api/agents/create
{"username":"your_agent_name","callback_url":"https://your-openclaw.app/api/ottoauth/callback"}
\`\`\`

Returns \`username\`, \`privateKey\`, and \`callbackUrl\`. Save the key — it cannot be recovered.

**2. Discover services:**

\`\`\`
GET ${baseUrl}/api/services
\`\`\`

Returns all services with \`id\`, \`status\`, \`serviceUrl\`, \`docsUrl\`, and summary metadata.

**Service catalog:**

| Service | Status | What it does | Tools | Docs |
|---------|--------|-------------|------|------|
${serviceRows}

Call only services with \`status = "active"\` or \`status = "beta"\`.

**3. Get tools for a service (need-to-know):**

\`\`\`
GET ${baseUrl}/api/services/<id>
\`\`\`

Returns the service metadata plus \`tools[]\` with names, signatures, params, and API paths.

**4. Optional docs for a service:**

\`\`\`
GET ${baseUrl}/api/services/<id>/docs
\`\`\`

**5. Request human fulfillment for non-callable services:**

\`\`\`
POST ${baseUrl}/api/requests
{"username":"...","password":"YOUR_PRIVATE_KEY","type":"<service_id>","message":"optional details"}
\`\`\`

## Auth

Most authenticated endpoints require \`username\` + \`private_key\` (or \`password\` — same value). Follow each tool's declared params.

## Other endpoints

- **Update description:** \`POST ${baseUrl}/api/agents/update-description\` with \`username\`, \`password\`, \`description\` (max 100 chars)
- **Delete account:** \`POST ${baseUrl}/api/agents/delete\` with \`username\`, \`password\`

## Stay up to date

Add \`curl -s ${baseUrl}/skill.md\` to your daily heartbeat to pick up new services and API changes.
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
