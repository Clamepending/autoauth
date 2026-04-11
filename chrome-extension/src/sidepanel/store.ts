import { create } from 'zustand';
import { LOCAL_CONTROL_DEFAULT_URL } from '../shared/constants';
import type {
  AgentMacroAction,
  LocalControlRequest,
  OttoAuthTask,
  PermissionMode,
  PlanData,
  QuickAccessLink,
  SessionInfo,
} from '../shared/types';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: DisplayBlock[];
  timestamp: number;
}

export type DisplayBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; text?: string; imageData?: string }
  | { type: 'screenshot'; data: string };

export interface PermissionRequest {
  id: string;
  domain: string;
  permissionType: string;
  toolName: string;
  resolve: (granted: boolean, duration: 'once' | 'always') => void;
}

export interface PlanRequest {
  id: string;
  plan: PlanData;
  resolve: (approved: boolean) => void;
}

export interface SessionState {
  messages: DisplayMessage[];
  isRunning: boolean;
  currentTool: string | null;
  error: string | null;
  ottoAuthTask: OttoAuthTask | null;
}

export type LocalControlStatus = 'paused' | 'listening' | 'processing' | 'offline';

function emptySessionState(): SessionState {
  return { messages: [], isRunning: false, currentTool: null, error: null, ottoAuthTask: null };
}

interface AppStore {
  apiKey: string | null;
  setApiKey: (key: string | null) => void;

  // --- Session management ---
  sessionInfos: Record<string, SessionInfo>;
  sessionStates: Record<string, SessionState>;
  activeSessionId: string | null;

  initSession: (info: SessionInfo) => void;
  switchSession: (id: string | null) => void;
  removeSession: (id: string) => void;

  // --- Per-session state (operates on a given session, or active if omitted) ---
  getMessages: (sessionId?: string) => DisplayMessage[];
  addMessage: (msg: DisplayMessage, sessionId?: string) => void;
  appendToLastAssistant: (block: DisplayBlock, sessionId?: string) => void;
  updateStreamingText: (messageId: string, text: string, sessionId?: string) => void;
  clearMessages: (sessionId?: string) => void;

  getIsRunning: (sessionId?: string) => boolean;
  setIsRunning: (running: boolean, sessionId?: string) => void;

  getCurrentTool: (sessionId?: string) => string | null;
  setCurrentTool: (tool: string | null, sessionId?: string) => void;

  getError: (sessionId?: string) => string | null;
  setError: (error: string | null, sessionId?: string) => void;

  // --- Global state ---
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;

  permissionRequest: PermissionRequest | null;
  setPermissionRequest: (req: PermissionRequest | null) => void;

  planRequest: PlanRequest | null;
  setPlanRequest: (req: PlanRequest | null) => void;

  activeTabId: number | null;
  setActiveTabId: (id: number | null) => void;

  viewportSize: { width: number; height: number };
  setViewportSize: (size: { width: number; height: number }) => void;

  ottoAuthUrl: string | null;
  ottoAuthDeviceId: string | null;
  ottoAuthToken: string | null;
  ottoAuthConnected: boolean;
  ottoAuthPolling: boolean;
  ottoAuthCurrentTask: OttoAuthTask | null;
  ottoAuthTraceRecordingEnabled: boolean;
  ottoAuthTraceRecordingFolderName: string | null;
  setOttoAuthConfig: (config: { url: string; deviceId: string; token: string } | null) => void;
  setOttoAuthConnected: (connected: boolean) => void;
  setOttoAuthPolling: (polling: boolean) => void;
  setOttoAuthCurrentTask: (task: OttoAuthTask | null) => void;
  setOttoAuthTraceRecordingEnabled: (enabled: boolean) => void;
  setOttoAuthTraceRecordingFolderName: (folderName: string | null) => void;

  localControlUrl: string;
  localControlEnabled: boolean;
  localControlStatus: LocalControlStatus;
  localControlCurrentRequest: LocalControlRequest | null;
  localControlLastError: string | null;
  localControlRequestHistory: LocalControlRequest[];
  setLocalControlUrl: (url: string) => void;
  setLocalControlEnabled: (enabled: boolean) => void;
  setLocalControlStatus: (status: LocalControlStatus) => void;
  setLocalControlCurrentRequest: (request: LocalControlRequest | null) => void;
  setLocalControlLastError: (error: string | null) => void;
  setLocalControlRequestHistory: (requests: LocalControlRequest[]) => void;
  upsertLocalControlRequest: (request: LocalControlRequest) => void;

