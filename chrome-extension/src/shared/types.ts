export type BGMessage =
  | { type: 'cdp-attach'; tabId: number }
  | { type: 'cdp-detach'; tabId: number }
  | { type: 'cdp-detach-all' }
  | { type: 'cdp-send'; tabId: number; method: string; params?: Record<string, unknown> }
  | { type: 'take-screenshot'; tabId: number }
  | { type: 'navigate'; tabId: number; url: string }
  | { type: 'tabs-context'; sessionId?: string }
  | { type: 'tabs-create'; sessionId?: string }
  | { type: 'tabs-activate'; tabId: number }
  | { type: 'resize-window'; tabId: number; width: number; height: number }
  | { type: 'get-console-messages'; tabId: number; onlyErrors?: boolean; clear?: boolean; pattern?: string; limit?: number }
  | { type: 'get-network-requests'; tabId: number; urlPattern?: string; clear?: boolean; limit?: number }
  | { type: 'enable-console-capture'; tabId: number }
  | { type: 'enable-network-capture'; tabId: number }
  | { type: 'file-upload'; tabId: number; ref: string; paths: string[] }
  | { type: 'get-viewport-size'; tabId: number }
  | { type: 'session-get-active' }
  | { type: 'session-get-all' }
  | { type: 'session-request-create'; backgroundTab?: boolean; source?: 'manual' | 'ottoauth'; autoCloseOnIdle?: boolean }
  | { type: 'session-close'; sessionId: string };

export interface BGResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
  groupId: number;
}

export type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

export type PermissionType =
  | 'NAVIGATE'
  | 'READ_PAGE_CONTENT'
  | 'CLICK'
  | 'TYPE'
  | 'UPLOAD_IMAGE'
  | 'PLAN_APPROVAL';

export type PermissionMode = 'ask' | 'follow_a_plan' | 'allow_all';

export type PermissionDuration = 'once' | 'always';

export interface PermissionGrant {
  domain: string;
  type: PermissionType;
  duration: PermissionDuration;
  toolUseId?: string;
}

export interface PlanData {
  domains: string[];
  approach: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: number;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: ToolResultContent[] }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

export interface OttoAuthTask {
  id: string;
  type: string;
  url: string | null;
  goal: string | null;
  taskPrompt: string | null;
  deviceId: string;
  createdAt: string;
}

export interface OttoAuthConfig {
  serverUrl: string;
  deviceId: string;
  authToken: string;
}

export interface SessionInfo {
  id: string;
  groupId: number;
  name: string;
  color: chrome.tabGroups.ColorEnum;
  createdAt: number;
  source?: 'manual' | 'ottoauth';
  autoCloseOnIdle?: boolean;
}

export type SidePanelNotification =
  | { kind: 'session-switched'; sessionId: string | null }
  | { kind: 'session-created'; session: SessionInfo }
  | { kind: 'session-removed'; sessionId: string }
  | { kind: 'panel-no-session' };
