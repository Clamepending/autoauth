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
              "Natural-language task prompt. If it includes a URL, OttoAuth will route an open-link task. Otherwise OttoAuth can trigger the extension's local BYOK browser-agent planning flow (human approval required in the side panel).",
          },
          execution_mode: {
            type: "string",
            required: false,
            description: "Optional override. Use local_agent to force a high-level local browser-agent plan/approval flow.",
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
- Beta cloud routing supports:
  - URL/open-link tasks (\`Open https://...\`)
  - high-level local browser-agent goals (the extension generates a plan and asks the human to approve it)

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

### 2. (Optional) Start a high-level browser-agent goal

You can also send a higher-level task prompt (without a URL). OttoAuth will route it to the extension, and the extension will:
1. generate a local plan,
2. show it to the human for approval,
3. run the local browser-agent loop after approval.

\`\`\`bash
curl -s -X POST ${baseUrl}/api/computeruse/runs \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"MY_PRIVATE_KEY",
    "task_prompt":"On the current page, summarize the visible content and draft a short response."
  }'
\`\`\`

You can force this behavior explicitly with:
- \`"execution_mode":"local_agent"\`

### 3. Check run status (important for local-agent runs)

For cloud-triggered local-agent goals, the run lifecycle is:
1. \`queued\` / \`waiting_for_device\`
2. extension receives the task and generates a local plan
3. run moves to \`running\` when the plan is ready for human approval in the extension
4. after the human approves and the local browser-agent loop finishes, the run becomes \`completed\` or \`failed\`

\`\`\`bash
curl -s -X POST ${baseUrl}/api/computeruse/runs/RUN_ID_HERE \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"MY_PRIVATE_KEY"
  }'
\`\`\`

Example status snapshots you may see while polling:

\`\`\`json
{
  "run": {
    "id": "run_123",
    "status": "waiting_for_device"
  }
}
\`\`\`

\`\`\`json
{
  "run": {
    "id": "run_123",
    "status": "running"
  },
  "note": "The extension has generated a local plan and is waiting for human approval in the side panel."
}
\`\`\`

\`\`\`json
{
  "run": {
    "id": "run_123",
    "status": "completed"
  },
  "current_task": {
    "status": "completed",
    "result": {
      "summary": "Local browser-agent run completed after human-approved plan."
    }
  }
}
\`\`\`

Agent polling rule:
- If a **local-agent** run is \`"running"\`, do not assume active browser actions are happening yet. In this beta flow, \`running\` may mean the extension has generated a plan and is waiting for the human to approve it in the side panel.
- Keep polling \`/api/computeruse/runs/:runId\` (and optionally \`/events\`) until the run reaches a terminal state such as \`completed\` or \`failed\`.

### 4. (Optional) Inspect run events

For high-level local-agent runs, the event log may include entries such as:
- \`computeruse.local_agent.plan_ready\`
- \`computeruse.local_agent.completed\`
- \`computeruse.local_agent.failed\`

\`\`\`bash
curl -s -X POST ${baseUrl}/api/computeruse/runs/RUN_ID_HERE/events \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"MY_PRIVATE_KEY",
    "limit":50
  }'
\`\`\`

## What the extension can do locally (human-operated)

The OttoAuth browser extension now includes a local **BYOK browser agent chat sidebar** with:
- plan generation + user approval before execution
- local browser-agent loop (read page -> model -> action -> verify -> repeat)
- step logs / transcript export for debugging
- can be used directly by the human in the extension UI or triggered via OttoAuth cloud runs (\`execution_mode: "local_agent"\`)

## Summary

1. Ask human to install extension and send Browser Token
2. Register token via \`/api/computeruse/register-device\`
3. Start cloud-triggered runs via \`/api/computeruse/runs\`
4. Poll \`/api/computeruse/runs/:runId\` (and optionally \`/events\`) for async progress/final state
5. For high-level tasks, OttoAuth can trigger the extension's local BYOK browser-agent planning flow (human approves the plan in the side panel)
`,
  };
}
