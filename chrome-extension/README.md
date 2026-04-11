# Claude Browser Agent

AI-powered browser automation Chrome extension using Claude's computer use capabilities. Replicates the architecture from Anthropic's Claude for Chrome extension.

## Setup

```bash
npm install
npm run build
```

## Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Click the extension icon in the toolbar — the side panel opens
6. Enter your Anthropic API key (starts with `sk-ant-`)
7. In the OttoAuth connection settings, paste:
   - the OttoAuth server URL
   - a device label
   - the short device claim code generated from the human OttoAuth dashboard

## Usage

Type a prompt in the chat input. The agent will:
- Take screenshots to see the current page
- Click, type, scroll, and navigate
- Read page content via accessibility trees
- Fill forms programmatically
- Execute JavaScript in the page context
- Manage multiple tabs

## Tools (17 available)

| Tool | Description |
|------|-------------|
| `computer` | Screenshot, click, type, key, scroll, hover, drag, wait, zoom |
| `navigate` | Go to URL or back/forward |
| `read_page` | Accessibility tree with element refs |
| `form_input` | Set form values by ref ID |
| `find` | Natural language element search (inner LLM call) |
| `get_page_text` | Extract main text content |
| `javascript_tool` | Execute JS in page context |
| `tabs_context` | List all open tabs |
| `tabs_create` | Create a new tab |
| `read_console_messages` | Read browser console output |
| `read_network_requests` | Read HTTP requests |
| `upload_image` | Upload screenshot to file input |
| `file_upload` | Upload local files |
| `resize_window` | Resize browser window |
| `update_plan` | Present action plan for approval |
| `shortcuts_list` | List saved shortcuts |
| `shortcuts_execute` | Run a saved shortcut |

## Architecture

- **Side Panel** (React): Chat UI, Anthropic SDK client, agentic tool loop
- **Background Service Worker**: Chrome DevTools Protocol (CDP) automation, tab management, console/network capture
- **Content Scripts** (injected on demand): Accessibility tree walker, form handler, text extractor

## OttoAuth claim flow

The extension no longer just pairs blindly to the server. The intended OttoAuth setup is:

1. Human signs in to OttoAuth on the website
2. Human generates a device claim code in the dashboard
3. Extension connects to OttoAuth with that claim code
4. OttoAuth returns a device auth token
5. The extension polls for human-linked tasks and reports completion plus model-usage telemetry back to OttoAuth

## Development

```bash
npm run dev    # Watch mode (rebuilds on change)
npm run build  # Production build
npm run local-control-server
```

After rebuilding, click the refresh icon on `chrome://extensions/` to reload.

## Local Control Macro API

When the side panel is open, the extension loads remote macros from the local control server and shows them as read-only `API` macros in the Action Library. While local intake is enabled, it re-syncs automatically every few seconds, so coding agents can add or update macros without editing Chrome storage directly.

Base URL: `http://127.0.0.1:8787`

- `GET /health` shows the queue status and macro API capabilities.
- `GET /macros` lists the currently published remote macros.
- `POST /macros` upserts by default.
- `POST /macros/upsert` explicitly upserts one or more macros.
- `POST /macros/replace` replaces the full remote macro set.
- `POST /macros/delete` removes remote macros by id.

Accepted `POST /macros` bodies:

```json
{
  "name": "Amazon Quick Search",
  "scope": { "type": "domain", "domainPattern": "amazon.com", "label": "Amazon" },
  "steps": [
    { "primitiveId": "find", "input": { "query": "Search Amazon search box" } },
    { "primitiveId": "form_input", "input": { "ref": "{{last_ref}}", "value": "{{query}}" } },
    { "primitiveId": "key", "input": { "text": "Return" } }
  ]
}
```

```json
{
  "mode": "replace",
  "macros": [
    {
      "name": "Amazon Open Cart",
      "scope": { "type": "domain", "domainPattern": "amazon.com", "label": "Amazon" },
      "steps": [
        { "primitiveId": "navigate", "input": { "url": "https://www.amazon.com/gp/cart/view.html" } }
      ]
    }
  ]
}
```
