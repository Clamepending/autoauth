import { sendToBackground } from '../../shared/messaging';
import { useStore } from '../store';
import type { OttoAuthTask, SessionInfo, SessionSource } from '../../shared/types';

type OttoAuthTaskCompletion = {
  status: 'completed' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  rawText: string | null;
};

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

export function extractOttoAuthTaskCompletion(sessionId: string): OttoAuthTaskCompletion {
  const messages = useStore.getState().getMessages(sessionId);
  const lastAssistantText = extractLastAssistantText(messages);

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    for (let j = msg.blocks.length - 1; j >= 0; j--) {
      const block = msg.blocks[j];
      if (block.type !== 'text') continue;
      const json = extractJson(block.text);
      if (json) {
        return normalizeStructuredOttoAuthResult(json, lastAssistantText);
      }
    }
  }

  if (lastAssistantText) {
    if (looksLikeClarificationRequest(lastAssistantText)) {
      const error =
        'OttoAuth does not support live clarification replies. The fulfiller asked for more direction instead of returning a final result.';
      return {
        status: 'failed',
        result: buildOttoAuthFailureResult(
          'Task blocked because the fulfiller requested clarification.',
          `${error} Final assistant message: ${truncate(lastAssistantText, 800)}`,
        ),
        error,
        rawText: lastAssistantText,
      };
    }

    const error =
      'OttoAuth browser tasks must finish with a single JSON result. The fulfiller returned unstructured text instead.';
    return {
      status: 'failed',
      result: buildOttoAuthFailureResult(
        'Task ended without the structured OttoAuth result format.',
        `${error} Final assistant message: ${truncate(lastAssistantText, 800)}`,
      ),
      error,
      rawText: lastAssistantText,
    };
  }

  const error =
    'OttoAuth browser tasks must finish with a single JSON result. The fulfiller returned no final assistant message.';
  return {
    status: 'failed',
    result: buildOttoAuthFailureResult(
      'Task ended without a final OttoAuth result.',
      error,
    ),
    error,
    rawText: null,
  };
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

function extractLastAssistantText(
  messages: Array<{ role: 'user' | 'assistant'; blocks: Array<{ type: string; text?: string }> }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const text = msg.blocks
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return null;
}

function normalizeStructuredOttoAuthResult(
  result: Record<string, unknown>,
  rawText: string | null,
): OttoAuthTaskCompletion {
  const statusValue = typeof result.status === 'string' ? result.status.trim().toLowerCase() : '';
  const summaryText = [
    typeof result.summary === 'string' ? result.summary : '',
    typeof result.error === 'string' ? result.error : '',
    rawText || '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  if (looksLikeClarificationRequest(summaryText)) {
    const error =
      'OttoAuth does not support live clarification replies. The fulfiller asked for more direction instead of returning a final result.';
    return {
      status: 'failed',
      result: buildOttoAuthFailureResult(
        'Task blocked because the fulfiller requested clarification.',
        `${error} Final assistant message: ${truncate(summaryText, 800)}`,
      ),
      error,
      rawText,
    };
  }

  if (statusValue === 'failed') {
    return {
      status: 'failed',
      result,
      error:
        (typeof result.error === 'string' && result.error.trim()) ||
        (typeof result.summary === 'string' && result.summary.trim()) ||
        'Task failed.',
      rawText,
    };
  }

  if (statusValue === 'completed') {
    return {
      status: 'completed',
      result,
      error: null,
      rawText,
    };
  }

  const error =
    'OttoAuth browser tasks must return a JSON object whose status is "completed" or "failed".';
  return {
    status: 'failed',
    result: buildOttoAuthFailureResult(
      'Task returned an invalid OttoAuth result payload.',
      `${error} Final assistant message: ${truncate(summaryText || JSON.stringify(result), 800)}`,
    ),
    error,
    rawText,
  };
}

function buildOttoAuthFailureResult(summary: string, error: string): Record<string, unknown> {
  return {
    status: 'failed',
    summary,
    error,
    merchant: null,
    pickup_details: {
      order_number: null,
      confirmation_code: null,
      pickup_code: null,
      ready_time: null,
      pickup_name: null,
      instructions: null,
    },
    tracking_details: {
      tracking_number: null,
      tracking_url: null,
      carrier: null,
      status: null,
      delivery_eta: null,
      delivery_window: null,
      instructions: null,
    },
    receipt_details: {
      order_reference: null,
      receipt_url: null,
      receipt_text: null,
    },
    charges: {
      goods_cents: 0,
      shipping_cents: 0,
      tax_cents: 0,
      other_cents: 0,
      currency: 'usd',
    },
  };
}

function looksLikeClarificationRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;

  const strongMarkers = [
    'how would you like me to proceed',
    'how should i proceed',
    'please clarify',
    'could you clarify',
    'can you clarify',
    'i need clarification',
    'i need more information',
    'i need more detail',
    'what would you like me to do',
    'which option would you like',
    'please let me know how to proceed',
    'tell me how to proceed',
    'waiting for clarification',
    'according to my instructions',
  ];
  if (strongMarkers.some((marker) => normalized.includes(marker))) {
    return true;
  }

  if (!normalized.includes('?')) {
    return false;
  }

  return /(would you like|how should i|how would you like|can you clarify|could you clarify|should i proceed|what should i do|which .* should i)/.test(
    normalized,
  );
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}