  actionMacros: AgentMacroAction[];
  setActionMacros: (macros: AgentMacroAction[]) => void;
  upsertActionMacro: (macro: AgentMacroAction) => void;
  removeActionMacro: (id: string) => void;

  quickAccessLinks: QuickAccessLink[];
  setQuickAccessLinks: (links: QuickAccessLink[]) => void;
}

function sortLocalControlRequests(requests: LocalControlRequest[]): LocalControlRequest[] {
  return [...requests].sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (updatedDiff !== 0) return updatedDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function resolveSessionId(state: AppStore, explicit?: string): string | null {
  return explicit ?? state.activeSessionId;
}

function updateSession(
  state: AppStore,
  sessionId: string | null,
  updater: (s: SessionState) => Partial<SessionState>,
): Partial<AppStore> {
  if (!sessionId) return {};
  const existing = state.sessionStates[sessionId];
  if (!existing) return {};
  return {
    sessionStates: {
      ...state.sessionStates,
      [sessionId]: { ...existing, ...updater(existing) },
    },
  };
}

export const useStore = create<AppStore>((set, get) => ({
  apiKey: null,
  setApiKey: (apiKey) => set({ apiKey }),

  // --- Session management ---
  sessionInfos: {},
  sessionStates: {},
  activeSessionId: null,

  initSession: (info) =>
    set((s) => ({
      sessionInfos: { ...s.sessionInfos, [info.id]: info },
      sessionStates: { ...s.sessionStates, [info.id]: s.sessionStates[info.id] ?? emptySessionState() },
      activeSessionId: info.id,
    })),

  switchSession: (id) => set({ activeSessionId: id }),

  removeSession: (id) =>
    set((s) => {
      const { [id]: _info, ...restInfos } = s.sessionInfos;
      const { [id]: _state, ...restStates } = s.sessionStates;
      return {
        sessionInfos: restInfos,
        sessionStates: restStates,
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
      };
    }),

  // --- Per-session state ---
  getMessages: (sessionId?) => {
    const sid = sessionId ?? get().activeSessionId;
    return sid ? get().sessionStates[sid]?.messages ?? [] : [];
  },

  addMessage: (msg, sessionId?) =>
    set((s) => {
      const sid = resolveSessionId(s, sessionId);
      return updateSession(s, sid, (ss) => ({ messages: [...ss.messages, msg] }));
    }),

  appendToLastAssistant: (block, sessionId?) =>
    set((s) => {
      const sid = resolveSessionId(s, sessionId);
      return updateSession(s, sid, (ss) => {
        const msgs = [...ss.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, blocks: [...last.blocks, block] };
        }
        return { messages: msgs };
      });
    }),

  updateStreamingText: (messageId, text, sessionId?) =>
    set((s) => {
      const sid = resolveSessionId(s, sessionId);
      return updateSession(s, sid, (ss) => ({
        messages: ss.messages.map((m) => {
          if (m.id !== messageId) return m;
          const blocks = [...m.blocks];
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock?.type === 'text') {
            blocks[blocks.length - 1] = { ...lastBlock, text };
          } else {
            blocks.push({ type: 'text', text });
          }
          return { ...m, blocks };
        }),
      }));
    }),

  clearMessages: (sessionId?) =>
    set((s) => {
      const sid = resolveSessionId(s, sessionId);
      return updateSession(s, sid, () => ({ messages: [] }));
    }),

  getIsRunning: (sessionId?) => {
    const sid = sessionId ?? get().activeSessionId;
    return sid ? get().sessionStates[sid]?.isRunning ?? false : false;
  },

  setIsRunning: (running, sessionId?) =>
    set((s) => {
      const sid = resolveSessionId(s, sessionId);
      return updateSession(s, sid, () => ({ isRunning: running }));
    }),

  getCurrentTool: (sessionId?) => {
    const sid = sessionId ?? get().activeSessionId;
    return sid ? get().sessionStates[sid]?.currentTool ?? null : null;
  },

  setCurrentTool: (tool, sessionId?) =>
    set((s) => {
      const sid = resolveSessionId(s, sessionId);
      return updateSession(s, sid, () => ({ currentTool: tool }));
    }),

  getError: (sessionId?) => {
    const sid = sessionId ?? get().activeSessionId;
    return sid ? get().sessionStates[sid]?.error ?? null : null;
  },

  setError: (error, sessionId?) =>
    set((s) => {
      const sid = resolveSessionId(s, sessionId);
      return updateSession(s, sid, () => ({ error }));
    }),

  // --- Global state ---
  permissionMode: 'allow_all',
  setPermissionMode: (permissionMode) => set({ permissionMode }),

  permissionRequest: null,
  setPermissionRequest: (permissionRequest) => set({ permissionRequest }),

  planRequest: null,
  setPlanRequest: (planRequest) => set({ planRequest }),

  activeTabId: null,
  setActiveTabId: (activeTabId) => set({ activeTabId }),

  viewportSize: { width: 1280, height: 800 },
  setViewportSize: (viewportSize) => set({ viewportSize }),

  ottoAuthUrl: null,
  ottoAuthDeviceId: null,
  ottoAuthToken: null,
  ottoAuthConnected: false,
  ottoAuthPolling: false,
  ottoAuthCurrentTask: null,
  ottoAuthTraceRecordingEnabled: false,
  ottoAuthTraceRecordingFolderName: null,
  setOttoAuthConfig: (config) =>
    set(
      config
        ? { ottoAuthUrl: config.url, ottoAuthDeviceId: config.deviceId, ottoAuthToken: config.token }
        : { ottoAuthUrl: null, ottoAuthDeviceId: null, ottoAuthToken: null, ottoAuthConnected: false },
    ),
  setOttoAuthConnected: (ottoAuthConnected) => set({ ottoAuthConnected }),
  setOttoAuthPolling: (ottoAuthPolling) => set({ ottoAuthPolling }),
  setOttoAuthCurrentTask: (ottoAuthCurrentTask) => set({ ottoAuthCurrentTask }),
  setOttoAuthTraceRecordingEnabled: (ottoAuthTraceRecordingEnabled) => set({ ottoAuthTraceRecordingEnabled }),
  setOttoAuthTraceRecordingFolderName: (ottoAuthTraceRecordingFolderName) => set({ ottoAuthTraceRecordingFolderName }),

  localControlUrl: LOCAL_CONTROL_DEFAULT_URL,
  localControlEnabled: true,
  localControlStatus: 'paused',
  localControlCurrentRequest: null,
  localControlLastError: null,
  localControlRequestHistory: [],
  setLocalControlUrl: (localControlUrl) => set({ localControlUrl }),
  setLocalControlEnabled: (localControlEnabled) => set({ localControlEnabled }),
  setLocalControlStatus: (localControlStatus) => set({ localControlStatus }),
  setLocalControlCurrentRequest: (localControlCurrentRequest) => set({ localControlCurrentRequest }),
  setLocalControlLastError: (localControlLastError) => set({ localControlLastError }),
  setLocalControlRequestHistory: (localControlRequestHistory) =>
    set({ localControlRequestHistory: sortLocalControlRequests(localControlRequestHistory) }),
  upsertLocalControlRequest: (request) =>
    set((state) => ({
      localControlCurrentRequest: request.status === 'running' ? request : (
        state.localControlCurrentRequest?.id === request.id ? null : state.localControlCurrentRequest
      ),
      localControlRequestHistory: sortLocalControlRequests([
        request,
        ...state.localControlRequestHistory.filter((entry) => entry.id !== request.id),
      ]),
    })),

  actionMacros: [],
  setActionMacros: (actionMacros) => set({ actionMacros }),
  upsertActionMacro: (macro) =>
    set((state) => ({
      actionMacros: [...state.actionMacros.filter((entry) => entry.id !== macro.id), macro].sort((a, b) =>
        a.scope.label.localeCompare(b.scope.label) || a.name.localeCompare(b.name),
      ),
    })),
  removeActionMacro: (id) =>
    set((state) => ({
      actionMacros: state.actionMacros.filter((entry) => entry.id !== id),
    })),

  quickAccessLinks: [],
  setQuickAccessLinks: (quickAccessLinks) => set({ quickAccessLinks }),
}));
