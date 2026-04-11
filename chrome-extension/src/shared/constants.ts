export const STORAGE_KEY_API_KEY = 'claude_api_key';
export const STORAGE_KEY_PERMISSION_MODE = 'permission_mode';

export const STORAGE_KEY_OTTOAUTH_URL = 'ottoauth_server_url';
export const STORAGE_KEY_OTTOAUTH_DEVICE_ID = 'ottoauth_device_id';
export const STORAGE_KEY_OTTOAUTH_AUTH_TOKEN = 'ottoauth_auth_token';
export const STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_ENABLED = 'ottoauth_trace_recording_enabled';
export const STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_FOLDER_NAME = 'ottoauth_trace_recording_folder_name';
export const STORAGE_KEY_OTTOAUTH_TRACE_RECORDING_PAUSED = 'ottoauth_trace_recording_paused';
export const STORAGE_KEY_OTTOAUTH_HEADLESS_MODE_ENABLED = 'ottoauth_headless_mode_enabled';
export const STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_REQUESTED = 'ottoauth_headless_polling_requested';
export const STORAGE_KEY_OTTOAUTH_HEADLESS_RUNTIME_ACTIVE = 'ottoauth_headless_runtime_active';
export const STORAGE_KEY_OTTOAUTH_HEADLESS_POLLING_ACTIVE = 'ottoauth_headless_polling_active';
export const STORAGE_KEY_OTTOAUTH_HEADLESS_CURRENT_TASK = 'ottoauth_headless_current_task';
export const STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_ERROR = 'ottoauth_headless_last_error';
export const STORAGE_KEY_OTTOAUTH_HEADLESS_LAST_SEEN_AT = 'ottoauth_headless_last_seen_at';
export const STORAGE_KEY_LOCAL_CONTROL_ENABLED = 'local_control_enabled';
export const STORAGE_KEY_LOCAL_CONTROL_URL = 'local_control_url';
export const STORAGE_KEY_LOCAL_CONTROL_REQUEST_HISTORY = 'local_control_request_history';
export const STORAGE_KEY_AGENT_MACROS = 'agent_action_macros';
export const STORAGE_KEY_REMOTE_AGENT_MACROS = 'remote_agent_action_macros';

export const STORAGE_KEY_SESSIONS = 'extension_sessions';

export const OTTOAUTH_POLL_INTERVAL_MS = 2000;
export const OTTOAUTH_POLL_TIMEOUT_MS = 25000;
export const OTTOAUTH_TASK_HEARTBEAT_INTERVAL_MS = 5000;
export const OTTOAUTH_TASK_TIMEOUT_MS = 8 * 60 * 1000;
export const OTTOAUTH_TOOL_TIMEOUT_MS = 45000;
export const LOCAL_CONTROL_DEFAULT_URL = 'http://127.0.0.1:8787';
export const LOCAL_CONTROL_POLL_INTERVAL_MS = 2000;
export const LOCAL_CONTROL_MACRO_SYNC_INTERVAL_MS = 5000;
export const LOCAL_CONTROL_HISTORY_LIMIT = 100;

export const MAX_TOKENS = 4096;
export const MODEL = 'claude-sonnet-4-5-20250929';
export const BETAS: string[] = ['computer-use-2025-01-24'];

export const MAX_A11Y_CHARS = 15000;
export const MAX_A11Y_DEPTH = 12;
export const MAX_PAGE_TEXT_CHARS = 10000;
export const MAX_TOOL_RESULT_CHARS_IN_HISTORY = 3000;

export const SCREENSHOT_MAX_DIMENSION = 1024;
export const SCROLL_PIXELS_PER_TICK = 100;
export const CLICK_DELAY_MS = 100;

export const KEY_DEFINITIONS: Record<string, { key: string; code: string; keyCode: number }> = {
  return: { key: 'Enter', code: 'Enter', keyCode: 13 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  f1: { key: 'F1', code: 'F1', keyCode: 112 },
  f2: { key: 'F2', code: 'F2', keyCode: 113 },
  f3: { key: 'F3', code: 'F3', keyCode: 114 },
  f4: { key: 'F4', code: 'F4', keyCode: 115 },
  f5: { key: 'F5', code: 'F5', keyCode: 116 },
  f6: { key: 'F6', code: 'F6', keyCode: 117 },
  f7: { key: 'F7', code: 'F7', keyCode: 118 },
  f8: { key: 'F8', code: 'F8', keyCode: 119 },
  f9: { key: 'F9', code: 'F9', keyCode: 120 },
  f10: { key: 'F10', code: 'F10', keyCode: 121 },
  f11: { key: 'F11', code: 'F11', keyCode: 122 },
  f12: { key: 'F12', code: 'F12', keyCode: 123 },
};
