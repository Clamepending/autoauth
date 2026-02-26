import type { ServiceManifest } from "@/services/_shared/types";
import { getBaseUrl } from "@/lib/base-url";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
  return {
    id: "computeruse",
    name: "Computer Use",
    description: "Control a paired browser extension on a user's device",
    category: "compute",
    status: "beta",
    endpoints: [
      {
        method: "POST",
        path: "/api/computeruse/register-device",
        description: "Register a browser token to an agent (one-time setup)",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          browser_token: {
            type: "string",
            required: true,
            description: "Browser token copied from the OttoAuth Chrome extension",
          },
        },
      },
      {
        method: "POST",
        path: "/api/computeruse/runs",
        description: "Start an async computer-use run",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          task_prompt: {
            type: "string",
            required: true,
            description:
              "Natural-language task prompt. Cloud-triggered beta currently supports URL/open-link routing. The extension also has a local BYOK browser-agent chat mode for richer tasks.",
          },
          device: {
            type: "string",
            required: false,
            description: "Optional browser token (or device id). Usually omitted after register-device.",
          },
        },
      },
      {
        method: "POST",
        path: "/api/computeruse/runs/:runId",
        description: "Fetch run status",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
        },
      },
      {
        method: "POST",
        path: "/api/computeruse/runs/:runId/events",
        description: "Fetch run event log",
        params: {
          username: { type: "string", required: true, description: "Agent username" },
          private_key: { type: "string", required: true, description: "Agent private key" },
          limit: { type: "number", required: false, description: "Max events to return" },
        },
      },
    ],
    docsMarkdown: `# Computer Use — Control a paired browser extension

## What this is

Use this to trigger actions in a human's browser through the OttoAuth browser extension.

## Two modes (important)

### 1. Cloud-triggered mode (OttoAuth API)
- Agent calls OttoAuth
- OttoAuth routes a command to the paired browser extension
- **Current beta cloud routing supports URL/open-link tasks**

### 2. Local browser-agent mode (inside the extension)
- Human opens the OttoAuth extension side panel
- Enters BYOK model settings (OpenAI-compatible)
- Sends a high-level task in chat
- Extension generates a plan, asks for approval, then runs a local browser-agent loop
- This mode supports richer browser interaction than the cloud-triggered open-link beta

If you are an external agent using OttoAuth's public API today, use **Cloud-triggered mode** below.

## Onboarding (very important)

This is a 2-step setup: **human installs extension and shares a token**, then **you register that token**.

### What you should say to the human

Send a message like:

> Please install the OttoAuth browser extension, open it, click **Regenerate**, and send me the Browser Token it shows.

The human should:
1. Install/open the OttoAuth browser extension
2. Click **Regenerate**
3. Copy the **Browser Token**
4. Send that token to you

### What you do with the token (one-time registration)

Call:

\`\`\`bash
curl -s -X POST ${baseUrl}/api/computeruse/register-device \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"MY_PRIVATE_KEY",
    "browser_token":"BROWSER_TOKEN_FROM_HUMAN"
  }'
\`\`\`

After this succeeds, OttoAuth remembers the browser for your agent (beta: one browser/device per agent).

## How to use Computer Use (simple flow)

### 1. Start a run

\`\`\`bash
curl -s -X POST ${baseUrl}/api/computeruse/runs \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"MY_PRIVATE_KEY",
    "task_prompt":"Open https://google.com"
  }'
\`\`\`

This returns a \`run_id\` immediately. The browser action happens asynchronously.

## What the extension can do locally (human-operated)

The OttoAuth browser extension now includes a local **BYOK browser agent chat sidebar** with:
- plan generation + user approval before execution
- local browser-agent loop (read page -> model -> action -> verify -> repeat)
- step logs / transcript export for debugging

This local mode is currently started from the extension UI (not the OttoAuth cloud API).

## Summary

1. Ask human to install extension and send Browser Token
2. Register token via \`/api/computeruse/register-device\`
3. Start cloud-triggered runs via \`/api/computeruse/runs\` (URL/open-link beta)
4. For richer browser-agent tasks today, instruct the human to use the extension's local BYOK chat sidebar
`,
  };
}
