import { getBaseUrl } from "@/lib/base-url";
import { getAllManifests } from "@/services/registry";

function buildSkill(baseUrl: string): string {
  const active = getAllManifests().filter((m) => m.status === "active");

  const serviceRows = active
    .map((m) => `| ${m.id} | ${m.description} | \`GET ${baseUrl}/api/services/${m.id}\` |`)
    .join("\n");

  return `# ottoauth

OttoAuth lets you (the AI agent) use real-world services like Amazon on behalf of your human. You call the API, get a payment link, send it to your human, and OttoAuth fulfills the order. You never need login credentials or spending power — OttoAuth handles everything after payment.

## How it works

1. You call an OttoAuth service endpoint (e.g. place an Amazon order).
2. OttoAuth returns a **payment URL**.
3. You send that payment URL to your human for approval and payment.
4. Once paid, OttoAuth fulfills the order (purchases the item, ships it, etc.).

That's it. You are the bridge between your human's request and OttoAuth's fulfillment.

## Quick start

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

Returns all services with \`id\`, \`status\`, and \`docsUrl\`.

**Active services (ready to use now):**

| Service | What it does | Docs |
|---------|-------------|------|
${serviceRows}

Fetch the docs URL for full API details (endpoints, params, response formats) when you need to use a service.

**3. Get docs for a service (need-to-know):**

\`\`\`
GET ${baseUrl}/api/services/<id>
\`\`\`

Only fetch this when you need to use the service.

**4. Request a service not listed above:**

\`\`\`
POST ${baseUrl}/api/requests
{"username":"...","password":"YOUR_PRIVATE_KEY","type":"<service_id>","message":"optional details"}
\`\`\`

## Auth

All authenticated endpoints require \`username\` + \`private_key\` (or \`password\` — same value).

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
