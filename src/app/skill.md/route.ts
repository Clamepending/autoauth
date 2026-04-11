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

OttoAuth lets you (the AI agent) use real-world services like browser automation and Amazon on behalf of your human. It is now designed for three connected loops:

1. **Agent-driven flow:** you create an OttoAuth account, give the human a pairing key, and submit tasks against their credits.
2. **Human self-serve flow:** your human can submit their own browser/order tasks at \`${baseUrl}/orders/new\` and watch fulfillment live.
3. **Marketplace flow:** humans with claimed OttoAuth extension devices can enable marketplace fulfillment and earn credits by completing other humans' tasks.

## Hosted availability (current)

- Amazon: \`active\` and callable
- Computer Use: \`active\` and callable
- Snackpass: \`coming_soon\` and not callable yet

## OpenClaw Defaults

If you are an OpenClaw-style agent, treat OttoAuth like this by default:

1. Create an OttoAuth account once and store the returned \`privateKey\` securely.
2. Never share the \`privateKey\`. Share only the \`pairingKey\` with the human.
3. Tell the human to sign in at \`${baseUrl}/login\`, link the agent in the dashboard, and claim a browser device.
4. Use \`POST ${baseUrl}/api/services/computeruse/submit-task\` for browser tasks that should spend from the human's credits.
5. When OttoAuth returns a task id, tell the human they can watch it live at \`${baseUrl}/orders/<taskId>\` after signing in.
6. If the human wants to debug or self-serve directly, tell them to use \`${baseUrl}/orders/new\`.
7. If the human wants to earn credits by fulfilling other users' orders, tell them to enable marketplace fulfillment on a claimed device in \`${baseUrl}/dashboard\`.

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

1. You create your OttoAuth agent account.
2. OttoAuth returns a \`privateKey\` and a separate \`pairingKey\`.
3. You give the \`pairingKey\` to your human.
4. Your human signs in to OttoAuth, links your agent, and claims a browser device.
5. You submit OttoAuth service requests against their funded credits.
6. OttoAuth fulfills the request and debits credits after completion.
7. If another human fulfills the task through the marketplace, OttoAuth credits that fulfiller after the run completes.

## Quick Start

**1. Create account:**

\`\`\`
POST ${baseUrl}/api/agents/create
{"username":"your_agent_name","callback_url":"https://your-openclaw.app/api/ottoauth/callback"}
\`\`\`

Returns \`username\`, \`privateKey\`, \`pairingKey\`, and \`callbackUrl\`.

- Keep \`privateKey\` secret. It authenticates you.
- Give \`pairingKey\` to your human. They use it once in the OttoAuth dashboard to link you.
- The human can then use both the dashboard and the self-serve order page at \`${baseUrl}/orders/new\`.

**2. Human pairing step:**

Tell your human to:
- open \`${baseUrl}/login\`
- sign in
- paste your \`pairingKey\` into the dashboard
- generate a device claim code for the OttoAuth browser extension / Raspberry Pi
- optionally enable marketplace fulfillment later if they want that device to fulfill other humans' orders and earn credits

You cannot submit human-linked credit-backed tasks until that is done.

**3. OpenClaw handoff message you can use verbatim:**

\`\`\`
Please sign in to OttoAuth at ${baseUrl}/login, paste in this pairing key, and claim your browser device. Once that's done I can submit browser tasks against your OttoAuth credit balance. If you ever want to submit a task yourself or watch one live, use ${baseUrl}/orders/new and ${baseUrl}/orders/<taskId>.
\`\`\`

**4. Discover services:**

\`\`\`
GET ${baseUrl}/api/services
\`\`\`

Returns all services with \`id\`, \`status\`, \`serviceUrl\`, \`docsUrl\`, and summary metadata.

**Service catalog:**

| Service | Status | What it does | Tools | Docs |
|---------|--------|-------------|------|------|
${serviceRows}

Call only services with \`status = "active"\` or \`status = "beta"\`.

**5. Get tools for a service (need-to-know):**

\`\`\`
GET ${baseUrl}/api/services/<id>
\`\`\`

Returns the service metadata plus \`tools[]\` with names, signatures, params, and API paths.

**6. Optional docs for a service:**

\`\`\`
GET ${baseUrl}/api/services/<id>/docs
\`\`\`

**7. Request human fulfillment for non-callable services:**

\`\`\`
POST ${baseUrl}/api/requests
{"username":"...","password":"YOUR_PRIVATE_KEY","type":"<service_id>","message":"optional details"}
\`\`\`

## Auth

Most agent-authenticated endpoints require \`username\` + \`private_key\` (or \`password\` where noted). Pairing the human uses the separate \`pairingKey\` on the website, not your \`private_key\`.

## Human URLs You Should Know

- Login: \`${baseUrl}/login\`
- Dashboard: \`${baseUrl}/dashboard\`
- Human self-serve order page: \`${baseUrl}/orders/new\`
- Live task page: \`${baseUrl}/orders/<taskId>\`

Use those URLs proactively in your replies so the human knows where to go next.

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
