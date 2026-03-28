import { create } from 'zustand';
import type { PermissionMode, PlanData, OttoAuthTask } from '../shared/types';

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

interface AppStore {
  apiKey: string | null;
  setApiKey: (key: string | null) => void;

  messages: DisplayMessage[];
  addMessage: (msg: DisplayMessage) => void;
  appendToLastAssistant: (block: DisplayBlock) => void;
  updateStreamingText: (messageId: string, text: string) => void;
  clearMessages: () => void;

  isRunning: boolean;
  setIsRunning: (running: boolean) => void;

  currentTool: string | null;
  setCurrentTool: (tool: string | null) => void;

  error: string | null;
  setError: (error: string | null) => void;

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
  setOttoAuthConfig: (config: { url: string; deviceId: string; token: string } | null) => void;
  setOttoAuthConnected: (connected: boolean) => void;
  setOttoAuthPolling: (polling: boolean) => void;
  setOttoAuthCurrentTask: (task: OttoAuthTask | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  apiKey: null,
  setApiKey: (apiKey) => set({ apiKey }),

  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendToLastAssistant: (block) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, blocks: [...last.blocks, block] };
      }
      return { messages: msgs };
    }),
  updateStreamingText: (messageId, text) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const blocks = [...m.blocks];
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          blocks[blocks.length - 1] = { ...lastBlock, text };
        } else {
          blocks.push({ type: 'text', text });
        }
        return { ...m, blocks };
      }),
    })),
  clearMessages: () => set({ messages: [] }),

  isRunning: false,
  setIsRunning: (isRunning) => set({ isRunning }),

  currentTool: null,
  setCurrentTool: (currentTool) => set({ currentTool }),

  error: null,
  setError: (error) => set({ error }),

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
  setOttoAuthConfig: (config) =>
    set(
      config
        ? { ottoAuthUrl: config.url, ottoAuthDeviceId: config.deviceId, ottoAuthToken: config.token }
        : { ottoAuthUrl: null, ottoAuthDeviceId: null, ottoAuthToken: null, ottoAuthConnected: false },
    ),
  setOttoAuthConnected: (ottoAuthConnected) => set({ ottoAuthConnected }),
  setOttoAuthPolling: (ottoAuthPolling) => set({ ottoAuthPolling }),
  setOttoAuthCurrentTask: (ottoAuthCurrentTask) => set({ ottoAuthCurrentTask }),
}));
