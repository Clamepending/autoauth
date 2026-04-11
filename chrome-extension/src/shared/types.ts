export type SessionSource = 'manual' | 'ottoauth' | 'local_control';

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
  | { type: 'storage-get'; keys?: string | string[] | Record<string, unknown> | null }
  | { type: 'storage-set'; items: Record<string, unknown> }
  | { type: 'storage-remove'; keys: string[] }
  | { type: 'storage-clear' }
  | { type: 'session-get-active' }
  | { type: 'session-get-all' }
  | { type: 'session-request-create'; backgroundTab?: boolean; source?: SessionSource; autoCloseOnIdle?: boolean }
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

export interface OttoAuthModelUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  source?: string | null;
}

export interface OttoAuthHeadlessState {
  modeEnabled: boolean;
  pollingRequested: boolean;
  runtimeActive: boolean;
  pollingActive: boolean;
  currentTask: OttoAuthTask | null;
  lastError: string | null;
  lastSeenAt: number | null;
}

export type LocalControlRequestStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface LocalControlRequest {
  id: string;
  taskDescription: string;
  model: string;
  source: 'local_control';
  status: LocalControlRequestStatus;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  executionDurationMs?: number | null;
  stopRequested?: boolean;
  sessionId?: string | null;
  summary?: string | null;
  error?: string | null;
  result?: Record<string, unknown> | null;
  traceDirectoryName?: string | null;
  recordingFolderName?: string | null;
  workerId?: string | null;
}

export type AgentMacroParameterType = 'string' | 'number' | 'boolean';

export interface AgentMacroParameter {
  id: string;
  name: string;
  description: string;
  type: AgentMacroParameterType;
  required: boolean;
  defaultValue?: string;
}

export interface AgentMacroStep {
  id: string;
  primitiveId: string;
  input: Record<string, unknown>;
}

export interface AgentMacroScope {
  type: 'global' | 'domain';
  label: string;
  domainPattern?: string;
}

export interface AgentMacroAction {
  id: string;
  name: string;
  description: string;
  scope: AgentMacroScope;
  parameters: AgentMacroParameter[];
  steps: AgentMacroStep[];
  createdAt: string;
  updatedAt: string;
  origin?: 'user' | 'builtin' | 'remote';
}

export interface SessionInfo {
  id: string;
  groupId: number;
  name: string;
  color: chrome.tabGroups.TabGroup['color'];
  createdAt: number;
  windowId?: number | null;
  source?: SessionSource;
  autoCloseOnIdle?: boolean;
}

export type SidePanelNotification =
  | { kind: 'session-switched'; sessionId: string | null }
  | { kind: 'session-created'; session: SessionInfo }
  | { kind: 'session-removed'; sessionId: string }
  | { kind: 'panel-no-session' };
