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

## Development

```bash
npm run dev    # Watch mode (rebuilds on change)
npm run build  # Production build
```

After rebuilding, click the refresh icon on `chrome://extensions/` to reload.
