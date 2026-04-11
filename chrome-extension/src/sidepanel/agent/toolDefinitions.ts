import type { AgentMacroAction } from '../../shared/types';
import { getMacroToolDefinitions } from './actionLibrary';

export function getToolDefinitions(
  viewportWidth: number,
  viewportHeight: number,
  macros: AgentMacroAction[] = [],
  activeUrl = '',
) {
  return [
    {
      name: 'computer',
      type: 'computer_20250124' as const,
      display_width_px: viewportWidth,
      display_height_px: viewportHeight,
      display_number: 1,
    },
    {
      name: 'navigate',
      description: 'Navigate to a URL, or go forward/back in browser history.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: "URL to navigate to. Use 'back' or 'forward' for history navigation." },
          tabId: { type: 'number', description: 'Tab ID to navigate.' },
        },
        required: ['url', 'tabId'],
      },
    },
    {
      name: 'read_page',
      description: 'Get an accessibility tree of elements on the page. Returns element roles, names, and reference IDs for use with form_input, find, and computer actions.',
      input_schema: {
        type: 'object' as const,
        properties: {
          filter: { type: 'string', enum: ['interactive', 'all'], description: "Filter: 'interactive' (default) for buttons/links/inputs only, 'all' for all elements including static text." },
          tabId: { type: 'number', description: 'Tab ID to read.' },
          depth: { type: 'number', description: 'Max tree depth (default: 12).' },
          ref_id: { type: 'string', description: 'Reference ID of a parent element to scope the read to (e.g. ref_5).' },
          max_chars: { type: 'number', description: 'Max characters for output (default: 15000).' },
        },
        required: ['tabId'],
      },
    },
    {
      name: 'form_input',
      description: 'Set values in form elements using element reference IDs from read_page. More reliable than clicking and typing.',
      input_schema: {
        type: 'object' as const,
        properties: {
          ref: { type: 'string', description: "Element reference ID from read_page (e.g. 'ref_1')." },
          value: { description: 'Value to set. Boolean for checkboxes, option value/text for selects, string for text inputs.' },
          tabId: { type: 'number', description: 'Tab ID.' },
        },
        required: ['ref', 'value', 'tabId'],
      },
    },
    {
      name: 'find',
      description: 'Find elements on the page using natural language. Can search by purpose (e.g. "search bar") or text content. Returns up to 20 matching elements with references and coordinates.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Natural language description of what to find.' },
          tabId: { type: 'number', description: 'Tab ID to search.' },
        },
        required: ['query', 'tabId'],
      },
    },
    {
      name: 'get_page_text',
      description: 'Extract the main text content from the page, prioritizing article/main content areas.',
      input_schema: {
        type: 'object' as const,
        properties: {
          tabId: { type: 'number', description: 'Tab ID to extract text from.' },
          max_chars: { type: 'number', description: 'Max characters for output (default: 10000).' },
        },
        required: ['tabId'],
      },
    },
    {
      name: 'javascript_tool',
      description: "Execute JavaScript code in the context of the current page. The code runs in the page's context and can interact with the DOM, window object, and page variables. The result of the last expression is returned automatically.",
      input_schema: {
        type: 'object' as const,
        properties: {
          action: { type: 'string', description: "Must be 'javascript_exec'." },
          text: { type: 'string', description: 'JavaScript code to execute.' },
          tabId: { type: 'number', description: 'Tab ID.' },
        },
        required: ['action', 'text', 'tabId'],
      },
    },
    {
      name: 'tabs_context',
      description: 'Get context information about all open tabs including their IDs, URLs, and titles.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'tabs_create',
      description: 'Create a new empty tab.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'read_console_messages',
      description: 'Read browser console messages (console.log, console.error, etc.) from a specific tab.',
      input_schema: {
        type: 'object' as const,
        properties: {
          tabId: { type: 'number', description: 'Tab ID.' },
          onlyErrors: { type: 'boolean', description: 'If true, only return error messages.' },
          clear: { type: 'boolean', description: 'If true, clear messages after reading.' },
          pattern: { type: 'string', description: 'Regex pattern to filter messages.' },
          limit: { type: 'number', description: 'Max messages to return (default: 100).' },
        },
        required: ['tabId'],
      },
    },
    {
      name: 'read_network_requests',
      description: 'Read HTTP network requests (XHR, Fetch, documents, etc.) from a specific tab.',
      input_schema: {
        type: 'object' as const,
        properties: {
          tabId: { type: 'number', description: 'Tab ID.' },
          urlPattern: { type: 'string', description: 'URL regex pattern to filter requests.' },
          clear: { type: 'boolean', description: 'If true, clear requests after reading.' },
          limit: { type: 'number', description: 'Max requests to return (default: 100).' },
        },
        required: ['tabId'],
      },
    },
    {
      name: 'upload_image',
      description: 'Upload a previously captured screenshot image to a file input or drag-and-drop target on the page.',
      input_schema: {
        type: 'object' as const,
        properties: {
          imageId: { type: 'string', description: 'ID of a previously captured screenshot.' },
          ref: { type: 'string', description: 'Element reference ID for file inputs.' },
          coordinate: { type: 'array', items: { type: 'number' }, description: '[x, y] for drag & drop targets.' },
          tabId: { type: 'number', description: 'Tab ID.' },
          filename: { type: 'string', description: "Optional filename (default: 'image.png')." },
        },
        required: ['imageId', 'tabId'],
      },
    },
    {
      name: 'file_upload',
      description: 'Upload one or more files from the local filesystem to a file input element on the page. Do not click on file upload buttons -- clicking opens a native file picker that you cannot interact with.',
      input_schema: {
        type: 'object' as const,
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to upload.' },
          ref: { type: 'string', description: 'Element reference ID of the file input.' },
          tabId: { type: 'number', description: 'Tab ID.' },
        },
        required: ['paths', 'ref', 'tabId'],
      },
    },
    {
      name: 'resize_window',
      description: 'Resize the current browser window.',
      input_schema: {
        type: 'object' as const,
        properties: {
          width: { type: 'number', description: 'Window width in pixels.' },
          height: { type: 'number', description: 'Window height in pixels.' },
          tabId: { type: 'number', description: 'Tab ID.' },
        },
        required: ['width', 'height', 'tabId'],
      },
    },
    {
      name: 'update_plan',
      description: 'Present a plan to the user for approval before taking actions. Use this when performing complex multi-step tasks.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domains: { type: 'array', items: { type: 'string' }, description: 'List of domains you plan to visit.' },
          approach: { type: 'array', items: { type: 'string' }, description: 'High-level steps of your plan (3-7 items).' },
        },
        required: ['domains', 'approach'],
      },
    },
    {
      name: 'shortcuts_list',
      description: 'List all available saved shortcuts and workflows.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'shortcuts_execute',
      description: 'Execute a saved shortcut or workflow by its ID or command name.',
      input_schema: {
        type: 'object' as const,
        properties: {
          shortcutId: { type: 'string', description: 'Shortcut ID to execute.' },
          command: { type: 'string', description: 'Command name (e.g. "debug", "summarize"). No leading slash.' },
        },
        required: [],
      },
    },
    ...getMacroToolDefinitions(macros, activeUrl),
  ];
}
