import { sendToBackground } from '../../shared/messaging';
import { useStore } from '../store';
import type { OttoAuthTask, SessionInfo, SessionSource } from '../../shared/types';

export function anySessionRunning(): boolean {
  return Object.values(useStore.getState().sessionStates).some((sessionState) => sessionState.isRunning);
}

export async function ensureBackgroundSession(source: Extract<SessionSource, 'ottoauth' | 'local_control'>): Promise<string | null> {
  const resp = await sendToBackground({
    type: 'session-request-create',
    backgroundTab: true,
    source,
    autoCloseOnIdle: true,
  });
  if (!resp.success || !resp.data) return null;
  const session = resp.data as SessionInfo;
  useStore.getState().initSession(session);
  return session.id;
}

export function buildSyntheticTask(args: {
  id: string;
  type: string;
  goal: string;
  createdAt: string;
  deviceId: string;
  url?: string | null;
}): OttoAuthTask {
  return {
    id: args.id,
    type: args.type,
    url: args.url ?? null,
    goal: args.goal,
    taskPrompt: args.goal,
    deviceId: args.deviceId,
    createdAt: args.createdAt,
  };
}

export function extractResultFromMessages(sessionId: string): Record<string, unknown> | null {
  const messages = useStore.getState().getMessages(sessionId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    for (let j = msg.blocks.length - 1; j >= 0; j--) {
      const block = msg.blocks[j];
      if (block.type !== 'text') continue;
      const json = extractJson(block.text);
      if (json) return json;
    }
  }
  const lastAssistant = messages.filter((message) => message.role === 'assistant').pop();
  if (lastAssistant) {
    const textParts = lastAssistant.blocks
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    if (textParts) {
      return { summary: textParts.slice(0, 2000) };
    }
  }
  return null;
}

export function summarizeResult(
  result: Record<string, unknown> | null,
  fallback: string | null = null,
): string | null {
  if (result) {
    const preferredKeys = ['summary', 'message', 'result', 'status'];
    for (const key of preferredKeys) {
      const value = result[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim().slice(0, 400);
      }
    }
    try {
      return JSON.stringify(result).slice(0, 400);
    } catch {
      // Fall through to fallback text.
    }
  }
  return fallback?.trim().slice(0, 400) || null;
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Not valid JSON.
    }
  }
  const braceMatch = text.match(/\{[\s\S]*"status"\s*:\s*"[^"]+[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Not valid JSON.
    }
  }
  return null;
}
