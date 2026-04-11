import type { ServiceManifest } from "@/services/_shared/types";
import { getBaseUrl } from "@/lib/base-url";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
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
        description: "Check the status, billing breakdown, and completion summary for a submitted browser task",
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
        name: "history",
        method: "POST",
        path: "/api/services/computeruse/history",
        description: "List recent browser tasks submitted by this agent",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
        },
      },
    ],
    docsMarkdown: `# OttoAuth Computer Use

OttoAuth now supports **human-linked browser tasks**, **human self-serve order pages**, and **marketplace fulfillers**. Your human can link you with a pairing key, claim a browser device, submit their own tasks from the website, or opt their device into fulfilling tasks for other humans.

## OpenClaw-first summary

If you are an OpenClaw-style agent, the easiest OttoAuth onboarding is:

1. Create your OttoAuth account.
2. Save the returned \`privateKey\`.
3. Give the human the \`pairingKey\`.
4. Tell the human to sign in at \`${baseUrl}/login\`, link the agent, and claim a browser device.
5. Submit browser tasks through OttoAuth against the human's credits.
6. Share \`${baseUrl}/orders/<taskId>\` with the human if they want to watch fulfillment live.
7. Tell the human about \`${baseUrl}/orders/new\` if they want to submit their own task directly.

## Human-linked flow

1. Create your agent account:

\`\`\`bash
curl -s -X POST ${baseUrl}/api/agents/create \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "callback_url":"https://example.com/ottoauth/callback"
  }'
\`\`\`

This returns:
- \`privateKey\` — keep this secret
- \`pairingKey\` — give this to your human

2. Tell your human:
- sign in at \`${baseUrl}/login\`
- paste your \`pairingKey\` into the OttoAuth dashboard
- generate a **device claim code**
- enter that device claim code into the OttoAuth browser extension running on their Raspberry Pi or browser machine
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
- billing status
- payout status
- final debit amount
- token usage
- summary / error

### History

\`\`\`
POST ${baseUrl}/api/services/computeruse/history
Content-Type: application/json
\`\`\`

Body:
- \`username\`
- \`private_key\`

## Notes

- If the human has not linked the agent yet, task submission will be rejected.
- If the human has not claimed a device yet, task submission will be rejected.
- If the human has no credits remaining, task submission will be rejected.
- Humans can create tasks directly from \`${baseUrl}/orders/new\`.
- Humans can watch live low-rate screenshots on \`${baseUrl}/orders/<taskId>\`.
- Humans can opt a claimed device into marketplace fulfillment from \`${baseUrl}/dashboard\`.
- Existing low-level OttoAuth computer-use APIs still exist, but the credit-backed human-linked task flow above is the recommended path.
`,
  };
}
