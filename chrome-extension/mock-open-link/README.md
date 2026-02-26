# OttoAuth Mock Open-Link Extension

Minimal Chrome extension (Manifest V3) that mocks the device-side "computer use" trigger by opening a URL in a new tab.

## What it does

- Opens an arbitrary `http/https` URL from the popup ("Open URL now")
- Optionally polls a mock endpoint every ~1 minute for an `open_url` task
- Stores local settings (`deviceId`, endpoint, token) in `chrome.storage.local`

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder:
   - `chrome-extension/mock-open-link`

## Manual test (no backend)

1. Click the extension icon
2. Enter `https://example.com`
3. Click **Open URL**

## Mock polling endpoint format

The extension accepts any of these JSON shapes from `GET /...`:

```json
{ "id": "task-1", "type": "open_url", "url": "https://example.com" }
```

```json
{ "task": { "id": "task-1", "type": "open_url", "url": "https://example.com" } }
```

If there is no task, return `204 No Content`.

## Using the built-in mock route in this repo

This repo now includes local dev routes:

- `POST /api/computeruse/device/pair` (issues/rotates a mock device token)
- `GET/POST /api/computeruse/device/next-task` (poll/queue tasks)
- `GET /api/computeruse/device/wait-task` (authenticated long-poll for near-real-time delivery)
- `POST /api/computeruse/mock/send` (agent-authenticated queueing)
- `POST /api/computeruse/tasks` (final-shaped mock endpoint: accepts `task_prompt`)
- `POST /api/computeruse/tasks/:taskId` (agent-authenticated mock task status lookup)
- `POST /api/computeruse/runs` (async run/session start, recommended for agent loops)
- `POST /api/computeruse/register-device` (agent claims a browser token once; later calls can omit device)
- `POST /api/computeruse/runs/:runId` (agent-authenticated run status)
- `POST /api/computeruse/runs/:runId/events` (agent-authenticated run event log)
- `POST /api/agent-events/mock` (agent-authenticated event inspection for dev)
- `POST /api/agent-events/mock/emit` (agent-authenticated arbitrary event emit for dev)

Start the app:

```bash
npm run dev
```

Pair the extension first (recommended from popup):

1. Set the poll endpoint to `http://localhost:3000/api/computeruse/device/next-task`
2. Click **Pair (Mock)**
3. The popup stores the returned bearer token automatically
4. Optional: enable **Live listen (long-poll)** and click **Save** for near-real-time task delivery

Manual pairing via curl (if needed):

```bash
curl -s -X POST http://localhost:3000/api/computeruse/device/pair \
  -H 'content-type: application/json' \
  -d '{"deviceId":"local-device-1"}'
```

Enqueue a task for the default extension device (`local-device-1`):

```bash
curl -s -X POST http://localhost:3000/api/computeruse/device/next-task \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","deviceId":"local-device-1"}'
```

### Agent-authenticated mock trigger (closer to final design)

Create a test agent (once):

```bash
curl -s -X POST http://localhost:3000/api/agents/create \
  -H 'content-type: application/json' \
  -d '{"username":"testagent","description":"Local mock tester"}'
```

Save the returned `privateKey`, then queue a mock computer-use trigger:

```bash
curl -s -X POST http://localhost:3000/api/computeruse/mock/send \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE",
    "device_id":"local-device-1",
    "url":"https://example.com"
  }'
```

The extension will open the link on the next poll (or immediately if you click **Poll Now**).
If the device is not paired, `/api/computeruse/mock/send` will reject the request.
If **Live listen (long-poll)** is enabled, the extension will usually open the link within a few seconds of enqueueing.

### Final-shaped mock endpoint (`task_prompt`)

This is the endpoint your agent should target first while the executor is still mocked:

```bash
curl -s -X POST http://localhost:3000/api/computeruse/tasks \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE",
    "device":"local-device-1",
    "task_prompt":"Open https://example.com and wait for me to confirm the page loaded."
  }'
```

Current behavior:
- The backend extracts the first `http/https` URL from `task_prompt`
- It queues a mock `open_url` task for the paired extension device
- It emits a canonical `computeruse.task.queued` event and returns `event_id`
- After the extension opens the URL, it calls a mock completion callback and `ottoauth` emits `computeruse.task.completed`
- If no URL is present, the request is rejected (for now)

### Async run/session API (recommended for agent orchestration)

Use this instead of trying to hold one request open for the entire browser loop.

Start a run:

```bash
curl -s -X POST http://localhost:3000/api/computeruse/runs \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE",
    "device":"local-device-1",
    "task_prompt":"Open https://example.com and report when it is loaded."
  }'
```

Optional one-time device registration (recommended UX):

```bash
curl -s -X POST http://localhost:3000/api/computeruse/register-device \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE",
    "browser_token":"PASTE_BROWSER_TOKEN_FROM_EXTENSION"
  }'
```

After that, the agent can omit `device`/`browser_token` in `/api/computeruse/runs` calls (mock one-device-per-agent behavior).

The response includes `run_id` and `current_task_id`. The extension receives the task, opens the URL, and reports completion back automatically.

Check run status:

```bash
curl -s -X POST http://localhost:3000/api/computeruse/runs/RUN_ID_HERE \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE"
  }'
```

List run events:

```bash
curl -s -X POST http://localhost:3000/api/computeruse/runs/RUN_ID_HERE/events \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE",
    "limit":50
  }'
```

Typical run event sequence:
- `computeruse.run.created`
- `computeruse.task.queued`
- `computeruse.task.delivered`
- `computeruse.task.completed`
- `computeruse.run.completed`

Inspect emitted events for the authenticated agent:

```bash
curl -s -X POST http://localhost:3000/api/agent-events/mock \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE",
    "limit":10
  }'
```

Emit a mock non-computer-use event (example: Amazon confirmation) into the canonical event store:

```bash
curl -s -X POST http://localhost:3000/api/agent-events/mock/emit \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE",
    "device":"local-device-1",
    "type":"amazon.order.confirmed",
    "data":{
      "order_id":"A123",
      "merchant":"Amazon",
      "amount":"19.99",
      "currency":"USD"
    }
  }'
```

You can then inspect it via `POST /api/agent-events/mock`.

Inspect a specific task status (uses `POST` so you can reuse agent auth payload):

```bash
curl -s -X POST http://localhost:3000/api/computeruse/tasks/TASK_ID_HERE \
  -H 'content-type: application/json' \
  -d '{
    "username":"testagent",
    "private_key":"PASTE_PRIVATE_KEY_HERE"
  }'
```

You can also test consume manually (this is what the extension polls). This now requires the bearer token from `/pair`:

```bash
curl -i http://localhost:3000/api/computeruse/device/next-task \
  -H 'X-OttoAuth-Mock-Device: local-device-1' \
  -H 'Authorization: Bearer PASTE_DEVICE_TOKEN_HERE'
```

Long-poll manual test (waits up to ~25s for a task):

```bash
curl -i 'http://localhost:3000/api/computeruse/device/wait-task?waitMs=25000' \
  -H 'X-OttoAuth-Mock-Device: local-device-1' \
  -H 'Authorization: Bearer PASTE_DEVICE_TOKEN_HERE'
```

## Notes

- This is still a mock trigger receiver, but now includes a mock pair/token flow.
- The extension popup includes **Test Notification** to validate `chrome.notifications` locally.
- Next step is replacing polling with ottoauth device pairing + task delivery.
